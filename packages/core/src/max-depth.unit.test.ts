/**
 * Deeply nested input must produce diagnostics or operation failures, never a stack-overflow `RangeError`.
 * `MAX_JSON_DEPTH` is the one documented nesting bound for authored source and SourcePatch operands.
 */

import type { JsonValue, WidgetInterfaces } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem, isJsonValue, MAX_JSON_DEPTH } from './index'
import { inspectBlueprint } from './inspection'

interface NoteInterfaces extends WidgetInterfaces {
	config: {
		raw: Record<string, JsonValue> | null
		resolved: Record<string, JsonValue>
	}
	slots: 'children'
}

const notePlugin = createWidgetPlugin('note')
	.description('Test widget')
	.interfaces<NoteInterfaces>()
	.config({
		description: 'Test config',
		validate: (_input): _input is Record<string, JsonValue> | null => true,
		resolve: raw => raw ?? {},
	})
	.slots({ children: { description: 'Test slot' } })
	.done()

const system = createWidgetSystem({ plugins: [notePlugin] })

/** `levels` nested single-element arrays around `0`: a value nested inside exactly `levels` containers. */
function nestedArrays(levels: number): unknown {
	let value: unknown = 0
	for (let level = 0; level < levels; level++)
		value = [value]
	return value
}

/** A chain of `count` widgets (the root plus `count - 1` descendants), each the only child of the previous. */
function widgetChain(count: number): unknown {
	let node: Record<string, unknown> = { id: `n${count - 1}`, type: 'note' }
	for (let index = count - 2; index >= 0; index--)
		node = { id: `n${index}`, type: 'note', slots: { children: [node] } }
	return node
}

function codes(blueprint: ReturnType<typeof system.createBlueprint>): string[] {
	return blueprint.diagnostics.map(diagnostic => diagnostic.code)
}

describe('maximum JSON depth', () => {
	it('is a documented public constant leaving a wide margin below the engine limit', () => {
		expect(MAX_JSON_DEPTH)
			.toBeGreaterThanOrEqual(100)
		expect(MAX_JSON_DEPTH)
			.toBeLessThanOrEqual(1000)
	})

	it('admits a value nested exactly MAX_JSON_DEPTH containers deep and rejects one more', () => {
		expect(isJsonValue(nestedArrays(MAX_JSON_DEPTH)))
			.toBe(true)
		expect(isJsonValue(nestedArrays(MAX_JSON_DEPTH + 1)))
			.toBe(false)
		expect(isJsonValue({ nested: nestedArrays(MAX_JSON_DEPTH - 1) }))
			.toBe(true)
		expect(isJsonValue({ nested: nestedArrays(MAX_JSON_DEPTH) }))
			.toBe(false)
	})

	it('answers isJsonValue for arbitrarily deep input without throwing', () => {
		expect(isJsonValue(nestedArrays(200_000)))
			.toBe(false)
	})
})

describe('createBlueprint with deep input', () => {
	it('reports deep config as a json-incompatible-value diagnostic at the first container beyond the bound', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'note', config: nestedArrays(50_000) })

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		const [diagnostic] = blueprint.diagnostics
		expect(blueprint.diagnostics)
			.toHaveLength(1)
		expect(diagnostic)
			.toMatchObject({ code: 'json-incompatible-value', location: { type: 'source' }, reason: 'max-depth-exceeded' })
		// root object (1) + config array levels: the offending container is nested inside MAX_JSON_DEPTH others.
		const path = diagnostic !== undefined && 'path' in diagnostic ? diagnostic.path : undefined
		expect(path)
			.toHaveLength(MAX_JSON_DEPTH)
		expect(path?.slice(0, 2))
			.toEqual(['config', 0])
	})

	it('admits config exactly at the bound', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'note', config: nestedArrays(MAX_JSON_DEPTH - 1) })

		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
	})

	it.each([2_000, 5_000, 100_000])('does not throw for a widget tree %i levels deep, recovering the shallow part', (levels) => {
		const blueprint = system.createBlueprint(widgetChain(levels))

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(blueprint.root.resolved)
			.toBe(true)
		expect(blueprint.getWidget('n0'))
			.not
			.toBeNull()
		expect(codes(blueprint))
			.toContain('json-incompatible-value')
		expect(codes(blueprint))
			.toContain('invalid-widget-definition')
		// The recovered tree is bounded by the depth limit, not by the input.
		expect(blueprint.getWidget(`n${levels - 1}`))
			.toBeNull()
	})

	it('admits the deepest widget tree whose containers stay within the bound', () => {
		// A widget nests three containers per tree level (node, `slots`, slot Array): the node at tree level L
		// is nested inside 3L others, and a leaf node adds only its own container.
		const levels = Math.floor((MAX_JSON_DEPTH - 1) / 3) + 1
		const fits = system.createBlueprint(widgetChain(levels))
		const tooDeep = system.createBlueprint(widgetChain(levels + 1))

		expect(codes(fits))
			.toEqual([])
		expect(fits.status)
			.toBe('valid')
		expect(tooDeep.status)
			.toBe('invalid')
		expect(codes(tooDeep))
			.toContain('json-incompatible-value')
	})

	it('reports the same facts through createBlueprintFromJson for deep text', () => {
		// `JSON.stringify` itself recurses, so build the text directly.
		const levels = 5_000
		const text = `${'{"id":"x","type":"note","slots":{"children":['.repeat(levels)}{"id":"leaf","type":"note"}${']}}'.repeat(levels)}`
		const fromJson = system.createBlueprintFromJson(text)
		const fromValue = system.createBlueprint(JSON.parse(text))

		expect(fromJson.status)
			.toBe('invalid')
		expect(fromJson.sourceJsonCompatible)
			.toBe(false)
		expect(codes(fromJson))
			.toEqual(codes(fromValue))
	})

	it('keeps accepting JSON text exactly at the bound through the fast path', () => {
		const text = `{"id":"root","type":"note","config":${'['.repeat(MAX_JSON_DEPTH - 1)}0${']'.repeat(MAX_JSON_DEPTH - 1)}}`

		expect(system.createBlueprintFromJson(text).status)
			.toBe('valid')
	})

	it('does not throw for a widget tree that is also cyclic', () => {
		const root: Record<string, unknown> = { id: 'root', type: 'note', slots: { children: [] } }
		;(root.slots as { children: unknown[] }).children.push(root)

		expect(() => system.createBlueprint(root))
			.not
			.toThrow()
	})
})

