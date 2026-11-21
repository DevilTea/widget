/**
 * Deterministic converters between the authored document tree (`{ id, type, config?, slots? }`) and the flat node
 * list of the LLM profile (`{ nodes: [{ id, type, parent?, slot?, config?, slots?, meta? }] }`).
 *
 * The conversion is lossless both ways for a well-formed tree: `flatToTree(treeToFlat(tree))` deep-equals `tree`.
 * A key the tree leaves out is left out of the node (never written as `null`), `slots` lists the node's slot names
 * in order so an empty slot survives, and `meta` and any unrecognized widget key are carried unchanged.
 *
 * Config values follow the same re-encoding as `emitLlmSchema`: a dictionary is a list of `{ key, value }` and an
 * untyped (or recursive) value is JSON text. Values that do not fit the declared shape pass through unchanged, so
 * a wrong document stays wrong and Core diagnoses it.
 */

import type { Shape, SystemIr } from './ir'
import { recursiveTypeNames } from './schema'

export interface FlatNode {
	id: string
	type: string
	/** The parent's id. Left out (or `null`) on the one root node. */
	parent?: string | null
	/** The parent's slot. Left out (or `null`) on the root node. */
	slot?: string | null
	/** Left out when the widget has no `config` key. */
	config?: unknown
	/** The widget's slot names in order. Only needed for a slot without children; left out when the widget has no `slots` key. */
	slots?: string[]
	/** The reserved `meta` value, carried unchanged. */
	meta?: unknown
	/** Unrecognized widget keys are carried unchanged, so Core still reports them. */
	[key: string]: unknown
}

/** The keys of a flat node that are not copied to the tree as they are. */
const FLAT_KEYS = new Set(['id', 'type', 'parent', 'slot', 'config', 'slots'])

export interface FlatDocument {
	nodes: FlatNode[]
}

