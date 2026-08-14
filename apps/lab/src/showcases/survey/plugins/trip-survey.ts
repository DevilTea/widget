/**
 * `TripSurvey` (checkpoint §2) — `config + slots + state + methods`. The survey's root/workflow
 * widget: no `properties` capability at all, so its `phase`/`result` are read by the renderer through
 * `useState()`, never `useProperties()`.
 *
 * `semantics` is an intentional semantic-only declared slot (`TripReadiness`/`TripRecommendation` live
 * there): `TripSurveyRenderer` deliberately does not render it (checkpoint §2 / structure decisions).
 * Not rendering a declared slot is a showcase presentation choice, not a `WidgetSlot` contract change.
 *
 * `reset` / `submit` / `generateResult` implement the exact dependency/effect skeletons and failure
 * semantics locked in checkpoint §5, including the intentional two-stage `submit -> generateResult`
 * workflow (readiness/recommendation Properties may stay `never-evaluated` in inspection until the
 * corresponding Method naturally evaluates them).
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
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					for (const resetQuestion of deps.resetQuestions) resetQuestion()
					deps.setPhase('editing')
					deps.setResult(null)
				},
			})
			.submit({
				registerDeps: ({ dep, config }) => ({
					ready: dep.widget(config.readinessId).properties.get('ready')
						.validate((value): value is boolean => typeof value === 'boolean'),
					setPhase: dep.self.state.set('phase'),
					setResult: dep.self.state.set('result'),
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
					deps.setPhase('submitted')
					return true
				},
			})
			.generateResult({
				registerDeps: ({ dep, config }) => ({
					phase: dep.self.state.get('phase'),
					recommendation: dep.widget(config.recommendationId).properties.get('result')
						.validate(isTripRecommendationResult),
					setResult: dep.self.state.set('result'),
					setPhase: dep.self.state.set('phase'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, addIssue }) => {
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

					deps.setResult(recommendationResult.value)
					deps.setPhase('result')
					return recommendationResult.value
				},
			}))
	.done()