describe('the node at which recovery stops', () => {
	/** The levels of the deepest widget chain whose containers stay within the bound. */
	const fittingLevels = Math.floor((MAX_JSON_DEPTH - 1) / 3) + 1

	function deepestNode(blueprint: ReturnType<typeof system.createBlueprint>) {
		let node = blueprint.root
		for (let children = blueprint.getChildren(node); children.length > 0; children = blueprint.getChildren(node))
			node = children[0]!
		return node
	}

	it('has a source path the patch engine accepts, so removing or replacing it works', () => {
		for (const op of ['remove', 'replace'] as const) {
			const document = createWidgetDocument({ system, source: widgetChain(fittingLevels + 1) })
			const blueprint = document.getSnapshot().blueprint
			const cutOff = deepestNode(blueprint)
			const path = blueprint.getSourcePath(cutOff)!

			expect(cutOff.diagnostics.map(diagnostic => diagnostic.code))
				.toEqual(['invalid-widget-definition'])
			expect(path)
				.toHaveLength(MAX_JSON_DEPTH + 2)
			expect(inspectBlueprint(blueprint).nodes.find(node => node.node === cutOff)?.sourcePath)
				.toEqual(path)

			const patch = op === 'remove' ? [{ op, path }] as const : [{ op, path, value: { id: 'replacement', type: 'note' } }] as const
			expect(document.applyPatch(patch))
				.toEqual({ ok: true, changed: true })
			const patched = document.getSnapshot().blueprint
			const deepest = deepestNode(patched)
			if (op === 'remove') {
				// Its parent is now the deepest node; its (empty) slots are still beyond the bound.
				expect(deepest.id)
					.toBe(`n${fittingLevels - 1}`)
				expect(codes(patched))
					.not
					.toContain('invalid-widget-definition')
			}
			else {
				expect(deepest)
					.toMatchObject({ resolved: false, id: 'replacement', type: 'note' })
				expect(patched.getSourcePath(deepest))
					.toEqual(path)
			}
		}
	})

	it('accepts SourcePatch paths up to MAX_JSON_DEPTH + 2 segments and rejects longer ones', () => {
		const document = createWidgetDocument({ system, source: { id: 'root', type: 'note', config: {} } })
		const longest = Array.from({ length: MAX_JSON_DEPTH + 2 })
			.fill('a') as string[]

		expect(document.applyPatch([{ op: 'remove', path: longest }]))
			.toMatchObject({ ok: false, failure: { code: 'path-not-found' } })
		expect(document.applyPatch([{ op: 'remove', path: [...longest, 'a'] }]))
			.toMatchObject({ ok: false, failure: { code: 'max-depth-exceeded' } })
	})

	it('carries the authored id and type as hints, like any unresolved node', () => {
		const blueprint = system.createBlueprint(widgetChain(fittingLevels + 1))
		const cutOff = deepestNode(blueprint)

		expect(cutOff)
			.toMatchObject({ resolved: false, id: `n${fittingLevels}`, type: 'note' })
		expect(inspectBlueprint(blueprint).nodes.find(node => node.node === cutOff))
			.toMatchObject({ resolved: false, id: `n${fittingLevels}`, type: 'note' })
		expect(blueprint.getWidget(`n${fittingLevels}`))
			.toBe(cutOff)
	})

	it('gives a cyclic repeat the hints of the object it repeats without indexing it as a duplicate', () => {
		const root: Record<string, unknown> = { id: 'root', type: 'note', slots: { children: [] } }
		;(root.slots as { children: unknown[] }).children.push(root)
		const blueprint = system.createBlueprint(root)
		const repeat = blueprint.getChildren(blueprint.root)[0]!

		expect(repeat)
			.toMatchObject({ resolved: false, id: 'root', type: 'note' })
		expect(blueprint.getWidget('root'))
			.toBe(blueprint.root)
		expect(codes(blueprint))
			.not
			.toContain('duplicate-widget-id')
	})
})