export class FlatConversionError extends Error {
	override name = 'FlatConversionError'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	// `__proto__` must become an own property, never the prototype.
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

export interface FlatConverter {
	/** Tree -> flat. Throws `FlatConversionError` when a node is not an object with string `id` and `type`, or ids repeat. */
	treeToFlat: (tree: unknown) => FlatDocument
	/** Flat -> tree. Throws `FlatConversionError` on no root, several roots, an unknown parent, a repeated id or a cycle. */
	flatToTree: (flat: FlatDocument) => Record<string, unknown>
}

export function createFlatConverter(ir: SystemIr): FlatConverter {
	const recursive = recursiveTypeNames(ir)

	function matches(value: unknown, shape: Shape, flat: boolean): boolean {
		switch (shape.kind) {
			case 'string':
				return typeof value === 'string'
			case 'number':
				return typeof value === 'number'
			case 'boolean':
				return typeof value === 'boolean'
			case 'null':
				return value === null
			case 'literal':
				return value === shape.value
			case 'unknown':
				return flat ? typeof value === 'string' : true
			case 'array':
				return Array.isArray(value)
			case 'record':
				return flat ? Array.isArray(value) : isPlainObject(value)
			case 'object':
				return isPlainObject(value)
			case 'union':
				return shape.members.some(member => matches(value, member, flat))
			case 'ref':
				if (recursive.has(shape.name) || ir.types[shape.name] === undefined)
					return flat ? typeof value === 'string' : true
				return matches(value, ir.types[shape.name]!.shape, flat)
		}
	}

	function encode(value: unknown, shape: Shape): unknown {
		switch (shape.kind) {
			case 'unknown':
				return JSON.stringify(value)
			case 'ref':
				if (recursive.has(shape.name) || ir.types[shape.name] === undefined)
					return JSON.stringify(value)
				return encode(value, ir.types[shape.name]!.shape)
			case 'array':
				return Array.isArray(value) ? value.map(item => encode(item, shape.items)) : value
			case 'record':
				return isPlainObject(value)
					? Object.entries(value)
							.map(([key, entry]) => ({ key, value: encode(entry, shape.value) }))
					: value
			case 'union': {
				const member = shape.members.find(candidate => matches(value, candidate, false))
				return member === undefined ? value : encode(value, member)
			}
			case 'object': {
				if (!isPlainObject(value))
					return value
				const declared = new Map(shape.properties.map(property => [property.name, property]))
				const result: Record<string, unknown> = {}
				// Key order is kept, a missing optional property stays missing, and an undeclared key passes through.
				for (const [key, entry] of Object.entries(value)) {
					const property = declared.get(key)
					setOwn(result, key, property === undefined ? entry : encode(entry, property.shape))
				}
				return result
			}
			default:
				return value
		}
	}

	function decodeJsonText(value: unknown): unknown {
		if (typeof value !== 'string')
			return value
		try {
			return JSON.parse(value)
		}
		catch {
			return value
		}
	}

	function decode(value: unknown, shape: Shape): unknown {
		switch (shape.kind) {
			case 'unknown':
				return decodeJsonText(value)
			case 'ref':
				if (recursive.has(shape.name) || ir.types[shape.name] === undefined)
					return decodeJsonText(value)
				return decode(value, ir.types[shape.name]!.shape)
			case 'array':
				return Array.isArray(value) ? value.map(item => decode(item, shape.items)) : value
			case 'record': {
				if (!Array.isArray(value) || !value.every(entry => isPlainObject(entry) && typeof entry.key === 'string' && Object.hasOwn(entry, 'value')))
					return value
				const result: Record<string, unknown> = {}
				for (const entry of value as { key: string, value: unknown }[])
					setOwn(result, entry.key, decode(entry.value, shape.value))
				return result
			}
			case 'union': {
				const member = shape.members.find(candidate => matches(value, candidate, true))
				return member === undefined ? value : decode(value, member)
			}
			case 'object': {
				if (!isPlainObject(value))
					return value
				const declared = new Map(shape.properties.map(property => [property.name, property]))
				const result: Record<string, unknown> = {}
				for (const [key, entry] of Object.entries(value)) {
					const property = declared.get(key)
					// An explicit null is kept: leaving an optional property out is how it is omitted.
					setOwn(result, key, property === undefined ? entry : decode(entry, property.shape))
				}
				return result
			}
			default:
				return value
		}
	}

	const configShapeOf = (type: string): Shape | null => ir.plugins.find(plugin => plugin.type === type)?.config?.rawShape ?? null

	function treeToFlat(tree: unknown): FlatDocument {
		const nodes: FlatNode[] = []
		const seen = new Set<string>()
		const visit = (node: unknown, parent: string | null, slot: string | null): void => {
			if (!isPlainObject(node) || typeof node.id !== 'string' || typeof node.type !== 'string')
				throw new FlatConversionError(`A widget${parent === null ? '' : ` under "${parent}"`} is not an object with a string "id" and "type".`)
			if (seen.has(node.id))
				throw new FlatConversionError(`The id "${node.id}" is used more than once; the flat form names parents by id.`)
			seen.add(node.id)
			const flat: FlatNode = { id: node.id, type: node.type }
			if (parent !== null) {
				flat.parent = parent
				flat.slot = slot
			}
			if (Object.hasOwn(node, 'config')) {
				const shape = configShapeOf(node.type)
				flat.config = node.config === null || shape === null ? node.config : encode(node.config, shape)
			}
			const slots = Object.hasOwn(node, 'slots') ? node.slots : undefined
			if (slots !== undefined && !isPlainObject(slots))
				throw new FlatConversionError(`The "slots" of "${node.id}" is not an object.`)
			if (slots !== undefined)
				flat.slots = Object.keys(slots)
			for (const [key, value] of Object.entries(node)) {
				if (key === 'parent' || key === 'slot')
					throw new FlatConversionError(`"${node.id}" has the key "${key}", which the flat form reserves.`)
				if (!FLAT_KEYS.has(key))
					setOwn(flat, key, value)
			}
			nodes.push(flat)
			for (const [name, children] of Object.entries(slots ?? {})) {
				if (!Array.isArray(children))
					throw new FlatConversionError(`The slot "${name}" of "${node.id}" is not an array.`)
				for (const child of children)
					visit(child, node.id, name)
			}
		}
		visit(tree, null, null)
		return { nodes }
	}

	function flatToTree(flat: FlatDocument): Record<string, unknown> {
		if (!isPlainObject(flat) || !Array.isArray(flat.nodes))
			throw new FlatConversionError('Expected { nodes: [...] }.')
		const built = new Map<string, { tree: Record<string, unknown>, slots: Record<string, unknown[]>, declaresSlots: boolean }>()
		for (const node of flat.nodes) {
			if (!isPlainObject(node) || typeof node.id !== 'string' || typeof node.type !== 'string')
				throw new FlatConversionError('A node is not an object with a string "id" and "type".')
			if (built.has(node.id))
				throw new FlatConversionError(`The id "${node.id}" is used more than once.`)
			const tree: Record<string, unknown> = { id: node.id, type: node.type }
			if (Object.hasOwn(node, 'config')) {
				const shape = configShapeOf(node.type)
				tree.config = node.config === null || shape === null ? node.config : decode(node.config, shape)
			}
			const slots: Record<string, unknown[]> = {}
			if (node.slots !== undefined && node.slots !== null) {
				if (!Array.isArray(node.slots) || !node.slots.every(name => typeof name === 'string'))
					throw new FlatConversionError(`The "slots" of "${node.id}" is not a list of slot names.`)
				for (const name of node.slots as string[])
					setOwn(slots, name, [])
			}
			for (const [key, value] of Object.entries(node)) {
				if (!FLAT_KEYS.has(key))
					setOwn(tree, key, value)
			}
			built.set(node.id, { tree, slots, declaresSlots: Array.isArray(node.slots) })
		}
		let root: Record<string, unknown> | null = null
		for (const node of flat.nodes) {
			const own = built.get(node.id)!
			if (node.parent === null || node.parent === undefined) {
				if (root !== null)
					throw new FlatConversionError(`More than one node has parent null: "${String(root.id)}" and "${node.id}".`)
				root = own.tree
				continue
			}
			const parent = built.get(node.parent)
			if (parent === undefined)
				throw new FlatConversionError(`"${node.id}" names the parent "${node.parent}", which is not a node.`)
			if (typeof node.slot !== 'string')
				throw new FlatConversionError(`"${node.id}" has a parent but no slot.`)
			if (!Object.hasOwn(parent.slots, node.slot))
				setOwn(parent.slots, node.slot, [])
			parent.slots[node.slot]!.push(own.tree)
		}
		if (root === null)
			throw new FlatConversionError('No node has parent null: the document needs exactly one root.')
		for (const { tree, slots, declaresSlots } of built.values()) {
			if (declaresSlots || Object.keys(slots).length > 0)
				tree.slots = slots
		}
		// Every node hangs under a parent, so a node the root does not reach is on a cycle.
		const reached = new Set<unknown>()
		const walk = (tree: Record<string, unknown>): void => {
			reached.add(tree)
			for (const children of Object.values((tree.slots ?? {}) as Record<string, Record<string, unknown>[]>))
				children.forEach(walk)
		}
		walk(root)
		const orphan = [...built.values()].find(({ tree }) => !reached.has(tree))
		if (orphan !== undefined)
			throw new FlatConversionError(`"${String(orphan.tree.id)}" is not reachable from the root: its parents form a cycle.`)
		return root
	}

	return { treeToFlat, flatToTree }
}
