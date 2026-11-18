/**
 * `Onboarding`: the root of the wizard. It owns where the visitor is (State `current`, `finished`), reads every
 * step's own Properties (`title`, `missing`, `complete`, `answers`) through declared dependencies, and exposes the
 * moves as Methods:
 *
 * - `canEnter(index)`: **read-only**. It writes no State and emits no Event, so Core lets other Methods (and
 *   Properties) depend on it; `goTo` calls it.
 * - `next()`, `back()`, `goTo(index)`: write `current` and emit `stepChanged`. `goTo` validates its argument
 *   (`invalid-method-arguments`: not a whole number), but whether the step exists and may be entered depends on the
 *   Blueprint and on the other steps, which `validateArgs` cannot see, so those are `execute` diagnostics
 *   (`invalid-method-result`: `no-such-step`, `step-locked`).
 * - `finish()`: needs every step complete, writes `finished` and emits `completed` with every step's answers.
 *
 * A move that is refused writes nothing and emits nothing: the failure is the Method's diagnostic. A refused move is
 * ordinary visitor input (Next on an empty form), not an exception.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { OnboardingConfig, OnboardingRawConfig } from '../config'
import type { Completion, I18nText, Progress, StepChange, StepSummary } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkOnboardingConfig, resolveOnboardingConfig } from '../config'
import { describeValue, isBoolean, isNumber, isStepType } from '../domain'
import { onboardingConfigSchema } from '../schemas'
import { stepAnswerReads, stepSummaryReads } from './reads'
import { stepChildrenOfView } from './structure'

export interface OnboardingInterfaces extends WidgetInterfaces {
	config: { raw: OnboardingRawConfig, resolved: OnboardingConfig }
	slots: 'steps'
	state: { current: number, finished: boolean }
	properties: {
		title: I18nText
		steps: readonly StepSummary[]
		progress: Progress
		answers: Completion['answers']
	}
	methods: {
		canEnter: (index: number) => boolean
		next: () => number
		back: () => number
		goTo: (index: number) => number
		finish: () => boolean
	}
	events: {
		stepChanged: [change: StepChange]
		completed: [completion: Completion]
	}
}

export const OnboardingPlugin = createWidgetPlugin('Onboarding')
	.description('The root of the onboarding wizard. State: `current` (the index of the current step) and `finished`. Properties: `title`, `steps` (each step\'s title, `complete` and `missing`), `progress` and `answers`. Methods: `canEnter(index)` (read-only), `next()`, `back()`, `goTo(index)` (each writes `current` and emits `stepChanged`) and `finish()` (emits `completed`). A refused move is a Method diagnostic and changes nothing.')
	.interfaces<OnboardingInterfaces>()
	.config({
		description: 'The wizard title per language and, optionally, the index of the step it opens on.',
		schema: onboardingConfigSchema,
		validate: (input, ctx): input is OnboardingRawConfig => {
			checkOnboardingConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveOnboardingConfig,
	})
	.slots({
		steps: {
			description: 'The steps in order: AccountStep, InterestsStep, SafetyStep or InductionStep. At least one.',
			validateStructure: ({ children, addDiagnostic }) => {
				if (children.length === 0)
					addDiagnostic({ message: 'An Onboarding needs at least one step.', index: 0, reason: 'no-steps' })
				children.forEach((child, index) => {
					if (child.resolved && !isStepType(child.type))
						addDiagnostic({ message: `"${child.type}" is not a step type.`, index, reason: 'not-a-step' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, config, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'An Onboarding must be the root widget.', reason: 'onboarding-not-root' })
		const count = blueprint.getChildrenAt(widget, 'steps').length
		if (count > 0 && config.startStep >= count)
			addDiagnostic({ message: `startStep is ${config.startStep}, but the wizard has ${count} steps (0 to ${count - 1}).`, reason: 'start-step-out-of-range' })
	})
	.state(state => state
		.current({
			validate: (input): input is number => isNumber(input) && Number.isInteger(input) && input >= 0,
			default: ({ config }) => config.startStep,
		})
		.finished({
			validate: (input): input is boolean => isBoolean(input),
			default: () => false,
		}))
	.properties(properties => properties
		.title({ compute: ({ config }) => config.title })
		.steps({
			registerDeps: ({ dep, blueprint }) => ({ steps: stepSummaryReads(dep, blueprint) }),
			compute: ({ deps, blueprint }) => stepChildrenOfView(blueprint)
				.flatMap(({ id, type }, index) => {
					const step = deps.steps[index]!
					const title = step.title()
					const complete = step.complete()
					const missing = step.missing()
					// A failed read is already a recorded dependency diagnostic on this Property.
					return title.ok && complete.ok && missing.ok
						? [{ id, type, title: title.value, complete: complete.value, missing: missing.value }]
						: []
				}),
		})
		.progress({
			registerDeps: ({ dep }) => ({ steps: dep.self.properties.get('steps'), current: dep.self.state.get('current') }),
			compute: ({ deps }) => {
				const steps = deps.steps()
				const current = deps.current()
				const list = steps.ok ? steps.value : []
				const index = current.ok ? (current.value ?? 0) : 0
				const firstIncomplete = list.findIndex(step => !step.complete)
				return {
					count: list.length,
					current: index,
					currentId: list[index]?.id ?? null,
					stepIds: list.map(step => step.id),
					firstIncomplete,
					furthest: firstIncomplete === -1 ? Math.max(0, list.length - 1) : firstIncomplete,
					allComplete: list.length > 0 && firstIncomplete === -1,
				}
			},
		})
		.answers({
			registerDeps: ({ dep, blueprint }) => ({ steps: stepAnswerReads(dep, blueprint) }),
			compute: ({ deps, blueprint }) => Object.fromEntries(stepChildrenOfView(blueprint)
				.flatMap(({ id }, index) => {
					const answers = deps.steps[index]!.answers()
					return answers.ok ? [[id, answers.value]] : []
				})),
		}))
	.methods(methods => methods
		.canEnter({
			validateArgs: (args, { addDiagnostic }): args is [number] => {
				const ok = args.length === 1 && typeof args[0] === 'number' && Number.isFinite(args[0])
				if (!ok)
					addDiagnostic({ message: 'canEnter(index) takes one finite number.', reason: 'invalid-index' })
				return ok
			},
			registerDeps: ({ dep }) => ({ progress: dep.self.properties.get('progress') }),
			execute: ({ args: [index], deps }) => {
				const progress = deps.progress()
				return progress.ok && Number.isInteger(index) && index >= 0 && index < progress.value.count && index <= progress.value.furthest
			},
		})
		.next({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				progress: dep.self.properties.get('progress'),
				steps: dep.self.properties.get('steps'),
				finished: dep.self.state.get('finished'),
				setCurrent: dep.self.state.set('current'),
			}),
			emits: ['stepChanged'],
			execute: ({ deps, emit, addDiagnostic }) => {
				const progress = deps.progress()
				const steps = deps.steps()
				const finished = deps.finished()
				if (!progress.ok || !steps.ok || !finished.ok)
					return 0
				const { current, count, stepIds } = progress.value
				if (finished.value) {
					addDiagnostic({ message: 'The wizard is finished: there is no next step.', reason: 'already-finished' })
					return current
				}
				const step = steps.value[current]
				if (step !== undefined && !step.complete) {
					addDiagnostic({ message: `The "${step.id}" step is not complete yet: ${step.missing.join(', ')}.`, reason: 'step-incomplete' })
					return current
				}
				if (current + 1 >= count) {
					addDiagnostic({ message: 'This is the last step: use finish() to complete the wizard.', reason: 'last-step' })
					return current
				}
				deps.setCurrent(current + 1)
				emit.stepChanged({ from: stepIds[current]!, to: stepIds[current + 1]!, fromIndex: current, toIndex: current + 1, by: 'next' })
				return current + 1
			},
		})
		.back({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				progress: dep.self.properties.get('progress'),
				finished: dep.self.state.get('finished'),
				setCurrent: dep.self.state.set('current'),
			}),
			emits: ['stepChanged'],
			execute: ({ deps, emit, addDiagnostic }) => {
				const progress = deps.progress()
				const finished = deps.finished()
				if (!progress.ok || !finished.ok)
					return 0
				const { current, stepIds } = progress.value
				if (finished.value) {
					addDiagnostic({ message: 'The wizard is finished: there is no step to go back to.', reason: 'already-finished' })
					return current
				}
				if (current === 0) {
					addDiagnostic({ message: 'This is the first step: there is no step before it.', reason: 'first-step' })
					return current
				}
				deps.setCurrent(current - 1)
				emit.stepChanged({ from: stepIds[current]!, to: stepIds[current - 1]!, fromIndex: current, toIndex: current - 1, by: 'back' })
				return current - 1
			},
		})
		.goTo({
			validateArgs: (args, { addDiagnostic, hasAnyDiagnostic }): args is [number] => {
				if (args.length !== 1) {
					addDiagnostic({ message: `goTo(index) takes exactly one argument, the step number counted from 0, got ${args.length}.`, reason: 'wrong-arity' })
					return false
				}
				const [index] = args
				if (typeof index !== 'number' || !Number.isInteger(index))
					addDiagnostic({ message: `goTo(index): index must be a whole number, got ${describeValue(index)}.`, path: [0], reason: 'not-a-whole-number' })
				else if (index < 0)
					addDiagnostic({ message: `goTo(index): index counts from 0, got ${index}.`, path: [0], reason: 'negative-index' })
				return !hasAnyDiagnostic()
			},
			registerDeps: ({ dep }) => ({
				progress: dep.self.properties.get('progress'),
				finished: dep.self.state.get('finished'),
				canEnter: dep.self.methods.invoke('canEnter'),
				setCurrent: dep.self.state.set('current'),
			}),
			emits: ['stepChanged'],
			execute: ({ args: [index], deps, emit, addDiagnostic }) => {
				const progress = deps.progress()
				const finished = deps.finished()
				if (!progress.ok || !finished.ok)
					return 0
				const { current, count, stepIds } = progress.value
				if (finished.value) {
					addDiagnostic({ message: 'The wizard is finished: there is no step to go to.', reason: 'already-finished' })
					return current
				}
				if (index >= count) {
					addDiagnostic({ message: `There is no step ${index}: the wizard has ${count} steps (0 to ${count - 1}).`, reason: 'no-such-step' })
					return current
				}
				// Where the visitor already is is always allowed, and asks for nothing.
				if (index === current)
					return current
				const allowed = deps.canEnter(index)
				if (!allowed.ok)
					return current
				if (!allowed.value) {
					addDiagnostic({ message: `Step ${index} ("${stepIds[index]}") is locked: finish the steps before it first.`, reason: 'step-locked' })
					return current
				}
				deps.setCurrent(index)
				emit.stepChanged({ from: stepIds[current]!, to: stepIds[index]!, fromIndex: current, toIndex: index, by: index < current ? 'back' : 'jump' })
				return index
			},
		})
		.finish({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				progress: dep.self.properties.get('progress'),
				answers: dep.self.properties.get('answers'),
				finished: dep.self.state.get('finished'),
				setFinished: dep.self.state.set('finished'),
			}),
			emits: ['completed'],
			execute: ({ deps, emit, addDiagnostic }) => {
				const progress = deps.progress()
				const answers = deps.answers()
				const finished = deps.finished()
				if (!progress.ok || !answers.ok || !finished.ok)
					return false
				if (finished.value) {
					addDiagnostic({ message: 'The wizard is already finished.', reason: 'already-finished' })
					return false
				}
				if (!progress.value.allComplete) {
					const step = progress.value.stepIds[progress.value.firstIncomplete]
					addDiagnostic({ message: `The "${step}" step is not complete yet, so the wizard cannot be finished.`, reason: 'steps-incomplete' })
					return false
				}
				deps.setFinished(true)
				emit.completed({ answers: answers.value })
				return true
			},
		}))
	.events(events => events
		.stepChanged({ description: 'The visitor moved to another step. Carries the step ids and indexes it left and entered, and how (next, back or jump).' })
		.completed({ description: 'The visitor finished the wizard. Carries every step\'s answers by step id.' }))
	.done()
