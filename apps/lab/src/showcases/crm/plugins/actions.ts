/**
 * `Button` and `Modal` (checkpoint §2 "Reusable-style primitives"): the showcase's generic
 * action/overlay primitives. `Button.press()` registers and invokes exactly one configured no-argument
 * Method dependency — deliberately not an arbitrary action DSL, argument-binding language, command bus,
 * or editor action model (checkpoint §2). `Modal`'s `open` State drives renderer visibility only; its
 * body/footer slot subtree exists in the Runtime topology independently of whether it is currently
 * shown (checkpoint §3).
 *
 * Deviation from the checkpoint's literal capability list, applied deliberately and narrowly: `Button`
 * additionally declares `properties: { label, kind }`, a pure presentation-only projection of its own
 * resolved config (`compute: ({ config }) => config.label`/`config.kind`, no new dependency edges, no
 * behavior change) — the same pattern checkpoint A already used for `SurveySection`/`SurveyDateQuestion`
 * (`../survey/plugins/sections.ts`, `survey-questions.ts`). This is required because
 * `@deviltea/widget-vue`'s public `useWidget()` contract never exposes resolved `config` (diagnostic #13
 * checkpoints C/D) and a registered renderer component receives no per-instance props at all (verified
 * against `packages/widget/vue/src/renderer.ts`'s `h(ActualRenderer)` call) — `Button` is reused four
 * times in this showcase's preset (`reset-data`/`change-stage`/`save-stage`/`cancel-stage`) with no
 * other distinguishing slot/state, so without this projection every instance would be visually
 * identical. `Modal`/`Table`/`DetailPanel`/`BarChart`/`AppShell`/`Toolbar` stay exactly as the checkpoint
 * locked them: each is either a single preset instance (safe to give its renderer fixed, hardcoded
 * copy matching the preset's own config) or `Card`, whose three instances are already visually
 * distinguished by their differing slotted body content.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject } from '../domain'

// -------------------------------------------------------------------------------------------------
// Button
// -------------------------------------------------------------------------------------------------

export type ButtonKind = 'primary' | 'secondary' | 'danger'

export interface ButtonAction {
	readonly widgetId: string
	readonly method: string
}

export interface ButtonRawConfig {
	readonly label: string
	readonly kind?: ButtonKind
	readonly action: ButtonAction
}

export interface ButtonResolvedConfig {
	readonly label: string
	readonly kind: ButtonKind
	readonly action: ButtonAction
}

export interface ButtonInterfaces extends WidgetInterfaces {
	config: {
		raw: ButtonRawConfig
		resolved: ButtonResolvedConfig
	}
	properties: {
		label: string
		kind: ButtonKind
	}
	methods: {
		press: () => void
	}
}

function isButtonKind(value: unknown): value is ButtonKind {
	return value === 'primary' || value === 'secondary' || value === 'danger'
}

function isButtonAction(value: unknown): value is ButtonAction {
	return isPlainObject(value) && typeof value.widgetId === 'string' && typeof value.method === 'string'
}

export const ButtonPlugin = createWidgetPlugin('Button')
	.description('Button widget')
	.interfaces<ButtonInterfaces>()
	.config({
		description: 'Button configuration',
		validate: (input): input is ButtonRawConfig =>
			isPlainObject(input)
			&& typeof input.label === 'string'
			&& (input.kind === undefined || isButtonKind(input.kind))
			&& isButtonAction(input.action),
		resolve: raw => ({
			label: raw?.label ?? '',
			kind: raw?.kind ?? 'secondary',
			action: raw?.action ?? { widgetId: '', method: '' },
		}),
	})
	.properties(properties =>
		properties
			.label({ compute: ({ config }) => config.label })
			.kind({ compute: ({ config }) => config.kind }))
	.methods(methods =>
		methods.press({
			// One configured zero-arg Method dependency, resolved from config at Blueprint compile time
			// (checkpoint §2). Target failure propagates as an ordinary method-dependency failure the
			// instant `deps()` is called — this Method never re-validates or substitutes a fallback.
			registerDeps: ({ dep, config }) => dep.widget(config.action.widgetId).methods.invoke(config.action.method),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps()
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// Modal
// -------------------------------------------------------------------------------------------------

export interface ModalRawConfig {
	readonly title: string
}

export interface ModalInterfaces extends WidgetInterfaces {
	config: {
		raw: ModalRawConfig
		resolved: ModalRawConfig
	}
	slots: 'body' | 'footer'
	state: {
		open: boolean
	}
	methods: {
		open: () => void
		close: () => void
	}
}

export const ModalPlugin = createWidgetPlugin('Modal')
	.description('Modal widget')
	.interfaces<ModalInterfaces>()
	.config({
		description: 'Modal configuration',
		validate: (input): input is ModalRawConfig => isPlainObject(input) && typeof input.title === 'string',
		resolve: raw => ({ title: raw?.title ?? '' }),
	})
	.slots({
		body: { description: 'Modal body' },
		footer: { description: 'Modal footer' },
	})
	.state(state =>
		state.open({
			validate: (input): input is boolean => typeof input === 'boolean',
			default: () => false,
		}))
	.methods(methods =>
		methods
			.open({
				registerDeps: ({ dep }) => dep.self.state.set('open'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps(true)
				},
			})
			.close({
				registerDeps: ({ dep }) => dep.self.state.set('open'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps(false)
				},
			}))
	.done()
