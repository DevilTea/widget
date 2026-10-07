/**
 * Type-level conformance — plugin builder phase-order diagnostics (issue #162, Discussion #12
 * "Plugin builder phase order stays fixed; out-of-order calls get self-explaining type errors").
 *
 * The outer builder order is fixed. A declared phase called at the wrong position (too early, too
 * late, or repeated) must fail type-checking at the misplaced call with an order marker, never advance
 * the chain, and not add implicit-`any` follow-on errors on the callbacks passed to it. An undeclared
 * phase keeps the plain "does not exist" error. Tests pin which phase the marker reports, never its
 * wording. Misplaced calls live inside never-invoked functions: the runtime builder is order-agnostic
 * and these cases only exist to be type-checked.
 *
 * Each `@ts-expect-error` sits directly above the misplaced call's first argument (where the order
 * error is reported) while any callback body spans the following lines, so an extra implicit-`any`
 * error inside the callback would be unsuppressed and fail the type-check.
 */

import type {
	WidgetInterfaces,
	WidgetPlugin,
	WidgetPluginConfigPhase,
	WidgetPluginDonePhase,
	WidgetPluginEventsPhase,
	WidgetPluginMethodsPhase,
	WidgetPluginPhaseOrderViolation,
	WidgetPluginPropertiesPhase,
	WidgetPluginSlotsPhase,
	WidgetPluginStatePhase,
} from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin } from './index'

interface AllInterfaces extends WidgetInterfaces {
	config: { raw: { label?: string }, resolved: { label: string } }
	slots: 'body'
	state: { count: number }
	properties: { doubled: number }
	methods: { reset: () => void }
	events: { changed: [value: number] }
}

interface StateAndEventsInterfaces extends WidgetInterfaces {
	state: { count: number }
	events: { changed: [value: number] }
}

interface EmptySlotsAndStateInterfaces extends WidgetInterfaces {
	slots: never
	state: { count: number }
}

interface StateOnlyInterfaces extends WidgetInterfaces {
	state: { count: number }
}

type Phase = 'config' | 'slots' | 'state' | 'properties' | 'methods' | 'events'

/** The reason carried by the order violation that a marker member requires of its first argument. */
type ReportedReason<Member> = Member extends (...args: infer Args) => unknown
	? Args[0] extends WidgetPluginPhaseOrderViolation<infer Reason> ? Reason : never
	: never

/** True when the marker's reason names `.Name()`; wording beyond the phase name is not pinned. */
type Names<Member, Name extends Phase | 'done'> = [ReportedReason<Member>] extends [never]
	? false
	: ReportedReason<Member> extends `${string}'.${Name}()'${string}` ? true : false

type ReportedPhase<Member> = Phase extends infer P
	? P extends Phase
		? ReportedReason<Member> extends `'.${P}()'${string}` ? P : never
		: never
	: never

/** Every non-callable declared phase is a marker that reports exactly its own phase name. */
type MarkerReports<Stage, Callable extends PropertyKey> = {
	[P in Exclude<keyof Stage & Phase, Callable>]: ReportedPhase<Stage[P]> extends P ? true : false
}

type AllTrue<T> = T[keyof T] extends true ? true : false

interface Stages {
	config: WidgetPluginConfigPhase<'p', AllInterfaces>
	slots: WidgetPluginSlotsPhase<'p', AllInterfaces>
	state: WidgetPluginStatePhase<'p', AllInterfaces>
	properties: WidgetPluginPropertiesPhase<'p', AllInterfaces>
	methods: WidgetPluginMethodsPhase<'p', AllInterfaces>
	events: WidgetPluginEventsPhase<'p', AllInterfaces>
}

