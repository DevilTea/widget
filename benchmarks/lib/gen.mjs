/**
 * Deterministic synthetic documents and a matching plugin set.
 *
 * Two plugins:
 *   group  a container: slot `children`, State `level`, optionally an aggregating Property `total`
 *          that depends on every child (`dep.widget(childId)`), optionally structure validators.
 *   unit   a leaf with everything a real widget has, controlled by the spec: optional config, `state`
 *          State members (s0 ...), Properties of four kinds (none / self / parent / widget dependency),
 *          Methods (noop, rw = reads and writes State, invokeSelf = reads a Property and invokes a
 *          Method, emit = writes State and emits an Event), and one Event `changed`.
 *
 * Nothing here is random: the same spec always yields the same document, the same ids, and the same
 * dependency targets (unit u<j> depends on unit u<j+1 mod U>).
 */

import { loadCore } from './load.mjs'

const core = await loadCore()
const { createWidgetPlugin, createWidgetSystem } = core

/** What a "standard" unit looks like: roughly the shape of the Lab's survey / CRM plugins, a little larger. */
export const STANDARD = Object.freeze({
	shape: 'tree', // 'flat' | 'tree' | 'deep'
	fanout: 8, // tree: children per group
	depth: 60, // deep: length of the group spine (the Core limit is about 85 levels)
	config: true,
	state: 3,
	props: Object.freeze({ none: 1, self: 2, parent: 1, widget: 1 }),
	methods: Object.freeze({ noop: true, rw: true, invokeSelf: true, emit: true }),
	events: true,
	structure: false, // slot-level, plugin-level and system-level validators
	aggregate: false, // group Property `total` over all children
})

/** Named profiles used by the scenarios. */
export const PROFILES = Object.freeze({
	bare: Object.freeze({ ...STANDARD, props: Object.freeze({ none: 0, self: 0, parent: 0, widget: 0 }), methods: Object.freeze({}), events: false }),
	selfDeps: Object.freeze({ ...STANDARD, props: Object.freeze({ none: 0, self: 3, parent: 0, widget: 0 }), methods: Object.freeze({ noop: true, rw: true }), events: false }),
	standard: STANDARD,
	// Lots of cross-widget dependencies: each unit has Properties on its parent and on another unit.
	crossDeps: Object.freeze({ ...STANDARD, props: Object.freeze({ none: 0, self: 1, parent: 2, widget: 2 }) }),
	validated: Object.freeze({ ...STANDARD, structure: true }),
	aggregated: Object.freeze({ ...STANDARD, aggregate: true }),
})

export function resolveSpec(overrides = {}) {
	return {
		...STANDARD,
		...overrides,
		props: { ...STANDARD.props, ...(overrides.props ?? {}) },
		methods: overrides.methods ?? STANDARD.methods,
	}
}

/** Structure of an N-widget tree: parent index per node (node 0 is the root group). */
export function layout(widgets, spec) {
	const parents = new Int32Array(widgets)
		.fill(-1)
	const childCount = new Int32Array(widgets)
	for (let i = 1; i < widgets; i++) {
		let parent
		if (spec.shape === 'flat') {
			parent = 0
		}
		else if (spec.shape === 'deep') {
			// A spine of `depth` groups; every other node hangs off a spine node in round-robin order.
			const spine = Math.min(spec.depth, widgets)
			parent = i < spine ? i - 1 : i % spine
		}
		else {
			parent = Math.floor((i - 1) / spec.fanout)
		}
		parents[i] = parent
		childCount[parent]++
	}
	// A node with children is a group; a node without is a unit. The root is always a group.
	const kind = Array.from({ length: widgets })
	const id = Array.from({ length: widgets })
	let groups = 0
	let units = 0
	for (let i = 0; i < widgets; i++) {
		if (i === 0 || childCount[i] > 0) {
			kind[i] = 'group'
			id[i] = i === 0 ? 'root' : `g${groups}`
			groups++
		}
		else {
			kind[i] = 'unit'
			id[i] = `u${units}`
			units++
		}
	}
	return { widgets, parents, childCount, kind, id, groups, units }
}

function sumResults(...results) {
	let total = 0
	for (const result of results) {
		if (result.ok && typeof result.value === 'number')
			total += result.value
	}
	return total
}

