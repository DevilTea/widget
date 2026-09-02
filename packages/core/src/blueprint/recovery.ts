/**
 * Raw topology recovery, id/type/plugin identity, config validate+resolve and semantic slot
 * projection — compile pipeline steps 1-5 (consolidated handoff §10).
 *
 * Normative source: diagnostic #10 amendments "Blueprint recovery edge-case contract" (COMMENT 24) and
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

import type { BlueprintDiagnostic, BlueprintNodeDiagnostic } from '../diagnostic'
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
import type { AnyWidgetPlugin, AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WidgetId, WidgetMemberKey } from '../types'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { readWidgetPluginDefinition } from '../plugin'
import { assertSyncValue } from '../runtime/sync'
import { configDiagnostic, createCollector, definitionDiagnostic, widgetLocation } from './diagnostics'

/**
 * Compiler-internal working record for one recovered node. Mutable during construction; every field
 * is stable by the time {@link recoverBlueprint} returns.
 */
export interface WorkingNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly nodeId: InternalNodeId
	readonly parentNodeId: InternalNodeId | null
	readonly source: unknown
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
	readonly finalDiagnostics: BlueprintDiagnostic<Plugins>[]
	/** Filled once, after every pipeline stage has pushed its diagnostics into `finalDiagnostics`. */
	readonly diagnosticsByNode: Map<InternalNodeId, BlueprintNodeDiagnostic<Plugins>[]>
}

function isRecoverableObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null)
		return false
	try {
		return !Array.isArray(value)
	}
	catch {
		return false
	}
}

interface ReadOwnDataProperty {
	readonly found: boolean
	readonly accessible: boolean
	readonly value?: unknown
}

function readOwnDataProperty(object: object, key: PropertyKey): ReadOwnDataProperty {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(object, key)
		if (descriptor === undefined)
			return { found: false, accessible: true }
		if (!('value' in descriptor))
			return { found: true, accessible: false }
		return { found: true, accessible: true, value: descriptor.value }
	}
	catch {
		return { found: true, accessible: false }
	}
}

function readOwnEnumerableStringKeys(object: object): readonly string[] | null {
	try {
		return Object.keys(object)
	}
	catch {
		return null
	}
}

interface ReadArrayInfo {
	readonly isArray: boolean
	readonly accessible: boolean
	readonly length?: number
}

function readArrayInfo(value: unknown): ReadArrayInfo {
	try {
		if (!Array.isArray(value))
			return { isArray: false, accessible: true }
		const descriptor = Object.getOwnPropertyDescriptor(value, 'length')
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'number')
			return { isArray: true, accessible: false }
		return { isArray: true, accessible: true, length: descriptor.value }
	}
	catch {
		return { isArray: true, accessible: false }
	}
}

interface BuildContext {
	readonly pluginsByType: ReadonlyMap<string, AnyWidgetPlugin>
	readonly nodes: WorkingNode[]
	readonly finalDiagnostics: BlueprintDiagnostic[]
	readonly diagnosticsByNode: Map<InternalNodeId, BlueprintNodeDiagnostic[]>
	readonly nodeIdByPublicNode: Map<BlueprintWidgetNode, InternalNodeId>
	readonly activeSourceObjects: Set<object>
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
	// diagnostics, `location.parent` and (later) the parent's `.slots` can all reference before every field
	// is known. It is frozen only once `.slots` is filled in, after this node's children are built.
	const shell: Record<string, unknown> = {
		source: rawValue,
		diagnostics: EMPTY_DIAGNOSTICS,
	}
	const publicNode = shell as unknown as BlueprintWidgetNode

	// `WidgetLocation` is framework-owned topology metadata, not caller-owned source data (unlike
	// `source`): `getLocation()` returns this exact object, so it is frozen up front rather than
	// left mutable (Blueprint immutability contract).
	const location: WidgetLocation = Object.freeze(placement.kind === 'root'
		? { type: 'root' }
		: placement.kind === 'slot'
			? { type: 'slot', parent: parentPublicNode as ResolvedBlueprintWidgetNode, slot: placement.slot, index: placement.index }
			: { type: 'raw-slot', parent: parentPublicNode!, slot: placement.slot, index: placement.index })

