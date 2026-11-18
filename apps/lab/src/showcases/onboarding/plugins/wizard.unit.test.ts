/**
 * The wizard's moves against a real Core Runtime: Events emitted with their payloads, a host listener's view of
 * them, Method argument validation (`invalid-method-arguments`), refused moves (`invalid-method-result`), and the
 * rule that a failed call changes and emits nothing while a later successful one clears the diagnostics.
 */

import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultOnboardingPreset } from '../presets'
import { onboardingSystem } from '../system'
import { completeFirstThreeSteps, createOnboardingRuntime, createPresetRuntime, failureOf, valueOf, widgetsOf } from '../test-support'

function listen(widget: { readonly events: Record<string, { readonly subscribe: (listener: (...args: any[]) => void) => () => void }> }, names: readonly string[]): { readonly heard: { readonly name: string, readonly args: readonly unknown[] }[] } {
	const heard: { name: string, args: readonly unknown[] }[] = []
	for (const name of names)
		widget.events[name]!.subscribe((...args) => heard.push({ name, args }))
	return { heard }
}

describe('onboarding: moves', () => {
	it('starts on the first step with nothing complete and only the first step enterable', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		expect(root.state.current.get())
			.toBe(0)
		const progress = valueOf(root.properties.progress.get())
		expect(progress)
			.toMatchObject({ count: 4, current: 0, currentId: 'account', firstIncomplete: 0, furthest: 0, allComplete: false, stepIds: ['account', 'interests', 'safety', 'induction'] })
		expect(valueOf(root.properties.steps.get())
			.map(step => [step.id, step.complete, step.missing]))
			.toEqual([['account', false, ['name', 'email']], ['interests', false, ['interests:1']], ['safety', false, ['rule:shoes', 'rule:machines', 'rule:exits']], ['induction', false, ['booking']]])
	})

	it('refuses Next on an incomplete step with a Method diagnostic, changes nothing and emits nothing', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		const { heard } = listen(root, ['stepChanged'])
		const result = root.methods.next()
		expect(result.ok)
			.toBe(false)
		expect(failureOf(root.methods.next))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-incomplete' }])
		expect(root.methods.next.getDiagnostics()[0]?.message)
			.toBe('The "account" step is not complete yet: name, email.')
		expect(root.state.current.get())
			.toBe(0)
		expect(heard)
			.toEqual([])
	})

	it('moves forward when the step is complete, emits stepChanged with the payload and clears the earlier failure', () => {
		const { runtime } = createOnboardingRuntime()
		const { root, account } = widgetsOf(runtime)
		const { heard } = listen(root, ['stepChanged'])
		root.methods.next()
		expect(root.methods.next.getDiagnostics())
			.toHaveLength(1)
		account.state.name.set('Sam Rivera')
		account.state.email.set('sam@example.org')
		expect(valueOf(root.methods.next()))
			.toBe(1)
		expect(root.methods.next.getDiagnostics())
			.toEqual([])
		expect(root.state.current.get())
			.toBe(1)
		expect(heard)
			.toEqual([{ name: 'stepChanged', args: [{ from: 'account', to: 'interests', fromIndex: 0, toIndex: 1, by: 'next' }] }])
	})

	it('goes back, and refuses Back on the first step', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		completeFirstThreeSteps(runtime)
		root.methods.next()
		const { heard } = listen(root, ['stepChanged'])
		expect(valueOf(root.methods.back()))
			.toBe(0)
		expect(heard)
			.toEqual([{ name: 'stepChanged', args: [{ from: 'interests', to: 'account', fromIndex: 1, toIndex: 0, by: 'back' }] }])
		expect(root.methods.back().ok)
			.toBe(false)
		expect(failureOf(root.methods.back))
			.toEqual([{ code: 'invalid-method-result', reason: 'first-step' }])
		expect(heard)
			.toHaveLength(1)
	})

	it('canEnter is read-only: it writes nothing and emits nothing, and says which steps are reachable', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		const { heard } = listen(root, ['stepChanged', 'completed'])
		expect(valueOf(root.methods.canEnter(0)))
			.toBe(true)
		expect(valueOf(root.methods.canEnter(1)))
			.toBe(false)
		completeFirstThreeSteps(runtime)
		expect(valueOf(root.methods.canEnter(3)))
			.toBe(true)
		expect(valueOf(root.methods.canEnter(4)))
			.toBe(false)
		expect(root.state.current.get())
			.toBe(0)
		expect(heard)
			.toEqual([])
	})

	it('is the only Method of the document that is read-only: Core derives W (writes State) and E (emits an Event) for every other one', () => {
		const blueprint = onboardingSystem.createBlueprint(JSON.parse(defaultOnboardingPreset.sourceText))
		const effects = Object.fromEntries(inspectBlueprint(blueprint).nodes.flatMap(node => node.resolved
			? node.methods.map(method => [`${node.node.id}.${method.name}`, { writes: method.transitivelyWrites, emits: method.transitivelyEmits }] as const)
			: []))
		expect(effects)
			.toEqual({
				'onboarding.canEnter': { writes: false, emits: false },
				'onboarding.next': { writes: true, emits: true },
				'onboarding.back': { writes: true, emits: true },
				'onboarding.goTo': { writes: true, emits: true },
				'onboarding.finish': { writes: true, emits: true },
				'induction.requestSlot': { writes: true, emits: true },
				'induction.settleBooking': { writes: true, emits: true },
				'induction.cancelBooking': { writes: true, emits: true },
			})
	})
})