describe('sourcePatch with deep input', () => {
	function documentOver(source: unknown) {
		return createWidgetDocument({ system, source })
	}

	it.each(['add', 'replace'] as const)('fails %s with a json-incompatible-value failure for a deep operand', (op) => {
		const document = documentOver({ id: 'root', type: 'note', config: {} })

		const result = document.applyPatch([{ op, path: '/config', value: nestedArrays(50_000) as never }])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', operationIndex: 0, reason: 'max-depth-exceeded' } })
		if (!result.ok && 'path' in result.failure) {
			expect(result.failure.path)
				.toHaveLength(MAX_JSON_DEPTH)
		}
		expect(document.getSnapshot().revision)
			.toBe(0)
	})

	it('fails test with a json-incompatible-value failure for a deep operand', () => {
		const document = documentOver({ id: 'root', type: 'note', config: {} })

		expect(document.applyPatch([{ op: 'test', path: '/config', value: nestedArrays(50_000) as never }]))
			.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', reason: 'max-depth-exceeded' } })
	})

	it('accepts an operand exactly at the bound', () => {
		const document = documentOver({ id: 'root', type: 'note', config: {} })

		expect(document.applyPatch([{ op: 'replace', path: '/config', value: nestedArrays(MAX_JSON_DEPTH - 1) as never }]))
			.toEqual({ ok: true, changed: true })
	})

	it('fails a path with more segments than the bound instead of recursing', () => {
		const document = documentOver({ id: 'root', type: 'note', config: {} })
		const arrayPath = Array.from({ length: 100_000 })
			.fill('a')
		const pointer = `/${arrayPath.join('/')}`

		for (const path of [arrayPath, pointer] as never[]) {
			expect(document.applyPatch([{ op: 'add', path, value: 1 }]))
				.toMatchObject({ ok: false, failure: { code: 'max-depth-exceeded', operationIndex: 0 } })
			expect(document.applyPatch([{ op: 'remove', path }]))
				.toMatchObject({ ok: false, failure: { code: 'max-depth-exceeded', operationIndex: 0 } })
			expect(document.applyPatch([{ op: 'copy', from: path, path: '/a' }]))
				.toMatchObject({ ok: false, failure: { code: 'max-depth-exceeded', operationIndex: 0 } })
		}
	})

	it('creates a Document over a deep source and patches shallow parts without throwing', () => {
		const deepConfig = nestedArrays(50_000)
		const document = documentOver({ id: 'root', type: 'note', config: { deep: deepConfig, other: 1 } })

		expect(document.getSnapshot().blueprint.status)
			.toBe('invalid')
		expect(document.applyPatch([{ op: 'replace', path: '/config/other', value: 2 }]))
			.toEqual({ ok: true, changed: true })
		expect(document.applyPatch([{ op: 'replace', path: '/config/other', value: 2 }]))
			.toEqual({ ok: true, changed: false })
		expect(document.applyPatch([{ op: 'test', path: '/config/deep', value: 1 }]))
			.toMatchObject({ ok: false, failure: { code: 'test-failed' } })
		expect(document.applyPatch([{ op: 'remove', path: '/config/other' }]))
			.toEqual({ ok: true, changed: true })
	})

	it('fails copy and move of a value nested deeper than the bound with max-depth-exceeded', () => {
		const document = documentOver({ id: 'root', type: 'note', config: { deep: nestedArrays(50_000) } })

		expect(document.applyPatch([{ op: 'copy', from: '/config/deep', path: '/config/copy' }]))
			.toMatchObject({ ok: false, failure: { code: 'max-depth-exceeded', operationIndex: 0 } })
		expect(document.applyPatch([{ op: 'move', from: '/config/deep', path: '/config/moved' }]))
			.toMatchObject({ ok: false, failure: { code: 'max-depth-exceeded', operationIndex: 0 } })
		expect(document.getSnapshot().revision)
			.toBe(0)
	})
})
