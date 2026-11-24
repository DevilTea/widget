/**
 * Fills the prose of the IR from `plugin.docs` (Core 0.4: the documentation written in the builder) and records what
 * `--check` reports about it (`ir.docsIssues`).
 *
 * The shapes come from the types; the docs are walked beside them:
 * - a docs node's `fields` document the properties of the object types at its position (every member of a union),
 *   `items` the element of an array, `values` the value of a dictionary (an object type with an index signature is a
 *   dictionary, as in Core);
 * - a named type has one entry in the schemas' `$defs`, so its docs are gathered from every place that documents it:
 *   the type docs a `ref` names (`defineTypeDocs`), and the inline docs at each place it is used. Identical docs share
 *   the entry; different docs are a `docs-conflict`. The type's own description comes from its type docs, or from a
 *   docs position that holds the type itself (`config.raw`, `config.resolved`, `items`, `values`, a reason's
 *   `details`); a field, parameter or payload description describes that position, not the type;
 * - a `ref` must name type docs whose name is the type's name (`name-mismatch` otherwise), since that name is the
 *   type's `$defs` entry.
 *
 * Every `undocumented` marker (`null` in `plugin.docs`) is an `undocumented` issue with its plugin and docs path. A
 * member the types declare and the docs leave out (possible only for an untyped plugin), or a docs member the types
 * do not declare, is a `name-mismatch`; a field the types declare and documented docs leave out is a `missing-doc`.
 */

import type { Doc, DocsIssue, DocsNode, NamedType, PluginDocsData, PluginIr, RuntimeFacts, Shape, SystemIr } from './ir'
import { docOfDescription, emptyDoc } from './ir'

/** Where a docs node was written: the plugin and its path in `plugin.docs`. */
interface Site {
	plugin: string
	path: string
}

function where(site: Site): string {
	return `${site.plugin}: ${site.path}`
}

function child(site: Site, segment: string): Site {
	return { plugin: site.plugin, path: site.path === '' ? segment : `${site.path}.${segment}` }
}

/** The nested docs of a named type, from one place, with what is needed to compare and apply them. */
interface Candidate {
	/** The type's own description from this place: `undefined` when this place does not describe the type itself. */
	description: string | null | undefined
	node: DocsNode
	/** Where the docs were written, for the messages. */
	site: Site
	/** Whether the nested docs are waived (the description at this place is `undocumented`). */
	waived: boolean
	/** Type docs: their field names are checked against the type. Inline docs were checked where they were written. */
	checkKeys: boolean
	/** The name of the type docs, for the messages; `null` for inline docs. */
	typeDocs: string | null
}

/** JSON with sorted object keys, so two docs values compare by content. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonical)
			.join(',')}]`
	}
	if (typeof value === 'object' && value !== null) {
		return `{${Object.keys(value)
			.filter(key => (value as Record<string, unknown>)[key] !== undefined)
			.sort()
			.map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
			.join(',')}}`
	}
	return JSON.stringify(value)
}

/** The nested part of a docs node (`fields`, `items`, `values`, `ref`), which is what one `$defs` entry holds. */
function nestedOf(node: DocsNode): string {
	return canonical({ fields: node.fields, items: node.items, values: node.values, ref: node.ref })
}

function resetDocs(ir: SystemIr): void {
	const visit = (shape: Shape, seen: Set<Shape>): void => {
		if (seen.has(shape))
			return
		seen.add(shape)
		if (shape.kind === 'object') {
			delete shape.additionalDoc
			for (const property of shape.properties) {
				property.doc = emptyDoc()
				visit(property.shape, seen)
			}
			if (shape.additional !== undefined)
				visit(shape.additional, seen)
		}
		else if (shape.kind === 'array') {
			delete shape.itemsDoc
			visit(shape.items, seen)
		}
		else if (shape.kind === 'record') {
			delete shape.valuesDoc
			visit(shape.value, seen)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(member => visit(member, seen))
		}
	}
	const seen = new Set<Shape>()
	for (const type of Object.values(ir.types)) {
		type.doc = emptyDoc()
		visit(type.shape, seen)
	}
	for (const plugin of ir.plugins) {
		plugin.doc = emptyDoc()
		if (plugin.config !== null) {
			plugin.config.doc = emptyDoc()
			visit(plugin.config.rawShape, seen)
			visit(plugin.config.resolvedShape, seen)
		}
		for (const slot of plugin.slots)
			slot.doc = emptyDoc()
		for (const member of [...plugin.state, ...plugin.properties]) {
			member.doc = emptyDoc()
			visit(member.shape, seen)
		}
		for (const method of plugin.methods) {
			method.doc = emptyDoc()
			method.returnsDoc = ''
			for (const param of method.params) {
				param.doc = ''
				visit(param.shape, seen)
			}
			visit(method.returnShape, seen)
		}
		for (const event of plugin.events) {
			event.doc = emptyDoc()
			for (const item of event.payload) {
				item.doc = ''
				visit(item.shape, seen)
			}
		}
		for (const reason of plugin.reasons ?? []) {
			reason.doc = emptyDoc()
			if (reason.payload !== null)
				visit(reason.payload.shape, seen)
		}
	}
}

