/**
 * `TripSurvey` (checkpoint §2) — `config + slots + state + properties + methods`. The survey's
 * root/workflow widget: `phase`/`result`/`resultInputs` are read by the renderer through `useState()`;
 * `resultFresh` is the one semantic Property this widget declares, read through `useProperties()`.
 *
 * `semantics` is an intentional semantic-only declared slot (`TripReadiness`/`TripRecommendation` live
 * there): `TripSurveyRenderer` deliberately does not render it (checkpoint §2 / structure decisions).
 * Not rendering a declared slot is a showcase presentation choice, not a `WidgetSlot` contract change.
 *
 * `reset` / `submit` / `generateResult` implement the exact dependency/effect skeletons and failure
 * semantics locked in checkpoint §5, including the intentional two-stage `submit -> generateResult`
 * workflow (readiness/recommendation Properties may stay `never-evaluated` in inspection until the
 * corresponding Method naturally evaluates them).
 *
 * Issue #26 Finding 1 (stale Recommendation with no explicit freshness signal): `generateResult()` now
 * also stores the exact answer set it generated `result` from, as a new State (`resultInputs`) keyed by
 * each configured question's widget id. Storing it as a State (not deriving it) is intentional — it is
 * a snapshot of a specific past `generateResult()` call, not a live reactive read, so it demonstrates
 * the State-snapshot-vs-reactive-Property distinction the checkpoint's semantic model is built on.
 * `resultFresh` is the reactive Property layered on top: it compares that stored snapshot against the
 * current answers and is what the renderer actually consults to decide whether the retained `result`
 * is still trustworthy.
 *
 * Which questions feed `resultInputs`/`resultFresh`: this reuses `resetQuestionIds` rather than adding a
 * second config key. `resetQuestionIds` and "every question `generateResult()`'s answer set depends on"
 * happen to be the exact same 8 leaf questions in every preset this Lab ships today (`presets.ts`) —
 * every answer `reset()` restores is also an answer that can change the computed Recommendation. Reusing
 * the existing key avoids a second config surface that would silently drift out of sync with the first;
 * the trade-off (documented here, not hidden) is that this equivalence is an assumption, not an enforced
 * invariant — a future preset that widens `resetQuestionIds` beyond the answer-input set (or vice versa)
 * would need a dedicated key at that point, not a silent reinterpretation of this one.
 *
 * `resultFresh` is deliberately an over-approximation: it flips to `false` the moment any tracked
 * answer changes, even one the generated recommendation never actually read (e.g. `family-priority`
 * while `children === 0`, which `TripReadiness`/`TripRecommendation` both ignore while hidden — see
 * `trip-readiness.ts`'s file header). Precisely tracking which answers a specific past computation
 * actually consumed is not part of this checkpoint's semantic model; "possibly stale, safe to say so"
 * is preferred over silently under-reporting staleness.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TripRecommendationResult } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject, isTripRecommendationResult } from '../domain'

export interface TripSurveyConfig {
	readonly resetQuestionIds: readonly string[]
	readonly readinessId: string
	readonly recommendationId: string
}

export type TripSurveyPhase = 'editing' | 'submitted' | 'result'

export interface TripSurveyInterfaces extends WidgetInterfaces {
	config: {
		raw: TripSurveyConfig
		resolved: TripSurveyConfig
	}
	slots: 'form' | 'semantics'
	state: {
		phase: TripSurveyPhase
		result: TripRecommendationResult | null
		resultInputs: Readonly<Record<string, unknown>> | null
	}
	properties: {
		resultFresh: boolean
	}
	methods: {
		reset: () => void
		submit: () => boolean
		generateResult: () => TripRecommendationResult | null
	}
}

function isTripSurveyConfig(input: unknown): input is TripSurveyConfig {
	return isPlainObject(input)
		&& Array.isArray(input.resetQuestionIds) && input.resetQuestionIds.every(id => typeof id === 'string')
		&& typeof input.readinessId === 'string'
		&& typeof input.recommendationId === 'string'
}

function isTripSurveyPhase(input: unknown): input is TripSurveyPhase {
	return input === 'editing' || input === 'submitted' || input === 'result'
}

/**
 * `resultInputs`'s own State validation is structural only — a plain object (or `null`) of arbitrary
 * answer values keyed by widget id; per-question value validity is each question's own State concern.
 */
function isResultInputs(input: unknown): input is Readonly<Record<string, unknown>> | null {
	return input === null || isPlainObject(input)
}

/**
 * Structural equality over a `resultInputs` snapshot's tracked keys: every answer in `current` compares
 * `===` against its stored counterpart in `stored`. Every tracked answer is a Runtime `state.get('answer')`
 * primitive (`string | number | null`), never an array/object, so `===` is exact structural equality
 * here — no deep-equal library is needed for this domain.
 */
function answersMatch(stored: Readonly<Record<string, unknown>>, current: Readonly<Record<string, unknown>>, questionIds: readonly string[]): boolean {
	return questionIds.every(id => stored[id] === current[id])
}

