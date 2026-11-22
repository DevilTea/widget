/**
 * Widget Lab sandbox plugins.
 *
 * These are test-only fixtures (hidden from the Examples menu, opened with `?showcase=sandbox`) for
 * exercising the Lab shell (workbench, Apply lifecycle, Blueprint Inspector, Preview) — deliberately
 * small and private to `widget-lab`, not a showcase; see this app's `AGENTS.md` for the boundary. Every
 * plugin is built exclusively through `@deviltea/widget-core`'s public `createWidgetPlugin` contract.
 */

import type { WidgetChild, WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// -------------------------------------------------------------------------------------------------
// Text — config-driven leaf. Demonstrates the config -> property projection pattern: `useWidget()`
// exposes no config accessor, so a plugin that wants config-derived reactive display re-projects it
// through a Property.
// -------------------------------------------------------------------------------------------------

/** Sandbox text widget. */
export interface TextInterfaces extends WidgetInterfaces {
	/** Sandbox text configuration. */
	config: {
		raw: {
			/** The text the widget shows. */
			text: string
		}
		resolved: { text: string }
	}
	properties: {
		/** The configured text, projected so a renderer can read it. */
		content: string
	}
}

export const TextPlugin = createWidgetPlugin('Text')
	.interfaces<TextInterfaces>()
	.config({
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

/** Sandbox counter widget. */
export interface CounterInterfaces extends WidgetInterfaces {
	state: {
		/** The current count, a finite number. Starts at 0. */
		count: number
	}
	properties: {
		/** Twice the count. */
		doubled: number
	}
	methods: {
		/**
		 * Adds `step` to the count.
		 *
		 * @param step - The amount to add.
		 * @returns The new count.
		 */
		increment: (step: number) => number
		/** Sets the count back to 0. */
		reset: () => void
	}
}

export const CounterPlugin = createWidgetPlugin('Counter')
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

/** Sandbox section widget. */
export interface SectionInterfaces extends WidgetInterfaces {
	/** Sandbox section configuration. */
	config: {
		raw: {
			/** The section heading. Defaults to "Section". */
			title?: string
		}
		resolved: { title: string }
	}
	slots: {
		/** Sandbox section body. */
		body: WidgetChild
	}
	properties: {
		/** The configured heading. */
		heading: string
	}
}

export const SectionPlugin = createWidgetPlugin('Section')
	.interfaces<SectionInterfaces>()
	.config({
		validate: (input): input is { title?: string } =>
			isPlainObject(input) && (input.title === undefined || typeof input.title === 'string'),
		resolve: raw => ({ title: raw?.title ?? 'Section' }),
	})
	.slots({ body: {} })
	.properties(properties =>
		properties.heading({
			compute: ({ config }) => config.title,
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// Stack — one declared slot ("items") for an arbitrary-length list of children. No config/state.
// -------------------------------------------------------------------------------------------------

/** Sandbox stack widget. */
export interface StackInterfaces extends WidgetInterfaces {
	slots: {
		/** Sandbox stack items. */
		items: WidgetChild
	}
}

export const StackPlugin = createWidgetPlugin('Stack')
	.interfaces<StackInterfaces>()
	.slots({ items: {} })
	.done()

// -------------------------------------------------------------------------------------------------
// Summary — cross-widget dependency via `registerDeps` + `dep.widget(id)`, where the target id comes
// from this widget's own resolved config. Demonstrates a genuine cross-widget Property dependency, and
// (via the "invalid-semantic" preset) the Blueprint-invalid case when `counterId` names no widget.
// -------------------------------------------------------------------------------------------------

/** Sandbox summary widget. */
export interface SummaryInterfaces extends WidgetInterfaces {
	/** Sandbox summary configuration. */
	config: {
		raw: {
			/**
			 * The id of the Counter whose doubled count is shown.
			 *
			 * @widgetRef Counter
			 */
			counterId: string
		}
		resolved: { counterId: string }
	}
	properties: {
		/** The doubled count of the referenced Counter; 0 when it cannot be read. */
		total: number
	}
}

export const SummaryPlugin = createWidgetPlugin('Summary')
	.interfaces<SummaryInterfaces>()
	.config({
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
