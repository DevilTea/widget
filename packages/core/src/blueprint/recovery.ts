/**
 * Raw topology recovery, id/type/plugin identity, config validate+resolve and semantic slot
 * projection — compile pipeline steps 1-5 (consolidated handoff §10).
 *
 * Normative source: issue #10 amendments "Blueprint recovery edge-case contract" (COMMENT 24) and
 * "Blueprint definition diagnostic paths and exact recovery cases" (COMMENT 25).
 *
 * Raw topology recovery and widget semantic resolution are separate concerns: an unresolved ancestor
 * never truncates recoverable descendants, and a node keeps `resolved: true` once id/type/plugin are
 * established even when later config/slot/structure/dependency errors make the Blueprint invalid.
 *
 * Nodes are built as mutable "shells" that are frozen only once their (child-dependent) `.slots` field
 * is known, so a child's `location.parent` can reference its still-incomplete parent object while the
 * parent's own `.slots` is filled in afterward from the now-complete children.
 */

import type {
	BlueprintWidgetNode,
	CompiledMethodMember,
	CompiledPropertyMember,
	CompiledRawSlot,
	CompiledStateMember,
	InternalNodeId,
	ResolvedBlueprintWidgetNode,
	WidgetLocation,
} from '../internal/contract'
import type { BlueprintIssue } from '../issue'
import type { AnyWidgetPlugin, AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WidgetId, WidgetMemberKey } from '../types'
import { EMPTY_ISSUES } from '../issue'
import { readWidgetPluginDefinition } from '../plugin'
import { assertSyncValue } from '../runtime/sync'
import { configIssue, createCollector, definitionIssue, widgetLocation } from './issues'

/**
 * Compiler-internal working record for one recovered node. Mutable during construction; every field
 * is stable by the time {@link recoverBlueprint} returns.
 */
export interface WorkingNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly nodeId: InternalNodeId
	readonly parentNodeId: InternalNodeId | null
	readonly rawDefinition: unknown
	readonly rawSlots: CompiledRawSlot[]
	location: WidgetLocation<Plugins>
	resolved: boolean
	id: WidgetId | null
	type: string | null
	plugin: AnyWidgetPlugin | null
	rawConfig: unknown
	config: unknown
	/** Declared semantic slots only, in plugin declaration order. Empty when slots capability is absent. */
	readonly semanticSlots: Map<WidgetMemberKey, InternalNodeId[]>
	readonly state: Map<WidgetMemberKey, CompiledStateMember>
	/** Filled later by the dependency-resolution pass. */
	readonly properties: Map<WidgetMemberKey, CompiledPropertyMember>
	readonly methods: Map<WidgetMemberKey, CompiledMethodMember>
	/** Mutable shell during construction, frozen `BlueprintWidgetNode` once `.slots` is filled. */
	publicNode: BlueprintWidgetNode<Plugins>
}

export interface RecoveryResult<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly nodes: readonly WorkingNode<Plugins>[]
	readonly rootNodeId: InternalNodeId
	readonly nodeIdByPublicNode: Map<BlueprintWidgetNode<Plugins>, InternalNodeId>
	readonly nodeIdsByWidgetId: Map<WidgetId, InternalNodeId[]>
	/** Grows across the whole compile pipeline; frozen only once compilation finishes. */
	readonly finalIssues: BlueprintIssue<Plugins>[]
	/** Filled once, after every pipeline stage has pushed its issues into `finalIssues`. */
	readonly issuesByNode: Map<InternalNodeId, BlueprintIssue<Plugins>[]>
}

function isRecoverableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(object: object, key: string): boolean {
	return Object.hasOwn(object, key)
}

interface BuildContext {
	readonly pluginsByType: ReadonlyMap<string, AnyWidgetPlugin>
	readonly nodes: WorkingNode[]
	readonly finalIssues: BlueprintIssue[]
	readonly issuesByNode: Map<InternalNodeId, BlueprintIssue[]>
	readonly nodeIdByPublicNode: Map<BlueprintWidgetNode, InternalNodeId>
}

type Placement
	= | { readonly kind: 'root' }
		| { readonly kind: 'slot' | 'raw-slot', readonly slot: string, readonly index: number }