/** The two plugins for a spec. `units` is the number of unit widgets (the target of `dep.widget`). */
export function createPlugins(spec, units) {
	const stateCount = Math.max(1, spec.state)
	const stateKey = k => `s${k % stateCount}`
	const numberState = initial => ({
		validate: input => typeof input === 'number',
		default: () => initial,
	})
	const hasProps = spec.props.none + spec.props.self + spec.props.parent + spec.props.widget > 0
	const hasMethods = Object.values(spec.methods)
		.some(Boolean)

	// ----- unit ---------------------------------------------------------------------------------
	let unit = createWidgetPlugin('unit')
		.description('Synthetic leaf widget')
		.interfaces()
	if (spec.config) {
		unit = unit.config({
			description: 'Synthetic unit config',
			validate: input => input === null || (typeof input === 'object' && input !== null && typeof input.step === 'number'),
			resolve: raw => ({ step: raw?.step ?? 1 }),
		})
	}
	if (spec.structure) {
		unit = unit.structure(({ widget, blueprint, addDiagnostic }) => {
			if (blueprint.getParent(widget) === null)
				addDiagnostic({ message: 'a unit cannot be the root', reason: 'unit-at-root' })
		})
	}
	unit = unit.state((section) => {
		let s = section
		for (let k = 0; k < stateCount; k++)
			s = s[`s${k}`](numberState(k))
		return s
	})
	if (hasProps) {
		unit = unit.properties((section) => {
			let s = section
			for (let k = 0; k < spec.props.none; k++) {
				s = s[`pn${k}`]({
					compute: ({ config }) => (config === undefined ? 1 : config.step) * (k + 1),
				})
			}
			for (let k = 0; k < spec.props.self; k++) {
				s = s[`ps${k}`]({
					registerDeps: ({ dep }) => ({ a: dep.self.state.get(stateKey(k)), b: dep.self.state.get(stateKey(k + 1)) }),
					compute: ({ deps }) => sumResults(deps.a(), deps.b()),
				})
			}
			for (let k = 0; k < spec.props.parent; k++) {
				s = s[`pp${k}`]({
					registerDeps: ({ dep }) => ({ level: dep.parent.state.get('level') }),
					compute: ({ deps }) => sumResults(deps.level()) + k,
				})
			}
			for (let k = 0; k < spec.props.widget; k++) {
				s = s[`pw${k}`]({
					registerDeps: ({ widget, dep }) => {
						const index = Number(widget.id.slice(1))
						return { peer: dep.widget(`u${(index + 1 + k) % units}`).state.get('s0') }
					},
					compute: ({ deps }) => sumResults(deps.peer()),
				})
			}
			return s
		})
	}
	if (hasMethods) {
		unit = unit.methods((section) => {
			let s = section
			const m = spec.methods
			if (m.noop) {
				s = s.noop({
					validateArgs: args => args.length === 0,
					execute: () => 0,
				})
			}
			if (m.rw) {
				s = s.rw({
					validateArgs: args => args.length === 0,
					registerDeps: ({ dep }) => ({
						a: dep.self.state.get('s0'),
						b: dep.self.state.get(stateKey(1)),
						set: dep.self.state.set(stateKey(stateCount - 1)),
					}),
					execute: ({ deps }) => {
						const value = sumResults(deps.a(), deps.b()) + 1
						deps.set(value)
						return value
					},
				})
			}
			if (m.invokeSelf && spec.props.self > 0 && m.noop) {
				s = s.invokeSelf({
					validateArgs: args => args.length === 0,
					registerDeps: ({ dep }) => ({
						noop: dep.self.methods.invoke('noop'),
						prop: dep.self.properties.get('ps0'),
					}),
					execute: ({ deps }) => sumResults(deps.noop(), deps.prop()),
				})
			}
			if (m.emit && spec.events) {
				s = s.emit({
					validateArgs: args => args.length === 1 && typeof args[0] === 'number',
					registerDeps: ({ dep }) => ({ set: dep.self.state.set('s0') }),
					execute: ({ args: [value], deps, emit }) => {
						deps.set(value)
						emit.changed(value)
						return value
					},
				})
			}
			return s
		})
	}
	if (spec.events)
		unit = unit.events(section => section.changed({ description: 'The unit changed' }))
	const unitPlugin = unit.done()

	// ----- group --------------------------------------------------------------------------------
	let group = createWidgetPlugin('group')
		.description('Synthetic container widget')
		.interfaces()
	group = group.slots({
		children: spec.structure
			? {
					description: 'Child widgets',
					validateStructure: ({ children, addDiagnostic }) => {
						if (children.length < 0)
							addDiagnostic({ message: 'negative length', index: 0 })
					},
				}
			: { description: 'Child widgets' },
	})
	if (spec.structure) {
		group = group.structure(({ widget, addDiagnostic }) => {
			if (widget.slots.children === undefined)
				addDiagnostic({ message: 'missing slot', reason: 'no-children-slot' })
		})
	}
	group = group.state(section => section.level({
		validate: input => typeof input === 'number',
		default: () => 0,
	}))
	if (spec.aggregate) {
		group = group.properties(section => section.total({
			registerDeps: ({ widget, blueprint, dep }) => ({
				children: blueprint.getChildrenAt(widget, 'children')
					.flatMap(child => child.resolved
						? [dep.widget(child.id).state.get(child.type === 'unit' ? 's0' : 'level')]
						: []),
			}),
			compute: ({ deps }) => sumResults(...deps.children.map(read => read())),
		}))
	}
	const groupPlugin = group.done()

	return { unit: unitPlugin, group: groupPlugin }
}

