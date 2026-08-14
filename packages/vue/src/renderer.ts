/**
 * Renderer registry builder, recursive internal host, and the shared `WidgetSlot` component.
 *
 * Normative source: issue #13 checkpoints B, D, E, F.
 */

import type { AnyWidgetPluginTuple, WidgetPluginTypeOf, WidgetSystem, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { Component, PropType } from 'vue'
import type { RuntimeLike, RuntimeWidgetLike } from './context'
import { defineComponent, h, inject, provide } from 'vue'
import { CurrentWidgetContextKey } from './context'
import { WidgetVueIntegrationError } from './errors'

// -------------------------------------------------------------------------------------------------
// Registry builder typestate
// -------------------------------------------------------------------------------------------------

/**
 * Framework-private phantom completion marker, mirroring `@deviltea/widget-core`'s plugin-builder
 * section typestate: it exists purely so an empty object literal (`{}`) can never accidentally
 * satisfy a completed registry section type.
 */
const widgetVueRendererRemaining: unique symbol = Symbol('@deviltea/widget-vue:renderer-section-remaining')

export interface WidgetVueRendererSectionMarker<Remaining extends string> {
	readonly [widgetVueRendererRemaining]: Remaining
}

/**
 * Keyed-chain renderer registry builder. `Remaining` starts as the bound `WidgetSystem`'s exact
 * plugin-type union and shrinks by one literal per registered key; the section can only be returned
 * from the `createWidgetVueRenderer` callback once `Remaining` has been reduced to `never`.
 *
 * A registered key narrows to a plain Vue `Component` — per issue #13 checkpoint E, a renderer
 * component carries no static brand proving which plugin it calls `useWidget(...)` with, so the
 * registry cannot statically demand more than "some Vue component".
 */
export type WidgetVueRendererSection<Remaining extends string>
	= & WidgetVueRendererSectionMarker<Remaining>
		& {
			readonly [Type in Remaining]: (
				component: Component,
			) => WidgetVueRendererSection<Exclude<Remaining, Type>>
		}

/**
 * The renderer-key domain for one `WidgetSystem`. When the system's plugin-type union has been
 * broadened to plain `string` (an unsupported universe per issue #13 checkpoint B), `Remaining` never
 * reduces to `never` — `Exclude<string, AnyLiteral>` stays `string` — so the builder callback can never
 * type-check as complete and `createWidgetVueRenderer` cannot be called at all.
 */
export type WidgetVueRendererEntry<Plugins extends AnyWidgetPluginTuple> = WidgetVueRendererSection<WidgetPluginTypeOf<Plugins[number]>>

/**
 * The component `createWidgetVueRenderer` returns. `runtime` is the only semantic prop; per issue #13
 * checkpoint E the root renderer never accepts raw definitions, Blueprints, fallback renderers, or
 * loading/error slots.
 */
export interface WidgetVueRendererProps<Plugins extends AnyWidgetPluginTuple> {
	readonly runtime: WidgetSystemRuntime<Plugins>
}

export type WidgetVueRenderer<Plugins extends AnyWidgetPluginTuple> = new () => {
	$props: WidgetVueRendererProps<Plugins>
}

// -------------------------------------------------------------------------------------------------
// Registry builder implementation
// -------------------------------------------------------------------------------------------------

/**
 * Builds the keyed-chain registry proxy. Every call is recorded (not deduplicated) so construction can
 * later detect a key registered more than once, matching `createSection` in
 * `@deviltea/widget-core`'s `plugin.ts` for the same collision-safety (`__proto__` / `constructor` stay
 * legitimate, ordinary keys via `Map`/Proxy rather than plain-object semantics).
 */
function createRegistrySection(registrations: Map<string, Component[]>): unknown {
	const section: unknown = new Proxy({}, {
		get(_target, key) {
			if (typeof key !== 'string')
				return undefined

			return (component: Component) => {
				const existing = registrations.get(key)
				if (existing === undefined)
					registrations.set(key, [component])
				else
					existing.push(component)

				return section
			}
		},
	})

	return section
}

function quote(value: string): string {
	return `"${value}"`
}

/**
 * Vue vnode `key` only accepts a `PropertyKey`, not an arbitrary object, so a `WidgetSystemRuntime`
 * instance cannot be used as a `key` directly. This assigns one stable `symbol` per distinct Runtime
 * object identity (never per Runtime-shape-equality) the first time it is seen, giving the
 * remount-on-identity-change behavior issue #13 checkpoint E requires without leaking: entries are
 * held by a `WeakMap`, so a Runtime that is no longer referenced anywhere else is collected together
 * with its key.
 */
const runtimeIdentityKeys = new WeakMap<object, symbol>()

function keyForRuntime(runtime: object): symbol {
	let key = runtimeIdentityKeys.get(runtime)
	if (key === undefined) {
		key = Symbol('@deviltea/widget-vue:runtime-identity')
		runtimeIdentityKeys.set(runtime, key)
	}
	return key
}

interface ErasedRuntime {
	readonly blueprint: { readonly system: unknown, readonly root: { readonly id: string } }
	getWidget: (id: string) => RuntimeWidgetLike | null
}

/**
 * Validates exactly-once coverage against the actual bound `WidgetSystem` instance. Type-level
 * completeness is not sufficient because JS/`any` can bypass it (issue #13 checkpoint B); a violation
 * here is a programmer/configuration exception, never a Widget Issue.
 */
function finalizeRegistry(system: WidgetSystem<AnyWidgetPluginTuple>, registrations: Map<string, Component[]>): ReadonlyMap<string, Component> {
	const pluginTypes = new Set(system.plugins.map(plugin => plugin.type))

	const unknownTypes: string[] = []
	const duplicatedTypes: string[] = []

	for (const [type, components] of registrations) {
		if (!pluginTypes.has(type))
			unknownTypes.push(type)
		else if (components.length > 1)
			duplicatedTypes.push(type)
	}

	const missingTypes = [...pluginTypes].filter(type => !registrations.has(type))

	if (missingTypes.length > 0 || unknownTypes.length > 0 || duplicatedTypes.length > 0) {
		const parts: string[] = []
		if (missingTypes.length > 0) {
			parts.push(`missing renderer registration for plugin type(s) ${missingTypes.map(quote)
				.join(', ')}`)
		}
		if (unknownTypes.length > 0) {
			parts.push(`renderer registered for unknown plugin type(s) ${unknownTypes.map(quote)
				.join(', ')}`)
		}
		if (duplicatedTypes.length > 0) {
			parts.push(`plugin type(s) ${duplicatedTypes.map(quote)
				.join(', ')} registered more than once`)
		}

		throw new WidgetVueIntegrationError(`Invalid @deviltea/widget-vue renderer registry: ${parts.join('; ')}.`)
	}

	const rendererByType = new Map<string, Component>()
	for (const [type, components] of registrations) {
		const component = components[0]
		if (component !== undefined)
			rendererByType.set(type, component)
	}

	return rendererByType
}

// -------------------------------------------------------------------------------------------------
// Internal recursive host + shared WidgetSlot component
// -------------------------------------------------------------------------------------------------

function getCurrentWidgetContextOrThrow(source: string) {
	// Vue's `inject()` returns `undefined` (ignoring the supplied default) rather than `null` when
	// called with no active component instance at all — not just "no matching provide()" — so both
	// must be treated as "no context" here.
	const current = inject(CurrentWidgetContextKey, null)
	if (current === null || current === undefined) {
		throw new WidgetVueIntegrationError(
			`${source} was called outside a widget renderer component rendered by a WidgetRenderer produced by createWidgetVueRenderer().`,
		)
	}
	return current
}

/**
 * One internal host per rendered widget node. Provides `CurrentWidgetContext` (shadowed once per
 * host, so `useWidget(Plugin)` and `WidgetSlot` always resolve the nearest one) and renders the
 * registered component for that widget's exact plugin type. Never receives a `widget` prop on the
 * rendered* component — the rendered component only ever calls `useWidget(Plugin)`.
 */
const InternalWidgetHost = defineComponent({
	name: 'WidgetHost',
	props: {
		widget: { type: Object as PropType<RuntimeWidgetLike>, required: true },
		runtime: { type: Object as PropType<WidgetSystemRuntime<AnyWidgetPluginTuple>>, required: true },
		rendererByType: { type: Object as PropType<ReadonlyMap<string, Component>>, required: true },
	},
	setup(props) {
		// Topology is static for the lifetime of one Runtime (an immutable Blueprint), so this host's
		// props never change after creation; a plain snapshot is sufficient, no reactive indirection
		// needed.
		provide(CurrentWidgetContextKey, {
			widget: props.widget,
			runtime: props.runtime as unknown as RuntimeLike,
			rendererByType: props.rendererByType,
		})

		return () => {
			const ActualRenderer = props.rendererByType.get(props.widget.type)
			if (ActualRenderer === undefined) {
				throw new WidgetVueIntegrationError(
					`No renderer is registered for plugin type "${props.widget.type}". This should have been rejected at createWidgetVueRenderer() construction time.`,
				)
			}
			return h(ActualRenderer)
		}
	},
})

/**
 * The single shared `WidgetSlot` component identity (issue #13 checkpoint D). `useWidget(Plugin)`
 * never allocates a fresh component per widget/call — it returns this exact component, only narrowed
 * at the TypeScript level to the current widget's declared slot-name union.
 */
export const SharedWidgetSlotComponent = defineComponent({
	name: 'WidgetSlot',
	props: {
		name: { type: String, required: true },
	},
	setup(props) {
		const current = getCurrentWidgetContextOrThrow('WidgetSlot')

		return () => {
			const children = current.widget.blueprint.slots[props.name] ?? []

			return children.map((childNode) => {
				const childWidget = current.runtime.getWidget(childNode.id)
				if (childWidget === null) {
					throw new WidgetVueIntegrationError(
						`Widget "${childNode.id}" declared in slot "${props.name}" of widget "${current.widget.id}" was not found by the current Runtime.`,
					)
				}

				return h(InternalWidgetHost, {
					key: childNode.id,
					widget: childWidget,
					runtime: current.runtime as unknown as WidgetSystemRuntime<AnyWidgetPluginTuple>,
					rendererByType: current.rendererByType,
				})
			})
		}
	},
})

// -------------------------------------------------------------------------------------------------
// Root renderer component
// -------------------------------------------------------------------------------------------------

/**
 * `createWidgetVueRenderer(system, build)` — see issue #13 checkpoints B and E.
 *
 * The returned component is stable and bound to one exact `WidgetSystem` instance and one complete
 * immutable renderer registry. Mount-time (render-time) identity validates
 * `runtime.blueprint.system === system`; a Runtime from any other `WidgetSystem` is a
 * programmer/configuration exception, never a Widget Issue. A `runtime` prop identity change forces a
 * full unmount/remount of the internal host tree via a vnode `key` bound to the Runtime instance
 * itself, so every Vue bridge subscription activated under the previous Runtime is cleaned up. The
 * component never calls `runtime.dispose()` — Runtime lifetime stays owned by the caller.
 */
export function createWidgetVueRenderer<Plugins extends AnyWidgetPluginTuple>(
	system: WidgetSystem<Plugins>,
	build: (renderers: WidgetVueRendererEntry<Plugins>) => WidgetVueRendererSection<never>,
): WidgetVueRenderer<Plugins> {
	const registrations = new Map<string, Component[]>()
	const section = createRegistrySection(registrations)
	build(section as unknown as WidgetVueRendererEntry<Plugins>)

	const rendererByType = finalizeRegistry(system as unknown as WidgetSystem<AnyWidgetPluginTuple>, registrations)

	const component = defineComponent({
		name: 'WidgetRenderer',
		props: {
			runtime: { type: Object as PropType<WidgetSystemRuntime<Plugins>>, required: true },
		},
		setup(props) {
			return () => {
				// Erase the precise `Plugins` generic immediately: `ResolvedBlueprintWidgetNode<Plugins>`
				// is a distributive conditional type over a still-generic `Plugins`, which TypeScript
				// cannot narrow to a concrete member shape here — exactly why `@deviltea/widget-core`'s own
				// Runtime factory never touches such a type directly either, only through an erased view.
				const runtime = props.runtime as unknown as ErasedRuntime
				if (runtime.blueprint.system !== system) {
					throw new WidgetVueIntegrationError(
						'The `runtime` prop passed to this WidgetRenderer was not created from the exact WidgetSystem instance it is bound to.',
					)
				}

				const rootPublicNode = runtime.blueprint.root
				const rootWidget = runtime.getWidget(rootPublicNode.id)
				if (rootWidget === null) {
					throw new WidgetVueIntegrationError(`The supplied runtime has no root widget for id "${rootPublicNode.id}".`)
				}

				return h(InternalWidgetHost, {
					key: keyForRuntime(props.runtime),
					widget: rootWidget,
					runtime: runtime as unknown as WidgetSystemRuntime<AnyWidgetPluginTuple>,
					rendererByType,
				})
			}
		},
	})

	return component as unknown as WidgetVueRenderer<Plugins>
}