	const working: WorkingNode = {
		nodeId,
		parentNodeId,
		source: rawValue,
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

	const localDiagnostics: BlueprintDiagnostic[] = []
	const raw = isRecoverableObject(rawValue) ? rawValue : null

	if (raw === null) {
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget definition must be a plain object.'))
		finalizeShell(shell, working)
		flushDiagnostics(ctx, localDiagnostics)
		return nodeId
	}

	if (ctx.activeSourceObjects.has(raw)) {
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget definition contains a cyclic source reference.'))
		finalizeShell(shell, working)
		flushDiagnostics(ctx, localDiagnostics)
		return nodeId
	}
	ctx.activeSourceObjects.add(raw)

	// --- id ---
	const idProperty = readOwnDataProperty(raw, 'id')
	const rawId = idProperty.accessible ? idProperty.value : undefined
	const hasValidId = idProperty.found && idProperty.accessible && typeof rawId === 'string'
	if (!hasValidId)
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget "id" is missing or is not a string.', ['id']))

	// --- type ---
	const typeProperty = readOwnDataProperty(raw, 'type')
	const rawType = typeProperty.accessible ? typeProperty.value : undefined
	const hasValidTypeShape = typeProperty.found && typeProperty.accessible && typeof rawType === 'string'
	let plugin: AnyWidgetPlugin | null = null
	if (!hasValidTypeShape) {
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget "type" is missing or is not a string.', ['type']))
	}
	else {
		plugin = ctx.pluginsByType.get(rawType) ?? null
		if (plugin === null)
			localDiagnostics.push(definitionDiagnostic(publicNode, `Unknown plugin type "${rawType}".`, ['type']))
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

		const configProperty = readOwnDataProperty(raw, 'config')
		if (definition.config !== null) {
			if (!configProperty.found) {
				const resolved = definition.config.resolve(null)
				assertSyncValue(resolved, 'config.resolve')
				working.rawConfig = null
				working.config = resolved
			}
			else if (!configProperty.accessible) {
				localDiagnostics.push(configDiagnostic(publicNode as ResolvedBlueprintWidgetNode, 'Widget config could not be inspected safely.'))
				const resolved = definition.config.resolve(null)
				assertSyncValue(resolved, 'config.resolve')
				working.rawConfig = null
				working.config = resolved
			}
			else {
				const rawConfigValue = configProperty.value
				const { collector, items } = createCollector<{ message: string, path?: readonly PropertyKey[], reason?: string }>()
				let ok = false
				try {
					const rawValidateResult: unknown = definition.config.validate(rawConfigValue, collector)
					assertSyncValue(rawValidateResult, 'config.validate')
					ok = rawValidateResult as boolean
				}
				catch (error) {
					finalizeShell(shell, working)
					flushDiagnostics(ctx, localDiagnostics)
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
						localDiagnostics.push(configDiagnostic(publicNode as ResolvedBlueprintWidgetNode, item.message, item.path, item.reason))

					const resolved = definition.config.resolve(null)
					assertSyncValue(resolved, 'config.resolve')
					working.rawConfig = null
					working.config = resolved
				}
			}
		}
		else if (configProperty.found) {
			localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget declares "config" but its plugin has no config capability.', ['config']))
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
	recoverSlots(ctx, working, raw, resolved ? working.plugin : null, localDiagnostics)

	ctx.activeSourceObjects.delete(raw)
	finalizeShell(shell, working)
	flushDiagnostics(ctx, localDiagnostics)
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
	localDiagnostics: BlueprintDiagnostic[],
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

	const slotsProperty = readOwnDataProperty(raw, 'slots')
	if (!slotsProperty.found) {
		fillMissingDeclaredSlots()
		return
	}
	if (!slotsProperty.accessible) {
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget "slots" could not be inspected safely.', ['slots']))
		fillMissingDeclaredSlots()
		return
	}

	const rawSlotsValue = slotsProperty.value
	if (!isRecoverableObject(rawSlotsValue)) {
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget "slots" must be a plain object.', ['slots']))
		fillMissingDeclaredSlots()
		return
	}

	if (plugin !== null && declaredSlots === null)
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget declares "slots" but its plugin has no slots capability.', ['slots']))

	const slotNames = readOwnEnumerableStringKeys(rawSlotsValue)
	if (slotNames === null) {
		localDiagnostics.push(definitionDiagnostic(publicNode, 'Widget "slots" could not be inspected safely.', ['slots']))
		fillMissingDeclaredSlots()
		return
	}

	for (const slotName of slotNames) {
		const slotProperty = readOwnDataProperty(rawSlotsValue, slotName)
		const isDeclared = declaredSlots !== null && declaredSlots.has(slotName)

		// "not declared" and "malformed value" are independent facts (COMMENT amendment on
		// coexisting definition diagnostics): a resolved plugin that has slots capability but does not
		// declare this particular slot name still gets its own ['slots', slotName] diagnostic even when the
		// raw value is also malformed. Neither diagnostic suppresses the other, and a malformed value never
		// recovers children regardless.
		if (declaredSlots !== null && !isDeclared)
			localDiagnostics.push(definitionDiagnostic(publicNode, `Widget slot "${slotName}" is not declared by its plugin.`, ['slots', slotName]))

		const slotArray = readArrayInfo(slotProperty.value)
		if (!slotProperty.found || !slotProperty.accessible || !slotArray.isArray || !slotArray.accessible) {
			localDiagnostics.push(definitionDiagnostic(publicNode, `Widget slot "${slotName}" must be an array.`, ['slots', slotName]))
			continue
		}

		const childNodeIds: InternalNodeId[] = []
		const placementKind = isDeclared ? 'slot' as const : 'raw-slot' as const
		const slotValue = slotProperty.value as object
		for (let index = 0; index < slotArray.length!; index++) {
			const childProperty = readOwnDataProperty(slotValue, String(index))
			const childSource = childProperty.found && childProperty.accessible ? childProperty.value : undefined
			const childId = buildNode(ctx, childSource, working.nodeId, publicNode, { kind: placementKind, slot: slotName, index })
			childNodeIds.push(childId)
		}

		working.rawSlots.push({ slot: slotName, childNodeIds })
		if (isDeclared)
			working.semanticSlots.set(slotName, childNodeIds)
	}

	fillMissingDeclaredSlots()
}

function flushDiagnostics(ctx: BuildContext, diagnostics: readonly BlueprintDiagnostic[]): void {
	ctx.finalDiagnostics.push(...diagnostics)
}

/**
 * Fills in every resolved node's `.slots` public field from its (by-then complete) children and
 * freezes every public node. Runs once, after the whole tree has been recovered.
 */
export function finalizeSlots(ctx: BuildContext): void {
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

function emitDuplicateIdDiagnostics(ctx: BuildContext, index: ReadonlyMap<WidgetId, InternalNodeId[]>): void {
	for (const ids of index.values()) {
		if (ids.length < 2)
			continue

		for (const nodeId of ids) {
			const node = ctx.nodes[nodeId]!
			const related = ids
				.filter(otherId => otherId !== nodeId)
				.map(otherId => widgetLocation(ctx.nodes[otherId]!.publicNode))
			ctx.finalDiagnostics.push(definitionDiagnostic(node.publicNode, `Duplicate widget id "${node.id}".`, ['id'], related))
		}
	}
}

/**
 * Deterministic semantic traversal order used for diagnostic/aggregate ordering (COMMENT 13): declared
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
		finalDiagnostics: [],
		diagnosticsByNode: new Map(),
		nodeIdByPublicNode: new Map(),
		activeSourceObjects: new Set(),
	}

	const rootNodeId = buildNode(ctx, definition, null, null, { kind: 'root' })
	finalizeSlots(ctx)

	const nodeIdsByWidgetId = computeWidgetIdIndex(ctx)
	emitDuplicateIdDiagnostics(ctx, nodeIdsByWidgetId)

	return {
		nodes: ctx.nodes as WorkingNode<Plugins>[],
		rootNodeId,
		nodeIdByPublicNode: ctx.nodeIdByPublicNode as Map<BlueprintWidgetNode<Plugins>, InternalNodeId>,
		nodeIdsByWidgetId,
		finalDiagnostics: ctx.finalDiagnostics as BlueprintDiagnostic<Plugins>[],
		diagnosticsByNode: ctx.diagnosticsByNode as Map<InternalNodeId, BlueprintNodeDiagnostic<Plugins>[]>,
	}
}
