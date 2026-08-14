/**
 * `useWidget(Plugin)` — the single renderer-facing bridge boundary.
 *
 * Normative source: issue #13 checkpoints C, C addendum, D (both parts), E, F, G.
 */

import type { AnyWidgetPlugin } from '@deviltea/widget-core'
import type { CurrentWidgetContextValue, RuntimeWidgetLike } from './context'
import type { UseWidgetResult } from './types'
import { inject, onScopeDispose } from 'vue'
import { createIssuesRef, createLazyKeyedSurface, createMethodWrapper, createPropertyRef, createStateRef } from './bridge'
import { CurrentWidgetContextKey } from './context'
import { WidgetVueIntegrationError } from './errors'
import { SharedWidgetSlotComponent } from './renderer'

function assertWidgetMatchesPlugin(widget: RuntimeWidgetLike, plugin: AnyWidgetPlugin): void {
	if (widget.blueprint.plugin !== plugin) {
		throw new WidgetVueIntegrationError(
			`useWidget() was called with plugin type "${plugin.type}", but the currently rendered widget ("${widget.id}") is of type "${widget.type}" (a different plugin instance, even if the type string matched).`,
		)
	}
}

function getCurrentWidgetContext(): CurrentWidgetContextValue {
	// Vue's `inject()` returns `undefined` (ignoring the supplied default) rather than `null` when
	// called with no active component instance at all — not just "no matching provide()" — so both
	// must be treated as "no context" here.
	const current = inject(CurrentWidgetContextKey, null)
	if (current === null || current === undefined) {
		throw new WidgetVueIntegrationError(
			'useWidget() was called outside a widget renderer component rendered by a WidgetRenderer produced by createWidgetVueRenderer().',
		)
	}
	return current
}

/**
 * Capability presence is read from `plugin.capabilities` — the compiler/plugin-builder-authoritative
 * declaration-presence facts (issue #10 amendment "declaration-presence semantics and public
 * `WidgetPlugin.capabilities`") — never inferred from Blueprint/Runtime object shape. This is required
 * for correctness, not just directness: an explicitly-declared-empty capability (`slots: never`,
 * `state: Record<never, never>`, ...) is present despite an empty/`never` payload, and shape-based
 * heuristics (member-key counts, semantic-slot-map key counts) cannot distinguish that from absence.
 */
function buildUseWidgetResult(widget: RuntimeWidgetLike, plugin: AnyWidgetPlugin): Record<string, unknown> {
	const cleanups: Array<() => void> = []
	onScopeDispose(() => {
		for (const cleanup of cleanups)
			cleanup()
	})
	const registerCleanup = (cleanup: () => void): void => {
		cleanups.push(cleanup)
	}

	const result: Record<string, unknown> = Object.create(null)
	const capabilities = plugin.capabilities

	if (capabilities.state) {
		const state = widget.state!
		let surface: Readonly<Record<string, unknown>> | undefined
		result.useState = () => surface ??= createLazyKeyedSurface((key) => {
			const primitive = state[key]
			return primitive === undefined ? undefined : createStateRef(primitive, registerCleanup)
		})

		let issuesSurface: Readonly<Record<string, unknown>> | undefined
		result.useStateIssues = () => issuesSurface ??= createLazyKeyedSurface((key) => {
			const primitive = state[key]
			return primitive === undefined ? undefined : createIssuesRef(primitive.getIssues, primitive.subscribeIssues, registerCleanup)
		})
	}

	if (capabilities.properties) {
		const properties = widget.properties!
		let surface: Readonly<Record<string, unknown>> | undefined
		result.useProperties = () => surface ??= createLazyKeyedSurface((key) => {
			const primitive = properties[key]
			return primitive === undefined ? undefined : createPropertyRef(primitive, registerCleanup)
		})

		let issuesSurface: Readonly<Record<string, unknown>> | undefined
		result.usePropertyIssues = () => issuesSurface ??= createLazyKeyedSurface((key) => {
			const primitive = properties[key]
			return primitive === undefined ? undefined : createIssuesRef(primitive.getIssues, primitive.subscribeIssues, registerCleanup)
		})
	}

	if (capabilities.methods) {
		const methods = widget.methods!
		let surface: Readonly<Record<string, unknown>> | undefined
		result.useMethods = () => surface ??= createLazyKeyedSurface((key) => {
			const primitive = methods[key]
			return primitive === undefined ? undefined : createMethodWrapper(primitive)
		})

		let issuesSurface: Readonly<Record<string, unknown>> | undefined
		result.useMethodIssues = () => issuesSurface ??= createLazyKeyedSurface((key) => {
			const primitive = methods[key]
			return primitive === undefined ? undefined : createIssuesRef(primitive.getIssues, primitive.subscribeIssues, registerCleanup)
		})
	}

	let widgetIssuesRef: unknown
	result.useIssues = () => widgetIssuesRef ??= createIssuesRef(widget.getIssues, widget.subscribeIssues, registerCleanup)

	if (capabilities.slots)
		result.WidgetSlot = SharedWidgetSlotComponent

	return result
}

/**
 * The single widget-scoped bridge entry point. `plugin` is both the compile-time type witness (its
 * declared `WidgetInterfaces` drive every accessor's exact shape) and a runtime exact-identity
 * assertion token: the currently injected `RuntimeWidget` must belong to this exact plugin instance,
 * not merely share its `type` string.
 *
 * Must be called during the `setup()` of a component rendered as the registered renderer for some
 * widget (directly, or transitively through `WidgetSlot`); calling it anywhere else throws
 * `WidgetVueIntegrationError`.
 */
export function useWidget<Plugin extends AnyWidgetPlugin>(plugin: Plugin): UseWidgetResult<Plugin> {
	const current = getCurrentWidgetContext()
	assertWidgetMatchesPlugin(current.widget, plugin)
	return buildUseWidgetResult(current.widget, plugin) as unknown as UseWidgetResult<Plugin>
}
