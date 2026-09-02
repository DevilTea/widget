/**
 * Regression coverage for PR #12 round-2 review finding 3773696034 (`runtime/index.ts` full Blueprint
 * object leaked as `ctx.blueprint`).
 *
 * `compute`/`execute` are typed against `ValidBlueprintView` (`root`/`getWidget`/`getParent`/
 * `getLocation`/`getChildren`/`getChildrenAt` — navigation only), but the implementation used to pass
 * the *full* `ValidWidgetSystemBlueprint` object through as `blueprintView`, relying entirely on that
 * static type to keep callbacks away from `system`, `source`, `recompile()`,
 * `getDiagnostics()` and `createRuntime()`. Plain JS / `any` inside a callback could reach all of
 * those, obtaining Runtime machinery and full-Blueprint capabilities from inside a semantic callback —
 * bypassing the callback capability matrix and the intended dependency-only interaction boundary.
 *
 * These assertions deliberately go through `(ctx.blueprint as any).<member>` to simulate that JS/`any`
 * escape hatch and prove the *runtime object itself* — not just its static type — withholds the
 * forbidden members.
 *
 * Normative source: diagnostic #10 consolidated handoff callback capability matrix.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface BlueprintViewInterfaces {
	properties: {
		probeProperty: unknown
	}
	methods: {
		probeMethod: () => unknown
	}
}

function createHarness() {
	const plugin = createWidgetPlugin('blueprint-view-probe')
		.description('Test widget')
		.interfaces<BlueprintViewInterfaces>()
		.properties(properties => properties.probeProperty({
			compute: (ctx) => {
				const blueprintAny = ctx.blueprint as unknown as Record<string, unknown>
				return {
					createRuntime: blueprintAny.createRuntime,
					recompile: blueprintAny.recompile,
					getDiagnostics: blueprintAny.getDiagnostics,
					system: blueprintAny.system,
					source: blueprintAny.source,
					status: blueprintAny.status,
					hasRoot: blueprintAny.root !== undefined,
					hasGetWidget: typeof blueprintAny.getWidget === 'function',
					hasGetParent: typeof blueprintAny.getParent === 'function',
					hasGetLocation: typeof blueprintAny.getLocation === 'function',
					hasGetChildren: typeof blueprintAny.getChildren === 'function',
					hasGetChildrenAt: typeof blueprintAny.getChildrenAt === 'function',
				}
			},
		}))
		.methods(methods => methods.probeMethod({
			validateArgs: (args): args is [] => args.length === 0,
			execute: (ctx) => {
				const blueprintAny = ctx.blueprint as unknown as Record<string, unknown>
				return {
					createRuntime: blueprintAny.createRuntime,
					isFrozen: Object.isFrozen(ctx.blueprint),
				}
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'blueprint-view-probe' })
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('Expected the "root" widget to exist.')

	return { widget }
}

describe('ctx.blueprint is a real restricted ValidBlueprintView facade, not the full Blueprint object (round-2 finding 3773696034)', () => {
	it('a Property compute cannot reach createRuntime/recompile/getDiagnostics/system/source/status through JS/any', () => {
		const { widget } = createHarness()

		const result = widget.properties.probeProperty.get()
		expect(result.ok)
			.toBe(true)
		if (!result.ok)
			throw new Error('Expected a ok result.')

		const probe = result.value as Record<string, unknown>
		expect(probe.createRuntime)
			.toBeUndefined()
		expect(probe.recompile)
			.toBeUndefined()
		expect(probe.getDiagnostics)
			.toBeUndefined()
		expect(probe.system)
			.toBeUndefined()
		expect(probe.source)
			.toBeUndefined()
		expect(probe.status)
			.toBeUndefined()

		// The intended navigation-only surface stays fully available.
		expect(probe.hasRoot)
			.toBe(true)
		expect(probe.hasGetWidget)
			.toBe(true)
		expect(probe.hasGetParent)
			.toBe(true)
		expect(probe.hasGetLocation)
			.toBe(true)
		expect(probe.hasGetChildren)
			.toBe(true)
		expect(probe.hasGetChildrenAt)
			.toBe(true)
	})

	it('a Method execute cannot reach createRuntime through JS/any either, and the view object is frozen', () => {
		const { widget } = createHarness()

		const result = widget.methods.probeMethod()
		expect(result.ok)
			.toBe(true)
		if (!result.ok)
			throw new Error('Expected a ok result.')

		const probe = result.value as Record<string, unknown>
		expect(probe.createRuntime)
			.toBeUndefined()
		expect(probe.isFrozen)
			.toBe(true)
	})

	it('navigation through the restricted view still resolves the same widget the full Blueprint would', () => {
		const { widget } = createHarness()

		const plugin = createWidgetPlugin('navigation-check')
			.description('Test widget')
			.interfaces<{ properties: { self: unknown } }>()
			.properties(properties => properties.self({
				compute: ctx => ctx.blueprint.getWidget('root')?.id ?? null,
			}))
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'navigation-check' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		const navWidget = runtime.getWidget('root')
		if (navWidget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		expect(navWidget.properties.self.get())
			.toEqual({ ok: true, value: 'root' })
		// Sanity: the original harness widget is unrelated but still independently functional.
		expect(widget.properties.probeProperty.get().ok)
			.toBe(true)
	})
})