function buildNode(
	ctx: BuildContext,
	rawValue: unknown,
	parentNodeId: InternalNodeId | null,
	parentPublicNode: BlueprintWidgetNode | null,
	placement: Placement,
): InternalNodeId {
	const nodeId = ctx.nodes.length

	// The public node object is created as a mutable shell first so it has a stable identity that
	// issues, `location.parent` and (later) the parent's `.slots` can all reference before every field
	// is known. It is frozen only once `.slots` is filled in, after this node's children are built.
	const shell: Record<string, unknown> = {
		rawDefinition: rawValue,
		getIssues: () => ctx.issuesByNode.get(nodeId) ?? EMPTY_ISSUES,
	}
	const publicNode = shell as unknown as BlueprintWidgetNode

	const location: WidgetLocation = placement.kind === 'root'
		? { type: 'root' }
		: placement.kind === 'slot'
			? { type: 'slot', parent: parentPublicNode as ResolvedBlueprintWidgetNode, slot: placement.slot, index: placement.index }
			: { type: 'raw-slot', parent: parentPublicNode!, slot: placement.slot, index: placement.index }

	const working: WorkingNode = {
		nodeId,
		parentNodeId,
		rawDefinition: rawValue,
		rawSlots: [],
		location,
		resolved: false,
		id: null,
		type: null,
		plugin: null,
		rawConfig: null,
		config: null,
		semanticSlots: new Map(),
		state: new Map(),
		properties: new Map(),
		methods: new Map(),
		publicNode,
	}
	ctx.nodes.push(working)
	ctx.nodeIdByPublicNode.set(publicNode, nodeId)

	const localIssues: BlueprintIssue[] = []
	const raw = isRecoverableObject(rawValue) ? rawValue : null

	if (raw === null) {
		localIssues.push(definitionIssue(publicNode, 'Widget definition must be a plain object.'))
		finalizeShell(shell, working)
		flushIssues(ctx, localIssues)
		return nodeId
	}

	// --- id ---
	const rawId = hasOwn(raw, 'id') ? raw.id : undefined
	const hasValidId = typeof rawId === 'string'
	if (!hasOwn(raw, 'id') || !hasValidId)
		localIssues.push(definitionIssue(publicNode, 'Widget "id" is missing or is not a string.', ['id']))

	// --- type ---
	const rawType = hasOwn(raw, 'type') ? raw.type : undefined
	const hasValidTypeShape = typeof rawType === 'string'
	let plugin: AnyWidgetPlugin | null = null
	if (!hasOwn(raw, 'type') || !hasValidTypeShape) {
		localIssues.push(definitionIssue(publicNode, 'Widget "type" is missing or is not a string.', ['type']))
	}
	else {
		plugin = ctx.pluginsByType.get(rawType) ?? null
		if (plugin === null)
			localIssues.push(definitionIssue(publicNode, `Unknown plugin type "${rawType}".`, ['type']))
	}

	const resolved = hasValidId && hasValidTypeShape && plugin !== null
	working.resolved = resolved
	working.id = hasValidId ? (rawId as string) : null

	if (resolved) {
		working.type = rawType as string
		working.plugin = plugin
	}

	// --- config ---
	if (resolved && plugin !== null) {
		const definition = readWidgetPluginDefinition(plugin)

		if (definition.config !== null) {
			const hasConfig = hasOwn(raw, 'config')
			if (!hasConfig) {
				const resolved = definition.config.resolve(null)
				assertSyncValue(resolved, 'config.resolve')
				working.rawConfig = null
				working.config = resolved
			}
			else {
				const rawConfigValue = raw.config
				const { collector, items } = createCollector<{ message: string, path?: readonly PropertyKey[] }>()
				let ok = false
				try {
					const rawValidateResult: unknown = definition.config.validate(rawConfigValue, collector)
					assertSyncValue(rawValidateResult, 'config.validate')
					ok = rawValidateResult as boolean
				}
				catch (error) {
					finalizeShell(shell, working)
					flushIssues(ctx, localIssues)
					throw error
				}

				if (ok && items.length === 0) {
					const resolved = definition.config.resolve(rawConfigValue)
					assertSyncValue(resolved, 'config.resolve')
					working.rawConfig = rawConfigValue
					working.config = resolved
				}
				else {
					if (items.length === 0)
						items.push({ message: 'Invalid config.' })

					for (const item of items)
						localIssues.push(configIssue(publicNode as ResolvedBlueprintWidgetNode, item.message, rawConfigValue, item.path))

					const resolved = definition.config.resolve(null)
					assertSyncValue(resolved, 'config.resolve')
					working.rawConfig = null
					working.config = resolved
				}
			}
		}
		else if (hasOwn(raw, 'config')) {
			localIssues.push(definitionIssue(publicNode, 'Widget declares "config" but its plugin has no config capability.', ['config']))
		}
	}

	// --- state ---
	if (resolved && plugin !== null) {
		const definition = readWidgetPluginDefinition(plugin)
		if (definition.state !== null) {
			for (const [key, memberDefinition] of definition.state)
				working.state.set(key, { key, definition: memberDefinition })
		}
	}

	// --- slots ---
	recoverSlots(ctx, working, raw, resolved ? working.plugin : null, localIssues)

	finalizeShell(shell, working)
	flushIssues(ctx, localIssues)
	return nodeId
}

