/**
 * The repair desk's plugins against real Runtimes: `SavedDraft.findings` compiles the stored document with the OTHER (inner)
 * system inside a Property `compute`, which Core allows (it is an ordinary synchronous call, not a Runtime callback), and
 * `SavedDraft.plan` is the application's migration plan. The State members start at "no session".
 */

import { describe, expect, it } from 'vitest'
import { planRepair } from '../domain'
import { legacyV1, legacyV3 } from '../fixtures'
import { createRepairRuntime, createRuntimeFor, valueOf, widgetsOf } from '../test-support'
import { projectFindings } from './findings'

describe('savedDraft.findings', () => {
	it('compiles the stored v1 draft with the notice board system inside the Property and says where the problems are', () => {
		const { v1 } = widgetsOf(createRepairRuntime().runtime)
		const findings = valueOf(v1.properties.findings.get())
		expect(findings.status)
			.toBe('invalid')
		expect(findings.sourceJsonCompatible)
			.toBe(true)
		const byCode = (code: string) => findings.diagnostics.filter(diagnostic => diagnostic.code === code)
		// The undeclared slot is reported on the root (path []), with the raw slot's key in `path` (not shown here).
		expect(byCode('undeclared-widget-slot')
			.map(diagnostic => diagnostic.sourcePath))
			.toEqual([[]])
		// Every Banner is an unknown type at its own position in the (undeclared) slot `items`.
		expect(byCode('unknown-widget-type')
			.map(diagnostic => diagnostic.sourcePath))
			.toEqual([['slots', 'items', 0], ['slots', 'items', 1], ['slots', 'items', 2], ['slots', 'items', 3]])
		expect(byCode('unexpected-widget-field')
			.map(diagnostic => diagnostic.sourcePath))
			.toEqual([['slots', 'items', 0]])
		expect(byCode('duplicate-widget-id')
			.map(diagnostic => diagnostic.sourcePath))
			.toEqual([['slots', 'items', 1], ['slots', 'items', 2]])
		expect(byCode('invalid-widget-id')
			.map(diagnostic => diagnostic.sourcePath))
			.toEqual([['slots', 'items', 3]])
	})

	it('summarizes the recovered nodes: unresolved ones keep their id and type as hints, the undeclared slot is a raw-slot placement', () => {
		const { v1 } = widgetsOf(createRepairRuntime().runtime)
		const { nodes } = valueOf(v1.properties.findings.get())
		expect(nodes)
			.toHaveLength(5)
		expect(nodes[0])
			.toEqual({ sourcePath: [], resolved: true, id: 'board', type: 'Board', slots: [{ name: 'items', placement: 'raw-slot', children: 4 }] })
		expect(nodes.slice(1)
			.map(node => [node.resolved, node.id, node.type]))
			.toEqual([[false, 'welcome', 'Banner'], [false, 'closure', 'Banner'], [false, 'closure', 'Banner'], [false, null, 'Banner']])
	})

	it('is valid for the v3 draft, with a declared slot placement and resolved nodes', () => {
		const { v3 } = widgetsOf(createRepairRuntime().runtime)
		const findings = valueOf(v3.properties.findings.get())
		expect(findings.status)
			.toBe('valid')
		expect(findings.diagnostics)
			.toEqual([])
		expect(findings.nodes.map(node => node.resolved))
			.toEqual([true, true, true])
		expect(findings.nodes[0]!.slots)
			.toEqual([{ name: 'notices', placement: 'slot', children: 2 }])
	})

	it('reports a source outside the JSON domain at the source level, with the diagnostic\'s own path', () => {
		const findings = projectFindings({ id: 'board', type: 'Board', config: { title: { en: 'x' } }, slots: { notices: [] }, meta: { value: Number.POSITIVE_INFINITY } })
		expect(findings.sourceJsonCompatible)
			.toBe(false)
		expect(findings.diagnostics)
			.toEqual([expect.objectContaining({ code: 'json-incompatible-value', reason: 'non-finite-number', sourcePath: ['meta', 'value'] })])
	})

	it('never throws for a stored value that is not even an object', () => {
		for (const source of [null, 7, 'text', [], [1, 2]]) {
			const findings = projectFindings(source)
			expect(findings.status, JSON.stringify(source))
				.toBe('invalid')
		}
	})

	it('does not touch the stored source: the Property reads it, the Blueprint compiles it', () => {
		const { runtime } = createRepairRuntime()
		const before = JSON.stringify(valueOf(widgetsOf(runtime).v1.properties.source.get()))
		valueOf(widgetsOf(runtime).v1.properties.findings.get())
		expect(JSON.stringify(valueOf(widgetsOf(runtime).v1.properties.source.get())))
			.toBe(before)
		expect(before)
			.toBe(JSON.stringify(legacyV1))
	})
})

describe('savedDraft.plan', () => {
	it('is the application\'s plan for the stored source and its version', () => {
		const { v1, v2, v3, poll } = widgetsOf(createRepairRuntime().runtime)
		expect(valueOf(v1.properties.plan.get()))
			.toEqual(planRepair(legacyV1, '1.x'))
		expect(valueOf(v1.properties.plan.get())
			.map(step => step.id))
			.toEqual(['rename-slot', 'rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id'])
		expect(valueOf(v2.properties.plan.get())
			.map(step => step.id))
			.toEqual(['convert-until'])
		expect(valueOf(v3.properties.plan.get()))
			.toEqual([])
		expect(valueOf(poll.properties.plan.get())
			.map(step => step.id))
			.toEqual(['convert-until'])
	})

	it('is JSON, so the Lab\'s Inspector can show it', () => {
		const { v1 } = widgetsOf(createRepairRuntime().runtime)
		const plan = valueOf(v1.properties.plan.get())
		expect(JSON.parse(JSON.stringify(plan)))
			.toEqual(plan)
	})
})

describe('savedDraft State and config', () => {
	it('starts as "no session" and accepts the host\'s writes only in range', () => {
		const { v1 } = widgetsOf(createRepairRuntime().runtime)
		expect([v1.state.revision.get(), v1.state.appRevision.get(), v1.state.repaired.get()])
			.toEqual([-1, -1, false])
		v1.state.revision.set(3)
		expect(v1.state.revision.get())
			.toBe(3)
		expect(v1.state.revision.set(-5).ok)
			.toBe(false)
		expect(v1.state.revision.get())
			.toBe(3)
	})

	it('keeps `null` and any other JSON as the stored source', () => {
		const { runtime } = createRuntimeFor({
			id: 'desk',
			type: 'RepairDesk',
			config: { appVersion: '3.0' },
			slots: { drafts: [{ id: 'a', type: 'SavedDraft', config: { title: 'Empty', savedWith: '1.x', source: null } }, { id: 'b', type: 'SavedDraft', config: { title: 'Number', savedWith: '1.x', source: 42 } }] },
		})
		const draft = (id: string) => runtime.getWidget(id) as ReturnType<typeof widgetsOf>['v1']
		expect(valueOf(draft('a').properties.findings.get()).status)
			.toBe('invalid')
		expect(valueOf(draft('a').properties.source.get()))
			.toBeNull()
		expect(valueOf(draft('b').properties.source.get()))
			.toBe(42)
		expect(valueOf(draft('b').properties.plan.get()))
			.toEqual([])
	})
})

describe('the repaired v3 fixture', () => {
	it('is valid in the notice board system and a Runtime can be created from it', () => {
		const findings = projectFindings(legacyV3)
		expect(findings.status)
			.toBe('valid')
	})
})