describe('onboarding: goTo argument validation and refused jumps', () => {
	it.each([
		[[1.5], 'not-a-whole-number'],
		[[Number.NaN], 'not-a-whole-number'],
		[['2'], 'not-a-whole-number'],
		[[null], 'not-a-whole-number'],
		[[-1], 'negative-index'],
		[[], 'wrong-arity'],
		[[1, 2], 'wrong-arity'],
	] as const)('rejects goTo(...%j) as invalid-method-arguments (%s) before execute runs', (args, reason) => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		const { heard } = listen(root, ['stepChanged'])
		const result = (root.methods.goTo as (...values: unknown[]) => { readonly ok: boolean })(...args)
		expect(result.ok)
			.toBe(false)
		expect(failureOf(root.methods.goTo))
			.toEqual([{ code: 'invalid-method-arguments', reason }])
		expect(root.state.current.get())
			.toBe(0)
		expect(heard)
			.toEqual([])
	})

	it('reports where in the arguments the problem is', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		root.methods.goTo(2.5)
		expect(root.methods.goTo.getDiagnostics()[0])
			.toMatchObject({ code: 'invalid-method-arguments', path: [0], message: 'goTo(index): index must be a whole number, got 2.5.' })
	})

	it('leaves range and lock checks to execute: a step that does not exist or is locked is invalid-method-result', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		expect(root.methods.goTo(9).ok)
			.toBe(false)
		expect(failureOf(root.methods.goTo))
			.toEqual([{ code: 'invalid-method-result', reason: 'no-such-step' }])
		expect(root.methods.goTo(2).ok)
			.toBe(false)
		expect(failureOf(root.methods.goTo))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-locked' }])
		expect(root.methods.goTo.getDiagnostics()[0]?.message)
			.toBe('Step 2 ("safety") is locked: finish the steps before it first.')
		expect(root.state.current.get())
			.toBe(0)
	})

	it('jumps to a reachable step, emits stepChanged by "jump" and clears the failure; the same step is a quiet no-op', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		completeFirstThreeSteps(runtime)
		root.methods.goTo(-1)
		const { heard } = listen(root, ['stepChanged'])
		expect(valueOf(root.methods.goTo(3)))
			.toBe(3)
		expect(root.methods.goTo.getDiagnostics())
			.toEqual([])
		expect(heard)
			.toEqual([{ name: 'stepChanged', args: [{ from: 'account', to: 'induction', fromIndex: 0, toIndex: 3, by: 'jump' }] }])
		expect(valueOf(root.methods.goTo(3)))
			.toBe(3)
		expect(heard)
			.toHaveLength(1)
	})
})

describe('onboarding: finish and the completed Event', () => {
	it('refuses to finish while a step is incomplete and names it', () => {
		const { runtime } = createOnboardingRuntime()
		const { root } = widgetsOf(runtime)
		completeFirstThreeSteps(runtime)
		const { heard } = listen(root, ['completed'])
		expect(root.methods.finish().ok)
			.toBe(false)
		expect(root.methods.finish.getDiagnostics()[0])
			.toMatchObject({ code: 'invalid-method-result', reason: 'steps-incomplete', message: 'The "induction" step is not complete yet, so the wizard cannot be finished.' })
		expect(root.state.finished.get())
			.toBe(false)
		expect(heard)
			.toEqual([])
	})

	it('emits completed once with every step\'s answers, and refuses every further move', () => {
		const { runtime } = createPresetRuntime('onboarding-ready-to-book')
		const { root, induction } = widgetsOf(runtime)
		induction.methods.requestSlot('2026-12-05', '10:00')
		induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-1' })
		const { heard } = listen(root, ['completed', 'stepChanged'])
		expect(valueOf(root.methods.finish()))
			.toBe(true)
		expect(heard)
			.toEqual([{
				name: 'completed',
				args: [{
					answers: {
						account: { name: 'Sam Rivera', email: 'sam@example.org' },
						interests: ['woodwork', 'ceramics'],
						safety: ['shoes', 'machines', 'exits'],
						induction: { slot: { date: '2026-12-05', time: '10:00' }, reference: 'TM-1' },
					},
				}],
			}])
		expect(root.state.finished.get())
			.toBe(true)
		for (const method of [root.methods.finish, root.methods.back, root.methods.next]) {
			expect(method().ok)
				.toBe(false)
			expect(failureOf(method))
				.toEqual([{ code: 'invalid-method-result', reason: 'already-finished' }])
		}
		expect(root.methods.goTo(0).ok)
			.toBe(false)
		expect(heard)
			.toHaveLength(1)
	})
})

describe('onboarding: the deep-link preset', () => {
	it('opens on the induction with nothing filled in: going forward is refused, going back is not', () => {
		const { runtime } = createPresetRuntime('onboarding-deep-link')
		const { root } = widgetsOf(runtime)
		expect(root.state.current.get())
			.toBe(3)
		expect(root.methods.next().ok)
			.toBe(false)
		expect(failureOf(root.methods.next))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-incomplete' }])
		expect(root.methods.goTo(0).ok)
			.toBe(true)
		expect(root.state.current.get())
			.toBe(0)
		expect(root.methods.goTo(3).ok)
			.toBe(false)
		expect(failureOf(root.methods.goTo))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-locked' }])
	})
})