function finalizeShell(shell: Record<string, unknown>, working: WorkingNode): void {
	shell.resolved = working.resolved
	if (working.resolved) {
		shell.id = working.id
		shell.type = working.type
		shell.plugin = working.plugin
		if (working.plugin !== null && readWidgetPluginDefinition(working.plugin).config !== null) {
			shell.rawConfig = working.rawConfig
			shell.config = working.config
		}
		// `.slots` is filled in later, once children are known, by `finalizeSlots`.
		shell.slots = {}
	}
}

/**
 * Recovers a node's raw `slots` fragment (topology only) and, for a resolved node, projects it onto
 * the plugin's declared semantic slots. Independent of plugin resolution for the raw-topology part.
 */
function recoverSlots(
	ctx: BuildContext,
	working: WorkingNode,
	raw: Record<string, unknown>,
	plugin: AnyWidgetPlugin | null,
	localIssues: BlueprintIssue[],
): void {
	const publicNode = working.publicNode
	const definition = plugin !== null ? readWidgetPluginDefinition(plugin) : null
	const declaredSlots = definition?.slots ?? null

	function fillMissingDeclaredSlots(): void {
		if (declaredSlots === null)
			return
		for (const slotName of declaredSlots.keys()) {
			if (!working.semanticSlots.has(slotName))
				working.semanticSlots.set(slotName, [])
		}
	}

	if (!hasOwn(raw, 'slots')) {
		fillMissingDeclaredSlots()
		return
	}

	const rawSlotsValue = raw.slots
	if (!isRecoverableObject(rawSlotsValue)) {
		localIssues.push(definitionIssue(publicNode, 'Widget "slots" must be a plain object.', ['slots']))
		fillMissingDeclaredSlots()
		return
	}

	if (plugin !== null && declaredSlots === null)
		localIssues.push(definitionIssue(publicNode, 'Widget declares "slots" but its plugin has no slots capability.', ['slots']))

	for (const slotName of Object.keys(rawSlotsValue)) {
		const slotValue = rawSlotsValue[slotName]
		const isDeclared = declaredSlots !== null && declaredSlots.has(slotName)

		// "not declared" and "malformed value" are independent facts (COMMENT amendment on
		// coexisting definition diagnostics): a resolved plugin that has slots capability but does not
		// declare this particular slot name still gets its own ['slots', slotName] issue even when the
		// raw value is also malformed. Neither issue suppresses the other, and a malformed value never
		// recovers children regardless.
		if (declaredSlots !== null && !isDeclared)
			localIssues.push(definitionIssue(publicNode, `Widget slot "${slotName}" is not declared by its plugin.`, ['slots', slotName]))

		if (!Array.isArray(slotValue)) {
			localIssues.push(definitionIssue(publicNode, `Widget slot "${slotName}" must be an array.`, ['slots', slotName]))
			continue
		}

		const childNodeIds: InternalNodeId[] = []
		const placementKind = isDeclared ? 'slot' as const : 'raw-slot' as const
		for (let index = 0; index < slotValue.length; index++) {
			const childId = buildNode(ctx, slotValue[index], working.nodeId, publicNode, { kind: placementKind, slot: slotName, index })
			childNodeIds.push(childId)
		}

		working.rawSlots.push({ slot: slotName, childNodeIds })
		if (isDeclared)
			working.semanticSlots.set(slotName, childNodeIds)
	}

	fillMissingDeclaredSlots()
}

function flushIssues(ctx: BuildContext, issues: readonly BlueprintIssue[]): void {
	ctx.finalIssues.push(...issues)
}

/**
 * Fills in every resolved node's `.slots` public field from its (by-then complete) children and
 * freezes every public node. Runs once, after the whole tree has been recovered.
 */