/** Plugins + System for a spec and widget count. */
export function createFixtureSystem(spec, widgets) {
	const lay = layout(widgets, spec)
	const plugins = createPlugins(spec, Math.max(1, lay.units))
	const options = { plugins: [plugins.group, plugins.unit] }
	if (spec.structure) {
		options.validateStructure = ({ blueprint, addDiagnostic }) => {
			if (!blueprint.root.resolved)
				addDiagnostic({ message: 'unresolved root', location: { type: 'widget', node: blueprint.root } })
		}
	}
	return { system: createWidgetSystem(options), plugins, layout: lay }
}

/** The nested authored source for an N-widget layout. */
export function generateSource(spec, lay) {
	const nodes = Array.from({ length: lay.widgets })
	let unitIndex = 0
	for (let i = 0; i < lay.widgets; i++) {
		if (lay.kind[i] === 'group') {
			nodes[i] = { id: lay.id[i], type: 'group', slots: { children: [] } }
		}
		else {
			const node = { id: lay.id[i], type: 'unit' }
			if (spec.config)
				node.config = { step: 1 + (unitIndex % 5) }
			nodes[i] = node
			unitIndex++
		}
	}
	for (let i = 1; i < lay.widgets; i++)
		nodes[lay.parents[i]].slots.children.push(nodes[i])
	return nodes[0]
}

/** A whole synthetic fixture: system, layout, source (and its JSON text on demand). */
export function createFixture(overrides, widgets) {
	const spec = resolveSpec(overrides)
	const { system, plugins, layout: lay } = createFixtureSystem(spec, widgets)
	const source = generateSource(spec, lay)
	return {
		spec,
		widgets,
		system,
		plugins,
		layout: lay,
		source,
		get json() {
			return JSON.stringify(source)
		},
		/** Compile; throws if the document is not valid (every valid-path scenario asserts this once). */
		compileValid() {
			const blueprint = system.createBlueprint(source)
			if (blueprint.status !== 'valid') {
				throw new Error(`fixture is not valid: ${blueprint.diagnostics.slice(0, 3)
					.map(d => `${d.code}: ${d.message}`)
					.join('; ')}`)
			}
			return blueprint
		},
		unitIds() {
			const ids = []
			for (let i = 0; i < lay.widgets; i++) {
				if (lay.kind[i] === 'unit')
					ids.push(lay.id[i])
			}
			return ids
		},
	}
}

/** Documents with many diagnostics. All use the `bare` profile so dependency noise does not mix in. */
export function createInvalidFixture(kind, widgets, options = {}) {
	const fixture = createFixture({ ...PROFILES.bare, shape: options.shape ?? 'flat' }, widgets)
	const source = generateSource(fixture.spec, fixture.layout)
	const walk = []
	;(function visit(node) {
		walk.push(node)
		for (const child of node.slots?.children ?? [])
			visit(child)
	})(source)
	const sharing = options.sharing ?? widgets
	switch (kind) {
		case 'unknown-type':
			for (const node of walk.slice(1))
				node.type = 'no-such-plugin'
			break
		case 'bad-config':
			for (const node of walk) {
				if (node.type === 'unit')
					node.config = { step: 'not a number' }
			}
			break
		case 'unexpected-field':
			for (const node of walk)
				node.label = 'extra'
			break
		case 'duplicate-id-one':
			// `sharing` nodes carry the same id: quadratic in the number sharing it, per the known behavior.
			for (let i = 0; i < Math.min(sharing, walk.length); i++)
				walk[i].id = 'shared'
			break
		case 'duplicate-id-pairs':
			// Every id appears exactly twice: many small groups instead of one big one.
			for (let i = 0; i < walk.length; i++)
				walk[i].id = `pair${i >> 1}`
			break
		default:
			throw new Error(`unknown invalid kind ${kind}`)
	}
	return { ...fixture, source, expectedInvalid: true }
}