describe('builder phase-order markers (type-level)', () => {
	it('exposes the callable phase plus a marker for every other declared phase, at every stage', () => {
		expectTypeOf<keyof Stages['config']>()
			.toEqualTypeOf<Phase>()
		expectTypeOf<keyof Stages['slots']>()
			.toEqualTypeOf<Phase>()
		expectTypeOf<keyof Stages['state']>()
			.toEqualTypeOf<Phase>()
		expectTypeOf<keyof Stages['properties']>()
			.toEqualTypeOf<Phase>()
		expectTypeOf<keyof Stages['methods']>()
			.toEqualTypeOf<Phase>()
		expectTypeOf<keyof WidgetPluginEventsPhase<'p', AllInterfaces>>()
			.toEqualTypeOf<Phase>()

		// After the last declared phase only `done` is real; every declared phase is a late marker.
		type AfterEvents = ReturnType<Stages['events']['events']>
		expectTypeOf<keyof AfterEvents>()
			.toEqualTypeOf<Phase | 'done'>()

		expectTypeOf<AllTrue<MarkerReports<Stages['config'], 'config'>>>()
			.toEqualTypeOf<true>()
		expectTypeOf<AllTrue<MarkerReports<Stages['slots'], 'slots'>>>()
			.toEqualTypeOf<true>()
		expectTypeOf<AllTrue<MarkerReports<Stages['state'], 'state'>>>()
			.toEqualTypeOf<true>()
		expectTypeOf<AllTrue<MarkerReports<Stages['properties'], 'properties'>>>()
			.toEqualTypeOf<true>()
		expectTypeOf<AllTrue<MarkerReports<Stages['methods'], 'methods'>>>()
			.toEqualTypeOf<true>()
		expectTypeOf<AllTrue<MarkerReports<AfterEvents, never>>>()
			.toEqualTypeOf<true>()
		expect(true)
			.toBe(true)
	})

	it('names the phase that must come first when a later declared phase is called too early', () => {
		expectTypeOf<Names<Stages['config']['events'], 'config'>>()
			.toEqualTypeOf<true>()
		expectTypeOf<Names<Stages['state']['events'], 'state'>>()
			.toEqualTypeOf<true>()
		expectTypeOf<Names<Stages['state']['methods'], 'state'>>()
			.toEqualTypeOf<true>()
		expectTypeOf<Names<Stages['properties']['events'], 'properties'>>()
			.toEqualTypeOf<true>()
		expectTypeOf<Names<Stages['methods']['events'], 'methods'>>()
			.toEqualTypeOf<true>()
	})

	it('does not report an unrelated phase', () => {
		expectTypeOf<Names<Stages['state']['events'], 'config'>>()
			.toEqualTypeOf<false>()
		expectTypeOf<Names<Stages['state']['methods'], 'events'>>()
			.toEqualTypeOf<false>()
	})

	it('names the phase called after its position, including a repeated call', () => {
		expectTypeOf<Names<Stages['properties']['state'], 'state'>>()
			.toEqualTypeOf<true>()
		expectTypeOf<Names<Stages['events']['methods'], 'methods'>>()
			.toEqualTypeOf<true>()
		expectTypeOf<Names<Stages['events']['properties'], 'properties'>>()
			.toEqualTypeOf<true>()
	})

	it('fails the misplaced call at the call site without implicit-any noise and keeps the chain unadvanced', () => {
		// Never invoked: the runtime builder accepts every order; this only has to type-check.
		const tooEarly = (afterState: Stages['state']): void => {
			afterState.events(
				// @ts-expect-error `events` is declared but must come after `properties` and `methods`
				(events) => {
					return events.changed({ description: 'changed' })
				},
			)
		}
		const tooEarlyMethods = (afterState: Stages['state']): void => {
			afterState.methods(
				// @ts-expect-error `methods` is declared but must come after `properties`
				(methods) => {
					return methods.reset({
						validateArgs: (args): args is [] => args.length === 0,
						execute: () => {},
					})
				},
			)
		}
		const tooLate = (afterProperties: Stages['properties']): void => {
			afterProperties.state(
				// @ts-expect-error `state` is declared but was already passed
				(state) => {
					return state.count({
						validate: (value): value is number => typeof value === 'number',
						default: () => 0,
					})
				},
			)
		}
		const repeated = (afterEvents: ReturnType<Stages['events']['events']>): void => {
			afterEvents.events(
				// @ts-expect-error `events` is declared but was already called
				(events) => {
					return events.changed({ description: 'changed' })
				},
			)
		}
		const tooEarlySlots = (afterInterfaces: Stages['config']): void => {
			afterInterfaces.slots(
				// @ts-expect-error `slots` is declared but must come after `config`
				{ body: { description: 'body' } },
			)
		}
		void [tooEarly, tooEarlyMethods, tooLate, repeated, tooEarlySlots]

		// A misplaced call returns the same phase: it neither advances nor makes `done` available.
		type AfterMisplaced = ReturnType<Stages['state']['events']>
		expectTypeOf<AfterMisplaced>()
			.not
			.toHaveProperty('done')
		expectTypeOf<AfterMisplaced>()
			.toHaveProperty('state')
		expect(true)
			.toBe(true)
	})

	it('keeps an undeclared capability phase as a plain missing member', () => {
		type AfterState = WidgetPluginStatePhase<'p', StateAndEventsInterfaces>
		expectTypeOf<keyof AfterState>()
			.toEqualTypeOf<'state' | 'events'>()
		expectTypeOf<AfterState>()
			.not
			.toHaveProperty('methods')

		const undeclared = (afterState: AfterState): void => {
			// @ts-expect-error `methods` is not declared, so the member genuinely does not exist
			afterState.methods(() => {})
		}
		void undeclared
		expect(true)
			.toBe(true)
	})

	it('treats explicit-empty `slots: never` as a declared phase with order markers', () => {
		type AfterInterfaces = WidgetPluginSlotsPhase<'p', EmptySlotsAndStateInterfaces>
		expectTypeOf<keyof AfterInterfaces>()
			.toEqualTypeOf<'slots' | 'state'>()
		expectTypeOf<Names<AfterInterfaces['state'], 'slots'>>()
			.toEqualTypeOf<true>()

		const plugin = createWidgetPlugin('empty-slots')
			.description('Test widget')
			.interfaces<EmptySlotsAndStateInterfaces>()
			.slots({})
			.state(state => state.count({
				validate: (value): value is number => typeof value === 'number',
				default: () => 0,
			}))
			.done()
		expectTypeOf(plugin)
			.toEqualTypeOf<WidgetPlugin<'empty-slots', EmptySlotsAndStateInterfaces>>()
	})

	it('adds no markers when a single capability is declared, so valid-only surfaces are unchanged', () => {
		expectTypeOf<keyof WidgetPluginStatePhase<'p', StateOnlyInterfaces>>()
			.toEqualTypeOf<'state'>()
		// Past the only declared phase, `done` is real and the repeated `state` is a late marker.
		type AfterState = ReturnType<WidgetPluginStatePhase<'p', StateOnlyInterfaces>['state']>
		expectTypeOf<keyof AfterState>()
			.toEqualTypeOf<'state' | 'done'>()
		expectTypeOf<AfterState['done']>()
			.toEqualTypeOf<WidgetPluginDonePhase<'p', StateOnlyInterfaces>['done']>()
	})

	it('leaves correct chains, including skipped optional phases, with unchanged inferred types', () => {
		const full = createWidgetPlugin('full')
			.description('Test widget')
			.interfaces<AllInterfaces>()
			.config({
				description: 'config',
				validate: (input): input is { label?: string } => typeof input === 'object' && input !== null,
				resolve: raw => ({ label: raw?.label ?? '' }),
			})
			.slots({ body: { description: 'body' } })
			.state(state => state.count({
				validate: (value): value is number => typeof value === 'number',
				default: () => 0,
			}))
			.properties(properties => properties.doubled({ compute: () => 0 }))
			.methods(methods => methods.reset({
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => {},
			}))
			.events(events => events.changed({ description: 'changed' }))
			.done()
		expectTypeOf(full)
			.toEqualTypeOf<WidgetPlugin<'full', AllInterfaces>>()

		const skipping = createWidgetPlugin('skipping')
			.description('Test widget')
			.interfaces<StateAndEventsInterfaces>()
			.state(state => state.count({
				validate: (value): value is number => typeof value === 'number',
				default: () => 0,
			}))
			.events(events => events.changed({ description: 'changed' }))
			.done()
		expectTypeOf(skipping)
			.toEqualTypeOf<WidgetPlugin<'skipping', StateAndEventsInterfaces>>()

		expect(full.capabilities)
			.toEqual({ config: true, slots: true, state: true, properties: true, methods: true, events: true })
		expect(skipping.type)
			.toBe('skipping')
	})
})
