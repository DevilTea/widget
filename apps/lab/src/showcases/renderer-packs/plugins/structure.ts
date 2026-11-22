/**
 * The structure rules and dependency helpers the settings plugins share. Only a structure validator (and `registerDeps`) sees the
 * Blueprint, so what a config says about ANOTHER widget is checked here, as an `invalid-widget-structure` diagnostic with a
 * machine-readable `reason`:
 * - `unknown-appearance` / `not-an-appearance`: a field's `appearance` names no widget, or one that is not an Appearance;
 * - `unknown-notifier` / `not-a-notifier`: the same for a DangerAction's `notifier`;
 * - `settings-page-not-root`: a SettingsPage is the root;
 * - `at-most-one-appearance`: the page reads one Appearance (the one in its `providers` slot).
 *
 * **No provider shadowing.** Core has no nearest-ancestor or provider lookup (DevilTea/widget#3). Appearance and Notifier are
 * ordinary widgets; whoever uses one names it by id (`config.appearance`, `config.notifier`) and declares the dependency with
 * `dep.widget(id)`. Two Appearance widgets would be two providers, and each field reads exactly the one it names.
 */

import type { BlueprintCompileView, DependencyBuilder, WidgetInterfaces } from '@deviltea/widget-core'
import { isDensity } from '../domain'

type NodeView = Parameters<BlueprintCompileView['getParent']>[0]

export interface StructureContext {
	readonly widget: NodeView
	readonly blueprint: BlueprintCompileView
	readonly addDiagnostic: (diagnostic: { readonly message: string, readonly reason?: string }) => void
}

export type SettingsDeps = Pick<DependencyBuilder<WidgetInterfaces, 'property'>, 'widget' | 'root'>

export const FIELD_TYPES = ['TextField', 'Toggle', 'Choice', 'DangerAction'] as const
export const PROVIDER_TYPES = ['Appearance', 'Notifier'] as const

export function isFieldType(type: string): boolean {
	return (FIELD_TYPES as readonly string[]).includes(type)
}

export function isProviderType(type: string): boolean {
	return (PROVIDER_TYPES as readonly string[]).includes(type)
}

const PROVIDER_REASONS = {
	Appearance: { unknown: 'unknown-appearance', wrongType: 'not-an-appearance', article: 'an' },
	Notifier: { unknown: 'unknown-notifier', wrongType: 'not-a-notifier', article: 'a' },
} as const

/** A located diagnostic when `id` is not the id of a widget of `type`; `key` names the config key for the message. */
export function checkProvider({ blueprint, addDiagnostic }: StructureContext, id: string, type: 'Appearance' | 'Notifier', key: string): void {
	const target = blueprint.getWidget(id)
	const reasons = PROVIDER_REASONS[type]
	if (target === null)
		addDiagnostic({ message: `config.${key} is "${id}", but the document has no widget with that id. Name the ${type} widget by its id.`, reason: reasons.unknown })
	else if (target.type !== type)
		addDiagnostic({ message: `config.${key} is "${id}", a ${target.type}, not ${reasons.article} ${type}.`, reason: reasons.wrongType })
}

/** `id` when the Blueprint has a widget of that id and type, otherwise `null`: a dependency is only declared on a provider that exists. */
export function providerId(blueprint: Pick<BlueprintCompileView, 'getWidget'>, id: string, type: 'Appearance' | 'Notifier'): string | null {
	const target = blueprint.getWidget(id)
	return target !== null && target.type === type ? id : null
}

/** The id of the first Appearance in the root's `providers` slot, or `null`. */
export function rootAppearanceId(blueprint: Pick<BlueprintCompileView, 'root' | 'getChildrenAt'>): string | null {
	const root = blueprint.root
	if (!root.resolved || root.type !== 'SettingsPage')
		return null
	const found = blueprint.getChildrenAt(root, 'providers')
		.find(child => child.resolved && child.type === 'Appearance')
	return found === undefined || !found.resolved ? null : found.id
}

/** The page reads one Appearance (the first in `providers`): a second one is reported on the later widget. */
export function checkAtMostOneAppearance({ widget, blueprint, addDiagnostic }: StructureContext): void {
	const root = blueprint.root
	if (!root.resolved || root.type !== 'SettingsPage')
		return
	const appearances = blueprint.getChildrenAt(root, 'providers')
		.filter(child => child.resolved && child.type === 'Appearance')
	const first = appearances[0]
	if (appearances.length > 1 && first?.resolved && widget.resolved && widget.id !== first.id)
		addDiagnostic({ message: 'A page has at most one Appearance: the page reads the first one in its providers slot.', reason: 'at-most-one-appearance' })
}

/** A field sits directly in the `fields` slot of a Section. */
export function checkInsideSection({ widget, blueprint, addDiagnostic }: StructureContext, type: string): void {
	const parent = blueprint.getParent(widget)
	if (parent === null || (parent.resolved && parent.type !== 'Section'))
		addDiagnostic({ message: `A ${type} must be placed in the fields of a Section.`, reason: 'outside-section' })
}

/**
 * The read of the density of the Appearance a field names, as a dependency container: empty when the id names no Appearance
 * (the structure rule has reported it, and the Property falls back to `comfortable`).
 */
export function densityReads(dep: SettingsDeps, blueprint: Pick<BlueprintCompileView, 'getWidget'>, appearance: string) {
	const id = providerId(blueprint, appearance, 'Appearance')
	return { ...(id === null
		? {}
		: { density: dep.widget(id).state.get('density')
				.validate(isDensity) }) }
}
