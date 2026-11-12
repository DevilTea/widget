/**
 * Private Vue injection context linking the recursive renderer host tree to `useWidget()`.
 *
 * Not part of the public contract: renderer authors never import or `provide()` this key themselves.
 * `@deviltea/widget-vue` owns every `provide()` call for it (in the internal widget host component);
 * renderer authors only ever `inject()` it indirectly, through `useWidget(Plugin)` /
 * `useWidget(Plugin).WidgetSlot`.
 *
 * Every field here is deliberately erased to `unknown`/structural-minimal shapes. The precise
 * `RuntimeWidgetFor<Plugin, Plugins>` / `WidgetSystemRuntime<Plugins>` generics are only restored at
 * the public `useWidget()` / `createWidgetVueRenderer()` boundaries, mirroring how
 * `@deviltea/widget-core` itself keeps its own internal Runtime plumbing untyped and only re-attaches
 * precise generics at its public surface.
 */

import type { RuntimeEvent, RuntimeMethod, RuntimeProperty, RuntimeState, RuntimeWidget, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { Component, InjectionKey } from 'vue'
import { provide } from 'vue'

export interface RuntimeStateLike {
	get: () => unknown
	set: (value: unknown) => { readonly ok: boolean }
	subscribe: (listener: (value: unknown) => void) => () => void
	getDiagnostics: () => readonly unknown[]
	subscribeDiagnostics: (listener: (diagnostics: readonly unknown[]) => void) => () => void
}

export interface RuntimePropertyLike {
	get: () => { readonly ok: boolean, readonly value?: unknown }
	subscribe: (listener: (result: unknown) => void) => () => void
	getDiagnostics: () => readonly unknown[]
	subscribeDiagnostics: (listener: (diagnostics: readonly unknown[]) => void) => () => void
}

export type RuntimeMethodLike = ((...args: readonly unknown[]) => { readonly ok: boolean, readonly value?: unknown }) & {
	getDiagnostics: () => readonly unknown[]
	subscribeDiagnostics: (listener: (diagnostics: readonly unknown[]) => void) => () => void
}

export interface RuntimeEventLike {
	subscribe: (listener: (...args: readonly unknown[]) => void) => () => void
}

export interface RuntimeWidgetLike {
	readonly id: string
	readonly type: string
	readonly blueprint: {
		readonly plugin: unknown
		readonly config?: unknown
		readonly slots: Readonly<Record<string, readonly { readonly id: string }[]>>
	}
	getDiagnostics: () => readonly unknown[]
	subscribeDiagnostics: (listener: (diagnostics: readonly unknown[]) => void) => () => void
	readonly state?: Readonly<Record<string, RuntimeStateLike>>
	readonly properties?: Readonly<Record<string, RuntimePropertyLike>>
	readonly methods?: Readonly<Record<string, RuntimeMethodLike>>
	readonly events?: Readonly<Record<string, RuntimeEventLike>>
}

export interface RuntimeLike {
	readonly blueprint: { readonly system: unknown }
	getWidget: (id: string) => RuntimeWidgetLike | null
}

export interface CurrentWidgetContextValue {
	readonly widget: RuntimeWidgetLike
	readonly runtime: RuntimeLike
	readonly rendererByType: ReadonlyMap<string, Component>
}

export const CurrentWidgetContextKey: InjectionKey<CurrentWidgetContextValue> = Symbol('@deviltea/widget-vue:current-widget-context')

/**
 * The one place a widget context is constructed and provided: the internal host used by the real
 * renderer and the `./testing` host both call it, so a component under test sees exactly the context
 * the real renderer would give it. Must be called during `setup()`.
 */
export function provideCurrentWidgetContext(widget: RuntimeWidgetLike, runtime: unknown, rendererByType: ReadonlyMap<string, Component>): void {
	provide(CurrentWidgetContextKey, {
		widget,
		runtime: runtime as RuntimeLike,
		rendererByType,
	})
}

// -------------------------------------------------------------------------------------------------
// Compile-time conformance with `@deviltea/widget-core`
// -------------------------------------------------------------------------------------------------

type Assignable<From, To> = [From] extends [To] ? true : false
type MustBeTrue<Check extends true> = Check

/**
 * The `*Like` shapes above deliberately re-declare only what this package reads. These checks make
 * core's real Runtime types assignable to them at compile time, so renaming or reshaping a member in
 * core fails `typecheck` here instead of surfacing as an unchecked-cast runtime failure. Type-only
 * (erased from the build) and not re-exported from the public entry.
 */
export type RuntimeLikeConformance = [
	MustBeTrue<Assignable<RuntimeState<unknown>, RuntimeStateLike>>,
	MustBeTrue<Assignable<RuntimeProperty<unknown>, RuntimePropertyLike>>,
	MustBeTrue<Assignable<RuntimeMethod<(...args: any[]) => unknown>, RuntimeMethodLike>>,
	MustBeTrue<Assignable<RuntimeEvent<readonly unknown[]>, RuntimeEventLike>>,
	MustBeTrue<Assignable<RuntimeWidget, RuntimeWidgetLike>>,
	MustBeTrue<Assignable<WidgetSystemRuntime, RuntimeLike>>,
]