function finalizeSlotsAndFreeze(ctx: BuildContext): void {
	for (const node of ctx.nodes) {
		const shell = node.publicNode as unknown as Record<string, unknown>
		if (node.resolved) {
			// Slot names are plugin-declared, arbitrary strings, including special JavaScript names
			// (`__proto__`, `constructor`, ...); `Object.create(null)` keeps every slot an own,
			// prototype-safe data property on the public semantic `.slots` map (same rationale as
			// `blueprint/deps.ts`'s `walkDeps` object branch).
			const slots: Record<string, readonly BlueprintWidgetNode[]> = Object.create(null)
			for (const [slotName, childIds] of node.semanticSlots)
				slots[slotName] = Object.freeze(childIds.map(id => ctx.nodes[id]!.publicNode))

			shell.slots = Object.freeze(slots)
		}
		Object.freeze(node.rawSlots)
		Object.freeze(shell)
	}
}

function computeWidgetIdIndex(ctx: BuildContext): Map<WidgetId, InternalNodeId[]> {
	const index = new Map<WidgetId, InternalNodeId[]>()
	for (const node of ctx.nodes) {
		if (node.id === null)
			continue
		const list = index.get(node.id)
		if (list === undefined)
			index.set(node.id, [node.nodeId])
		else
			list.push(node.nodeId)
	}
	return index
}

function emitDuplicateIdIssues(ctx: BuildContext, index: ReadonlyMap<WidgetId, InternalNodeId[]>): void {
	for (const ids of index.values()) {
		if (ids.length < 2)
			continue

		for (const nodeId of ids) {
			const node = ctx.nodes[nodeId]!
			const related = ids
				.filter(otherId => otherId !== nodeId)
				.map(otherId => widgetLocation(ctx.nodes[otherId]!.publicNode))
			ctx.finalIssues.push(definitionIssue(node.publicNode, `Duplicate widget id "${node.id}".`, ['id'], related))
		}
	}
}

/**
 * Deterministic semantic traversal order used for issue/aggregate ordering (COMMENT 13): declared
 * slots in plugin declaration order for resolved nodes, falling back to recovered raw-topology order
 * for unresolved nodes and for any raw-only child left over from an undeclared slot.
 */
export function computeSemanticOrder(nodes: readonly WorkingNode[], rootNodeId: InternalNodeId): InternalNodeId[] {
	const visited = new Set<InternalNodeId>()
	const order: InternalNodeId[] = []

	function visit(nodeId: InternalNodeId): void {
		if (visited.has(nodeId))
			return
		visited.add(nodeId)
		order.push(nodeId)

		const node = nodes[nodeId]!
		if (node.resolved) {
			for (const childIds of node.semanticSlots.values()) {
				for (const childId of childIds)
					visit(childId)
			}
			for (const rawSlot of node.rawSlots) {
				if (node.semanticSlots.has(rawSlot.slot))
					continue
				for (const childId of rawSlot.childNodeIds)
					visit(childId)
			}
		}
		else {
			for (const rawSlot of node.rawSlots) {
				for (const childId of rawSlot.childNodeIds)
					visit(childId)
			}
		}
	}

	visit(rootNodeId)
	for (let id = 0; id < nodes.length; id++)
		visit(id)

	return order
}

export function recoverBlueprint<Plugins extends AnyWidgetPluginTuple>(
	system: WidgetSystem<Plugins>,
	definition: unknown,
): RecoveryResult<Plugins> {
	const pluginsByType = new Map<string, AnyWidgetPlugin>()
	for (const plugin of system.plugins)
		pluginsByType.set(plugin.type, plugin)

	const ctx: BuildContext = {
		pluginsByType,
		nodes: [],
		finalIssues: [],
		issuesByNode: new Map(),
		nodeIdByPublicNode: new Map(),
	}

	const rootNodeId = buildNode(ctx, definition, null, null, { kind: 'root' })
	finalizeSlotsAndFreeze(ctx)

	const nodeIdsByWidgetId = computeWidgetIdIndex(ctx)
	emitDuplicateIdIssues(ctx, nodeIdsByWidgetId)

	return {
		nodes: ctx.nodes as WorkingNode<Plugins>[],
		rootNodeId,
		nodeIdByPublicNode: ctx.nodeIdByPublicNode as Map<BlueprintWidgetNode<Plugins>, InternalNodeId>,
		nodeIdsByWidgetId,
		finalIssues: ctx.finalIssues as BlueprintIssue<Plugins>[],
		issuesByNode: ctx.issuesByNode as Map<InternalNodeId, BlueprintIssue<Plugins>[]>,
	}
}
