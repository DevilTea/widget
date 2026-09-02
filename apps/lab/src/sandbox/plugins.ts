/**
 * Widget Lab sandbox plugins.
 *
 * These are dev fixtures for exercising the Lab shell (workbench, Apply lifecycle, Blueprint
 * Inspector, Preview) — deliberately small and private to `widget-lab`. They are NOT the "Interactive
 * Survey" / "Product Prototype" showcases named in diagnostic #13's Checkpoint A (those are a later phase);
 * see this app's `AGENTS.md` for the boundary. Every plugin is built exclusively through
 * `@deviltea/widget-core`'s public `createWidgetPlugin` contract.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// -------------------------------------------------------------------------------------------------
// Text — config-driven leaf. Demonstrates the config -> property projection pattern: `useWidget()`
// exposes no config accessor, so a plugin that wants config-derived reactive display re-projects it
// through a Property.
// -------------------------------------------------------------------------------------------------

export interface TextInterfaces extends WidgetInterfaces {
	config: {
		raw: { text: string }
		resolved: { text: string }
	}
	properties: {
		content: string
	}
}

export const TextPlugin = createWidgetPlugin('Text')
	.description('Sandbox text widget')
	.interfaces<TextInterfaces>()
	.config({
		description: 'Sandbox text configuration',
		validate: (input): input is { text: string } => isPlainObject(input) && typeof input.text === 'string',
		resolve: raw => ({ text: raw?.text ?? '' }),
	})
	.properties(properties =>
		properties.content({
			compute: ({ config }) => config.text,
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// Counter — state + a self-dependent Property + Methods (one read-modify-write, one write-only).
// -------------------------------------------------------------------------------------------------

export interface CounterInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		increment: (step: number) => number
		reset: () => void
	}
}

export const CounterPlugin = createWidgetPlugin('Counter')
	.description('Sandbox counter widget')
	.interfaces<CounterInterfaces>()
	.state(state =>
		state.count({
			validate: (input): input is number => typeof input === 'number' && Number.isFinite(input),
			default: () => 0,
		}))
	.properties(properties =>
		properties.doubled({
			registerDeps: ({ dep }) => dep.self.state.get('count'),
			compute: ({ deps }) => {
				const result = deps()
				return (result.ok ? (result.value ?? 0) : 0) * 2
			},
		}))
	.methods(methods =>
		methods
			.increment({
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
				execute: ({ args: [step], deps }) => {
					const current = deps.count()
					const value = (current.ok ? (current.value ?? 0) : 0) + step
					deps.setCount(value)
					return value
				},
			})
			.reset({
				registerDeps: ({ dep }) => dep.self.state.set('count'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps(0)
				},
			}))
	.done()

// -------------------------------------------------------------------------------------------------
// Section — one declared slot ("body") plus a config-projected heading Property.
// -------------------------------------------------------------------------------------------------

export interface SectionInterfaces extends WidgetInterfaces {
	config: {
		raw: { title?: string }
		resolved: { title: string }
	}
	slots: 'body'
	properties: {
		heading: string
	}
}

export const SectionPlugin = createWidgetPlugin('Section')
	.description('Sandbox section widget')
	.interfaces<SectionInterfaces>()
	.config({
		description: 'Sandbox section configuration',
		validate: (input): input is { title?: string } =>
			isPlainObject(input) && (input.title === undefined || typeof input.title === 'string'),
		resolve: raw => ({ title: raw?.title ?? 'Section' }),
	})
	.slots({ body: { description: 'Sandbox section body' } })
	.properties(properties =>
		properties.heading({
			compute: ({ config }) => config.title,
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// Stack — one declared slot ("items") for an arbitrary-length list of children. No config/state.
// -------------------------------------------------------------------------------------------------

export interface StackInterfaces extends WidgetInterfaces {
	slots: 'items'
}

export const StackPlugin = createWidgetPlugin('Stack')
	.description('Sandbox stack widget')
	.interfaces<StackInterfaces>()
	.slots({ items: { description: 'Sandbox stack items' } })
	.done()

// -------------------------------------------------------------------------------------------------
// Summary — cross-widget dependency via `registerDeps` + `dep.widget(id)`, where the target id comes
// from this widget's own resolved config. Demonstrates a genuine cross-widget Property dependency, and
// (via the "invalid-semantic" preset) the Blueprint-invalid case when `counterId` names no widget.
// -------------------------------------------------------------------------------------------------

export interface SummaryInterfaces extends WidgetInterfaces {
	config: {
		raw: { counterId: string }
		resolved: { counterId: string }
	}
	properties: {
		total: number
	}
}

export const SummaryPlugin = createWidgetPlugin('Summary')
	.description('Sandbox summary widget')
	.interfaces<SummaryInterfaces>()
	.config({
		description: 'Sandbox summary configuration',
		validate: (input): input is { counterId: string } => isPlainObject(input) && typeof input.counterId === 'string',
		resolve: raw => ({ counterId: raw?.counterId ?? '' }),
	})
	.properties(properties =>
		properties.total({
			registerDeps: ({ dep, config }) =>
				dep.widget(config.counterId).properties.get('doubled')
					.validate((value): value is number => typeof value === 'number'),
			compute: ({ deps }) => {
				const result = deps()
				return result.ok ? (result.value ?? 0) : 0
			},
		}))
	.done()

export const sandboxPlugins = [TextPlugin, CounterPlugin, SectionPlugin, StackPlugin, SummaryPlugin] as const

export type SandboxPlugins = typeof sandboxPlugins
