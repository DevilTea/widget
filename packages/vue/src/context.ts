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

import type { Component, InjectionKey } from 'vue'

export interface RuntimeStateLike {
	get: () => unknown
	set: (value: unknown) => { readonly success: boolean }
	subscribe: (listener: (value: unknown) => void) => () => void
	getIssues: () => readonly unknown[]
	subscribeIssues: (listener: (issues: readonly unknown[]) => void) => () => void
}

export interface RuntimePropertyLike {
	get: () => { readonly success: boolean, readonly value?: unknown }
	subscribe: (listener: (result: unknown) => void) => () => void
	getIssues: () => readonly unknown[]
	subscribeIssues: (listener: (issues: readonly unknown[]) => void) => () => void
}

export type RuntimeMethodLike = ((...args: readonly unknown[]) => { readonly success: boolean, readonly value?: unknown }) & {
	getIssues: () => readonly unknown[]
	subscribeIssues: (listener: (issues: readonly unknown[]) => void) => () => void
}

export interface RuntimeWidgetLike {
	readonly id: string
	readonly type: string
	readonly blueprint: {
		readonly plugin: unknown
		readonly slots: Readonly<Record<string, readonly { readonly id: string }[]>>
	}
	getIssues: () => readonly unknown[]
	subscribeIssues: (listener: (issues: readonly unknown[]) => void) => () => void
	readonly state?: Readonly<Record<string, RuntimeStateLike>>
	readonly properties?: Readonly<Record<string, RuntimePropertyLike>>
	readonly methods?: Readonly<Record<string, RuntimeMethodLike>>
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
