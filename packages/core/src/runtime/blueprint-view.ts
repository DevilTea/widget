/**
 * Restricted read-only Blueprint facade handed to Property/Method semantic callbacks as `ctx.blueprint`.
 *
 * `compute`/`execute` are typed against `ValidBlueprintView` (navigation only: `root`/`getWidget`/
 * `getParent`/`getLocation`/`getChildren`/`getChildrenAt`), but passing the full
 * `ValidWidgetSystemBlueprint` object through relied entirely on that static type to keep callbacks away
 * from `system`, `rawDefinition`, `recompile()`, `getCollectedIssues()` and `createRuntime()`. Plain
 * JS / `any` inside a callback could reach all of those — Runtime machinery and full-Blueprint
 * capabilities the callback matrix explicitly withholds, since Runtime interaction is meant to happen
 * only through declared deps. This builds an actual object exposing only the `ValidBlueprintView`
 * surface, so the restriction is a real runtime boundary, not only a compile-time one.
 *
 * Normative source: issue #10 consolidated handoff callback capability matrix ("Property/Method
 * callbacks receive the valid read-only view; they do not receive Runtime/RuntimeWidget").
 */

import type { ResolvedBlueprintWidgetNode, ValidBlueprintView, ValidWidgetSystemBlueprint } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'

export function buildBlueprintView<Plugins extends AnyWidgetPluginTuple>(
	blueprint: ValidWidgetSystemBlueprint<Plugins>,
): ValidBlueprintView<Plugins> {
	const view: ValidBlueprintView<Plugins> = {
		root: blueprint.root,
		getWidget: (id: WidgetId) => blueprint.getWidget(id),
		getParent: (node: ResolvedBlueprintWidgetNode<Plugins>) => blueprint.getParent(node),
		getLocation: (node: ResolvedBlueprintWidgetNode<Plugins>) => blueprint.getLocation(node),
		getChildren: (node: ResolvedBlueprintWidgetNode<Plugins>) => blueprint.getChildren(node),
		getChildrenAt: (node: ResolvedBlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => blueprint.getChildrenAt(node, slot),
	}
	return Object.freeze(view)
}
