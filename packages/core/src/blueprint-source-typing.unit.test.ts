import type {
	BlueprintWidgetNode,
	JsonValue,
	ResolvedBlueprintWidgetNode,
	ValidBlueprintView,
	WidgetSystemBlueprint,
} from './index'
import { describe, expectTypeOf, it } from 'vitest'

type Blueprint = WidgetSystemBlueprint

function assertJsonSourceProof(blueprint: Blueprint): void {
	if (!blueprint.sourceJsonCompatible) {
		const status: 'invalid' = blueprint.status
		const source: unknown = blueprint.source
		const rootSource: unknown = blueprint.root.source
		void status
		void source
		void rootSource
		// A false proof deliberately leaves the exact authored source outside JsonValue.
		// @ts-expect-error an unproven source cannot be treated as authored JSON
		const jsonSource: JsonValue = blueprint.source
		// @ts-expect-error the recovered root is also outside the authored JSON proof
		const jsonRootSource: JsonValue = blueprint.root.source
		void jsonSource
		void jsonRootSource
		return
	}
	if (blueprint.status === 'invalid') {
		const compatibleInvalidSource: JsonValue = blueprint.source
		const compatibleInvalidRootSource: JsonValue = blueprint.root.source
		void compatibleInvalidSource
		void compatibleInvalidRootSource
	}

	const source: JsonValue = blueprint.source
	const rootSource: JsonValue = blueprint.root.source
	// Navigation accepts an ordinary node even when its source generic is not proven by the caller.
	const ordinaryNode: BlueprintWidgetNode = blueprint.root
	const widget = blueprint.getWidget('root')
	const widgetSource: JsonValue | undefined = widget?.source
	const parent = blueprint.getParent(ordinaryNode)
	const parentSource: JsonValue | undefined = parent?.source
	const children = blueprint.getChildren(ordinaryNode)
	const childSource: JsonValue | undefined = children[0]?.source
	const childrenAt = blueprint.getChildrenAt(ordinaryNode, 'items')
	const childAtSource: JsonValue | undefined = childrenAt[0]?.source
	const location = blueprint.getLocation(ordinaryNode)
	let locationParentSource: JsonValue | undefined
	if (location !== null && location.type !== 'root')
		locationParentSource = location.parent.source

	void source
	void rootSource
	void widgetSource
	void parentSource
	void childSource
	void childAtSource
	void locationParentSource
}

function assertValidViewSourceProof(view: ValidBlueprintView): void {
	const ordinaryResolvedNode: ResolvedBlueprintWidgetNode = view.root
	const rootSource: JsonValue = view.root.source
	const widgetSource: JsonValue | undefined = view.getWidget('root')?.source
	const parentSource: JsonValue | undefined = view.getParent(ordinaryResolvedNode)?.source
	const childSource: JsonValue | undefined = view.getChildren(ordinaryResolvedNode)[0]?.source
	const childAtSource: JsonValue | undefined = view.getChildrenAt(ordinaryResolvedNode, 'items')[0]?.source
	const location = view.getLocation(ordinaryResolvedNode)
	let locationParentSource: JsonValue | undefined
	if (location !== null && location.type !== 'root')
		locationParentSource = location.parent.source

	void rootSource
	void widgetSource
	void parentSource
	void childSource
	void childAtSource
	void locationParentSource
}

describe('blueprint sourceJsonCompatible proof', () => {
	it('narrows source through every finalized navigation surface', () => {
		expectTypeOf(assertJsonSourceProof).returns.toBeVoid()
		expectTypeOf(assertValidViewSourceProof).returns.toBeVoid()
	})
})