export const TripSurveyPlugin = createWidgetPlugin('TripSurvey')
	.interfaces<TripSurveyInterfaces>()
	.config({
		validate: (input): input is TripSurveyConfig => isTripSurveyConfig(input),
		resolve: raw => ({
			resetQuestionIds: raw?.resetQuestionIds ?? [],
			readinessId: raw?.readinessId ?? '',
			recommendationId: raw?.recommendationId ?? '',
		}),
	})
	.slots({ form: {}, semantics: {} })
	.state(state =>
		state
			.phase({
				validate: (input): input is TripSurveyPhase => isTripSurveyPhase(input),
				default: () => 'editing',
			})
			.result({
				validate: (input): input is TripRecommendationResult | null => input === null || isTripRecommendationResult(input),
				default: () => null,
			})
			.resultInputs({
				validate: (input): input is Readonly<Record<string, unknown>> | null => isResultInputs(input),
				default: () => null,
			}))
	.properties(properties =>
		properties.resultFresh({
			// Self-state reads of the exact same snapshot pair `generateResult()` writes, plus one
			// self-state `answer` read per configured question (see the file header for the
			// `resetQuestionIds`-reuse rationale) — never a renderer-side comparison.
			registerDeps: ({ dep, config }) => ({
				result: dep.self.state.get('result'),
				resultInputs: dep.self.state.get('resultInputs'),
				answers: config.resetQuestionIds.map(id => dep.widget(id).state.get('answer')),
			}),
			compute: ({ deps, config }) => {
				const resultResult = deps.result()
				const result = resultResult.success ? resultResult.value : null
				// No result yet: there is nothing to be stale relative to. The renderer never consults
				// `resultFresh` while `result === null` (checkpoint UI rule), so this branch's exact value
				// is a documented convention, not an observed behavior: `true` ("vacuously fresh") reads
				// more naturally than `false` for "no snapshot exists to be stale."
				if (result === null)
					return true

				const resultInputsResult = deps.resultInputs()
				const storedInputs = resultInputsResult.success ? resultInputsResult.value : null
				// Defensive only: `generateResult()` always writes `resultInputs` in the same transaction as
				// `result`, so a non-null `result` with a null `resultInputs` should not occur in practice.
				// Treat it conservatively as stale rather than assuming freshness for an unverifiable snapshot.
				if (storedInputs === null)
					return false

				const currentAnswers: Record<string, unknown> = {}
				config.resetQuestionIds.forEach((id, index) => {
					const answerResult = deps.answers[index]!()
					currentAnswers[id] = answerResult.success ? answerResult.value : null
				})

				// Over-approximating on purpose (see file header): any tracked answer change marks the
				// stored `result` stale, even one the recommendation did not actually read.
				return answersMatch(storedInputs, currentAnswers, config.resetQuestionIds)
			},
		}))
	.methods(methods =>
		methods
			.reset({
				// Method->Method edges (one `invoke` per configured question) plus transitive State-write
				// effects (checkpoint §5): every configured question's own `reset()` writes its `answer`
				// back to its configured default.
				registerDeps: ({ dep, config }) => ({
					resetQuestions: config.resetQuestionIds.map(id => dep.widget(id).methods.invoke('reset')),
					setPhase: dep.self.state.set('phase'),
					setResult: dep.self.state.set('result'),
					setResultInputs: dep.self.state.set('resultInputs'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					for (const resetQuestion of deps.resetQuestions) resetQuestion()
					deps.setPhase('editing')
					deps.setResult(null)
					deps.setResultInputs(null)
				},
			})
			.submit({
				registerDeps: ({ dep, config }) => ({
					ready: dep.widget(config.readinessId).properties.get('ready')
						.validate((value): value is boolean => typeof value === 'boolean'),
					setPhase: dep.self.state.set('phase'),
					setResult: dep.self.state.set('result'),
					setResultInputs: dep.self.state.set('resultInputs'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const readyResult = deps.ready()
					// Readiness failure fails this Method automatically via dependency propagation
					// (checkpoint C2/§5) — no phase/result mutation, no renderer-side substitute
					// validation. The returned `false` is discarded on that path.
					if (!readyResult.success)
						return false

					deps.setResult(null)
					deps.setResultInputs(null)
					deps.setPhase('submitted')
					return true
				},
			})
			.generateResult({
				registerDeps: ({ dep, config }) => ({
					phase: dep.self.state.get('phase'),
					recommendation: dep.widget(config.recommendationId).properties.get('result')
						.validate(isTripRecommendationResult),
					// One `answer` read per configured question (issue #26 Finding 1) — captured
					// alongside `result` so the stored `resultInputs` snapshot always reflects exactly
					// the answers `result` was computed from in this same transaction.
					answers: config.resetQuestionIds.map(id => dep.widget(id).state.get('answer')),
					setResult: dep.self.state.set('result'),
					setResultInputs: dep.self.state.set('resultInputs'),
					setPhase: dep.self.state.set('phase'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, config, addIssue }) => {
					const phaseResult = deps.phase()
					const phase = phaseResult.success ? phaseResult.value : null
					if (phase !== 'submitted') {
						addIssue({ message: 'generateResult() requires the survey to be submitted first.' })
						return null
					}

					const recommendationResult = deps.recommendation()
					// A recommendation failure (e.g. readiness regressed after submit) fails this Method
					// automatically via dependency propagation — no mutation, per checkpoint §5.
					if (!recommendationResult.success)
						return null

					const resultInputs: Record<string, unknown> = {}
					config.resetQuestionIds.forEach((id, index) => {
						const answerResult = deps.answers[index]!()
						resultInputs[id] = answerResult.success ? answerResult.value : null
					})

					deps.setResult(recommendationResult.value)
					deps.setResultInputs(resultInputs)
					deps.setPhase('result')
					return recommendationResult.value
				},
			}))
	.done()