/** A description as one string (the parameters, returns and payload positions keep the whole text). */
function textOf(description: string | null | undefined): string {
	return typeof description === 'string' ? description.trim() : ''
}

export function applyPluginDocs(ir: SystemIr, runtime: RuntimeFacts): void {
	resetDocs(ir)
	const issues: DocsIssue[] = []
	const issue = (kind: DocsIssue['kind'], site: Site, message: string): void => {
		issues.push({ kind, where: where(site), message })
	}
	const docsOf = new Map<string, PluginDocsData | null>(runtime.plugins.map(plugin => [plugin.type, plugin.docs]))
	ir.prose = runtime.plugins.some(plugin => plugin.docs !== null)
	let descriptions = 0
	let documented = 0

	// --- every `undocumented` marker, and the count ----------------------------------------------------
	const countedTypes = new Map<string, { canonical: string, plugin: string }>()
	const walkNode = (node: DocsNode | null | undefined, site: Site, descriptionRequired: boolean): void => {
		if (node === undefined)
			return
		if (node === null) {
			descriptions++
			issue('undocumented', site, `${where(site)} is undocumented.`)
			return
		}
		if (node.description !== undefined || descriptionRequired) {
			descriptions++
			if (typeof node.description === 'string')
				documented++
			else
				issue('undocumented', site, `${where(site)} is undocumented.`)
		}
		for (const [key, field] of Object.entries(node.fields ?? {}))
			walkNode(field, child(child(site, 'fields'), key), true)
		walkNode(node.items, child(site, 'items'), false)
		walkNode(node.values, child(site, 'values'), false)
	}
	const walkDescription = (description: string | null, site: Site): void => {
		descriptions++
		if (description === null)
			issue('undocumented', site, `${where(site)} is undocumented.`)
		else
			documented++
	}
	const walkPositions = (positions: readonly (DocsNode | null)[] | undefined, site: Site): void => {
		positions?.forEach((position, index) => walkNode(position, child(site, String(index)), true))
	}
	for (const plugin of ir.plugins) {
		const docs = docsOf.get(plugin.type)
		if (docs === undefined || docs === null)
			continue
		const site: Site = { plugin: plugin.type, path: '' }
		walkDescription(docs.description, child(site, 'description'))
		if (docs.config !== null) {
			walkDescription(docs.config.description, child(site, 'config'))
			walkNode(docs.config.raw, child(site, 'config.raw'), false)
			walkNode(docs.config.resolved, child(site, 'config.resolved'), false)
		}
		for (const [name, slot] of Object.entries(docs.slots ?? {}))
			walkDescription(slot.description, child(site, `slots.${name}`))
		for (const [name, node] of Object.entries(docs.state ?? {}))
			walkNode(node, child(site, `state.${name}`), true)
		for (const [name, node] of Object.entries(docs.properties ?? {}))
			walkNode(node, child(site, `properties.${name}`), true)
		for (const [name, method] of Object.entries(docs.methods ?? {})) {
			const at = child(site, `methods.${name}`)
			walkDescription(method.description, at)
			walkPositions(method.params, child(at, 'params'))
			walkNode(method.returns, child(at, 'returns'), true)
		}
		for (const [name, event] of Object.entries(docs.events ?? {})) {
			const at = child(site, `events.${name}`)
			walkDescription(event.description, at)
			walkPositions(event.payload, child(at, 'payload'))
		}
		for (const [name, reason] of Object.entries(docs.reasons ?? {})) {
			const at = child(site, `reasons.${name}`)
			walkDescription(reason.description, at)
			walkNode(reason.details, child(at, 'details'), false)
		}
		// Type docs are written once and may be referenced by several plugins: counted once, compared by content.
		for (const [name, node] of Object.entries(docs.types)) {
			const counted = countedTypes.get(name)
			const text = canonical(node)
			if (counted === undefined) {
				countedTypes.set(name, { canonical: text, plugin: plugin.type })
				walkNode(node, child(site, `types.${name}`), true)
			}
			else if (counted.canonical !== text) {
				issue('docs-conflict', child(site, `types.${name}`), `The type docs "${name}" of ${plugin.type} differ from those of ${counted.plugin}: one named type has one $defs entry, so give the two different names or make them identical.`)
			}
		}
	}

	// --- the prose, read beside the shapes ----------------------------------------------------------------
	const candidates = new Map<string, Candidate[]>()
	const chosen = new Map<string, Candidate>()
	const queue: string[] = []
	const addCandidate = (name: string, candidate: Candidate): void => {
		if (ir.types[name] === undefined)
			return
		const list = candidates.get(name)
		if (list === undefined) {
			candidates.set(name, [candidate])
			queue.push(name)
		}
		else {
			list.push(candidate)
		}
	}

	/** The members of a value shape: a union's members (flattened), without `null`. */
	const membersOf = (shape: Shape): Shape[] => shape.kind === 'union'
		? shape.members.flatMap(membersOf)
		: shape.kind === 'null' ? [] : [shape]

	/** The field names the docs at a position may name: the keys of every closed object type there, named types followed. */
	const keysAt = (shape: Shape, seen: Set<string> = new Set()): Set<string> => {
		const keys = new Set<string>()
		for (const member of membersOf(shape)) {
			if (member.kind === 'object' && member.additional === undefined) {
				member.properties.forEach(property => keys.add(property.name))
			}
			else if (member.kind === 'ref' && ir.types[member.name] !== undefined && !seen.has(member.name)) {
				seen.add(member.name)
				keysAt(ir.types[member.name]!.shape, seen)
					.forEach(key => keys.add(key))
			}
		}
		return keys
	}

	/**
	 * Applies the nested docs `node` to the value `shape` at `site`. `waived`: the description there is `undocumented`, so
	 * nested docs may be left out. `describesType`: the node's description describes the value's type itself.
	 * `checkKeys`: report field names the shape does not have (inline docs are checked where they are written).
	 * `elementKept`: the description was kept as an array's items or a dictionary's values description (`elementDoc`).
	 */
	const apply = (node: DocsNode | null | undefined, shape: Shape, site: Site, options: { waived: boolean, describesType: boolean, checkKeys: boolean, plugin: PluginDocsData, elementKept?: boolean }): void => {
		if (node === null || node === undefined)
			return
		const waived = options.waived || node.description === null
		// A description at a position that holds a value's type (`raw`, `resolved`, `items`, `values`, `details`) describes
		// that type: it goes to the one named type there (beside its type docs, if a `ref` names them, where a different
		// text is a `docs-conflict`), or to the items or values description. Anything else no output can show: reported.
		const typeNames = membersOf(shape)
			.filter((member): member is Extract<Shape, { kind: 'ref' }> => member.kind === 'ref')
		if (options.describesType && typeof node.description === 'string') {
			if (typeNames.length === 1)
				addCandidate(typeNames[0]!.name, { description: node.description, node: {}, site, waived: false, checkKeys: false, typeDocs: null })
			else if (options.elementKept !== true)
				issue('unused-doc', site, `${where(site)} describes a value that is not one named type, so no output shows this description: write it on the field that holds the value, or in the type docs of a named type.`)
		}
		if (node.ref !== undefined) {
			const typeDocs = options.plugin.types[node.ref]
			if (typeDocs === undefined) {
				issue('name-mismatch', child(site, 'ref'), `${where(site)} refers to the type docs "${node.ref}", which the plugin's docs do not have.`)
				return
			}
			const named = membersOf(shape)
				.filter((member): member is Extract<Shape, { kind: 'ref' }> => member.kind === 'ref')
			for (const member of named) {
				if (member.name !== node.ref)
					issue('name-mismatch', child(site, 'ref'), `${where(site)} refers to the type docs "${node.ref}", but the type there is ${member.name}: the type docs name is the type's $defs entry, so it must be the type's name.`)
				addCandidate(member.name, { description: typeDocs.description, node: typeDocs, site: { plugin: site.plugin, path: `types.${node.ref}` }, waived: typeDocs.description === null, checkKeys: true, typeDocs: node.ref })
			}
			// An unnamed type documented by type docs: they apply in place.
			const unnamed = membersOf(shape)
				.filter(member => member.kind === 'object' || member.kind === 'array' || member.kind === 'record')
			if (unnamed.length > 0)
				applyInline(typeDocs, { kind: 'union', members: unnamed }, { plugin: site.plugin, path: `types.${node.ref}` }, { ...options, waived: typeDocs.description === null, checkKeys: true })
			return
		}
		const members = membersOf(shape)
		const named = members.filter((member): member is Extract<Shape, { kind: 'ref' }> => member.kind === 'ref')
		for (const member of named) {
			addCandidate(member.name, {
				// A `null` (undocumented) description is the type's too; a string one was added above.
				description: options.describesType && named.length === 1 && node.description === null ? null : undefined,
				node,
				site,
				waived,
				checkKeys: false,
				typeDocs: null,
			})
		}
		applyInline(node, shape, site, { ...options, waived })
	}

	/** The description of an array's items or a dictionary's values, kept on the container unless the element is a named type (whose own description it is). */
	const elementDoc = (node: DocsNode | null | undefined, element: Shape): Doc | undefined => {
		if (node === null || node === undefined || typeof node.description !== 'string' || membersOf(element)
			.some(member => member.kind === 'ref')) {
			return undefined
		}
		return docOfDescription(node.description)
	}

	function applyInline(node: DocsNode, shape: Shape, site: Site, options: { waived: boolean, checkKeys: boolean, plugin: PluginDocsData }): void {
		const members = membersOf(shape)
		// Field names: checked against every closed object type at this position, named types included.
		if (node.fields !== undefined && options.checkKeys) {
			const allowed = keysAt(shape)
			for (const key of Object.keys(node.fields)) {
				if (!allowed.has(key))
					issue('name-mismatch', child(child(site, 'fields'), key), `${where(child(child(site, 'fields'), key))} documents a field the type does not have.`)
			}
		}
		const fieldSite = child(site, 'fields')
		const reported = new Set<string>()
		for (const member of members) {
			if (member.kind === 'object') {
				if (member.additional !== undefined) {
					// An index signature beside fixed keys: a dictionary, documented by its `values` (as in Core). The fixed keys
					// are values of the dictionary too, so they take the same docs.
					const values = node.values
					if (values !== null && values !== undefined) {
						for (const property of member.properties) {
							property.doc = docOfDescription(values.description)
							apply(values, property.shape, child(site, 'values'), { waived: options.waived, describesType: false, checkKeys: true, plugin: options.plugin })
						}
					}
					const additionalDoc = elementDoc(node.values, member.additional)
					if (additionalDoc !== undefined)
						member.additionalDoc = additionalDoc
					apply(node.values, member.additional, child(site, 'values'), { waived: options.waived, describesType: true, checkKeys: true, plugin: options.plugin, elementKept: additionalDoc !== undefined })
					continue
				}
				for (const property of member.properties) {
					const entry = node.fields?.[property.name]
					const at = child(fieldSite, property.name)
					if (entry === undefined) {
						if (!options.waived && !reported.has(property.name)) {
							reported.add(property.name)
							issue('missing-doc', at, `${where(at)} is missing: the type declares the field "${property.name}".`)
						}
						continue
					}
					if (entry === null)
						continue
					property.doc = docOfDescription(entry.description)
					apply(entry, property.shape, at, { waived: false, describesType: false, checkKeys: true, plugin: options.plugin })
				}
			}
			else if (member.kind === 'array') {
				const itemsDoc = elementDoc(node.items, member.items)
				if (itemsDoc !== undefined)
					member.itemsDoc = itemsDoc
				apply(node.items, member.items, child(site, 'items'), { waived: options.waived, describesType: true, checkKeys: true, plugin: options.plugin, elementKept: itemsDoc !== undefined })
			}
			else if (member.kind === 'record') {
				const valuesDoc = elementDoc(node.values, member.value)
				if (valuesDoc !== undefined)
					member.valuesDoc = valuesDoc
				apply(node.values, member.value, child(site, 'values'), { waived: options.waived, describesType: true, checkKeys: true, plugin: options.plugin, elementKept: valuesDoc !== undefined })
			}
		}
	}

	/** One entry per position: the parameters of a Method, the payload of an Event. */
	const applyPositions = <Position extends { shape: Shape }>(
		docs: readonly (DocsNode | null)[] | undefined,
		positions: readonly Position[],
		site: Site,
		waived: boolean,
		plugin: PluginDocsData,
		set: (position: Position, text: string) => void,
	): void => {
		positions.forEach((position, index) => {
			const entry = docs?.[index]
			const at = child(site, String(index))
			if (entry === undefined) {
				if (!waived)
					issue('missing-doc', at, `${where(at)} is missing: the types declare ${positions.length} position(s).`)
				return
			}
			if (entry === null)
				return
			set(position, textOf(entry.description))
			apply(entry, position.shape, at, { waived: false, describesType: false, checkKeys: true, plugin })
		})
		if (docs !== undefined && docs.length > positions.length) {
			// A rest parameter takes any number of entries; a fixed list takes one per position.
			issue('name-mismatch', site, `${where(site)} has ${docs.length} entries, but the types declare ${positions.length} position(s).`)
		}
	}

	const compareSection = (plugin: PluginIr, section: string, fromTypes: readonly string[] | null, fromDocs: Record<string, unknown> | null): void => {
		const site: Site = { plugin: plugin.type, path: section }
		if (fromTypes === null && fromDocs === null)
			return
		if (fromTypes === null || fromDocs === null) {
			issue('name-mismatch', site, `${where(site)}: the types ${fromTypes === null ? 'do not declare' : 'declare'} it, but plugin.docs ${fromDocs === null ? 'has no section' : 'has one'}.`)
			return
		}
		const names = Object.keys(fromDocs)
		const missing = fromTypes.filter(name => !names.includes(name))
		const extra = names.filter(name => !fromTypes.includes(name))
		if (missing.length > 0)
			issue('name-mismatch', site, `${where(site)}: declared in the types but not in plugin.docs: ${missing.join(', ')}.`)
		if (extra.length > 0)
			issue('name-mismatch', site, `${where(site)}: in plugin.docs but not declared in the types: ${extra.join(', ')}.`)
	}

	for (const plugin of ir.plugins) {
		const docs = docsOf.get(plugin.type)
		const site: Site = { plugin: plugin.type, path: '' }
		if (docs === undefined)
			continue
		if (docs === null) {
			if (ir.prose)
				issue('missing-doc', site, `${plugin.type} has no plugin.docs (a plugin built with a Core before 0.4?).`)
			continue
		}
		plugin.doc = docOfDescription(docs.description)
		const options = (waived: boolean, describesType: boolean) => ({ waived, describesType, checkKeys: true, plugin: docs })

		compareSection(plugin, 'config', plugin.config === null ? null : [], docs.config === null ? null : {})
		if (plugin.config !== null && docs.config !== null) {
			plugin.config.doc = docOfDescription(docs.config.description)
			const waived = docs.config.description === null
			for (const key of ['raw', 'resolved'] as const) {
				const node = docs.config[key]
				const at = child(site, `config.${key}`)
				if (node === undefined && !waived)
					issue('missing-doc', at, `${where(at)} is missing.`)
				apply(node, key === 'raw' ? plugin.config.rawShape : plugin.config.resolvedShape, at, options(waived, true))
			}
		}

		compareSection(plugin, 'slots', plugin.capabilities.slots ? plugin.slots.map(slot => slot.name) : null, docs.slots)
		for (const slot of plugin.slots)
			slot.doc = docOfDescription(docs.slots?.[slot.name]?.description)

		compareSection(plugin, 'state', plugin.capabilities.state ? plugin.state.map(member => member.name) : null, docs.state)
		compareSection(plugin, 'properties', plugin.capabilities.properties ? plugin.properties.map(member => member.name) : null, docs.properties)
		for (const [section, members] of [['state', plugin.state], ['properties', plugin.properties]] as const) {
			for (const member of members) {
				const node = (section === 'state' ? docs.state : docs.properties)?.[member.name]
				if (node === undefined)
					continue
				member.doc = docOfDescription(node.description)
				apply(node, member.shape, child(site, `${section}.${member.name}`), options(false, false))
			}
		}

		compareSection(plugin, 'methods', plugin.capabilities.methods ? plugin.methods.map(method => method.name) : null, docs.methods)
		for (const method of plugin.methods) {
			const entry = docs.methods?.[method.name]
			if (entry === undefined)
				continue
			const at = child(site, `methods.${method.name}`)
			const waived = entry.description === null
			method.doc = docOfDescription(entry.description)
			applyPositions(entry.params, method.params, child(at, 'params'), waived, docs, (param, text) => {
				param.doc = text
			})
			const returnsValue = !['void', 'undefined', 'never'].includes(method.returnText)
			if (entry.returns === undefined) {
				if (returnsValue && !waived)
					issue('missing-doc', child(at, 'returns'), `${where(child(at, 'returns'))} is missing: the Method returns ${method.returnText}.`)
			}
			else if (entry.returns !== null) {
				method.returnsDoc = textOf(entry.returns.description)
				apply(entry.returns, method.returnShape, child(at, 'returns'), options(false, false))
			}
		}

		compareSection(plugin, 'events', plugin.capabilities.events ? plugin.events.map(event => event.name) : null, docs.events)
		for (const event of plugin.events) {
			const entry = docs.events?.[event.name]
			if (entry === undefined)
				continue
			event.doc = docOfDescription(entry.description)
			applyPositions(entry.payload, event.payload, child(site, `events.${event.name}.payload`), entry.description === null, docs, (item, text) => {
				item.doc = text
			})
		}

		compareSection(plugin, 'reasons', plugin.reasons === null ? null : plugin.reasons.map(reason => reason.name), docs.reasons)
		for (const reason of plugin.reasons ?? []) {
			const entry = docs.reasons?.[reason.name]
			if (entry === undefined)
				continue
			reason.doc = docOfDescription(entry.description)
			const at = child(site, `reasons.${reason.name}.details`)
			if (reason.payload !== null) {
				if (entry.details === undefined && entry.description !== null)
					issue('missing-doc', at, `${where(at)} is missing: the reason has a payload.`)
				apply(entry.details, reason.payload.shape, at, options(entry.description === null, true))
			}
		}
	}

	// --- the named types: one entry each, from every place that documents it -----------------------------
	// A place whose docs say nothing below the description (a dictionary of strings documented by its description only)
	// adds nothing to the entry and is not compared. Type docs come first, then the places in the order they were read.
	const hasNested = (candidate: Candidate): boolean => candidate.node.fields !== undefined || candidate.node.items !== undefined || candidate.node.values !== undefined
	const preferred = (list: readonly Candidate[]): Candidate => list.find(candidate => candidate.typeDocs !== null) ?? list.find(hasNested) ?? list[0]!
	// The worklist grows while it runs: applying a type's docs reaches the named types inside it.
	for (let index = 0; index < queue.length; index++) {
		const name = queue[index]!
		const list = candidates.get(name)!
		const type: NamedType = ir.types[name]!
		const pick = preferred(list)
		chosen.set(name, pick)
		const description = (list.find(candidate => candidate.typeDocs !== null && candidate.description !== undefined) ?? list.find(candidate => candidate.description !== undefined))?.description
		type.doc = docOfDescription(description)
		applyInline(pick.node, type.shape, pick.site, { waived: pick.waived, checkKeys: pick.checkKeys, plugin: docsOf.get(pick.site.plugin)! })
	}
	// Conflicts: every place that documents a named type must say the same, since it has one $defs entry.
	const sameTypeDocs = (a: Candidate, b: Candidate): boolean => a.typeDocs !== null && a.typeDocs === b.typeDocs
	for (const [name, list] of candidates) {
		const pick = chosen.get(name)!
		const reported = new Set<string>()
		for (const candidate of list) {
			if (candidate === pick || sameTypeDocs(candidate, pick) || reported.has(where(candidate.site)))
				continue
			if (hasNested(candidate) && (hasNested(pick) || candidate.typeDocs !== null) && nestedOf(candidate.node) !== nestedOf(pick.node)) {
				reported.add(where(candidate.site))
				issue('docs-conflict', candidate.site, `${where(candidate.site)} documents ${name} differently from ${where(pick.site)}, and ${name} has one $defs entry: document it once with defineTypeDocs and refer to it with ref.`)
			}
		}
		const describing = list.filter(candidate => typeof candidate.description === 'string')
		const first = describing.find(candidate => candidate.typeDocs !== null) ?? describing[0]
		for (const candidate of describing) {
			if (first === undefined || candidate === first || sameTypeDocs(candidate, first) || reported.has(where(candidate.site)))
				continue
			if (candidate.description !== first.description) {
				reported.add(where(candidate.site))
				issue('docs-conflict', candidate.site, `${where(candidate.site)} describes ${name} differently from ${where(first.site)}, and ${name} has one $defs entry.`)
			}
		}
	}

	// One report per place: a named type reached from several places reports a problem in its docs once.
	const unique = new Map<string, DocsIssue>()
	for (const entry of issues) {
		const key = `${entry.kind}\0${entry.where}\0${entry.message}`
		if (!unique.has(key))
			unique.set(key, entry)
	}
	ir.docsIssues = [...unique.values()]
	ir.docsCount = { descriptions, documented }
}
