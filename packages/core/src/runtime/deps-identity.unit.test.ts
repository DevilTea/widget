/**
 * A member's `ctx.deps` is one stable object for the life of the Runtime: every evaluation of a Property and
 * every invocation of a Method receives the same object, and a Runtime created from the same Blueprint has
 * its own. Members whose dependencies are never used still work when first used much later.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface DepsInterfaces extends WidgetInterfaces {
	state: { count: number }
	properties: { doubled: number, constant: number }
	methods: { bump: () => number, idle: () => number }
}

const seen: Record<string, unknown[]> = { doubled: [], bump: [], constant: [] }

const plugin = createWidgetPlugin('deps')
	.description('Test widget')
	.interfaces<DepsInterfaces>()
	.state(state => state.count({ validate: (input): input is number => typeof input === 'number', default: () => 0 }))
	.properties(properties => properties
		.doubled({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				seen.doubled!.push(deps)
				const count = deps.count()
				return count.ok ? (count.value ?? 0) * 2 : 0
			},
		})
		.constant({
			registerDeps: ({ dep }) => [dep.self.properties.get('doubled')],
			compute: ({ deps }) => {
				seen.constant!.push(deps)
				return 1
			},
		}))
	.methods(methods => methods
		.bump({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count'), setCount: dep.self.state.set('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				seen.bump!.push(deps)
				const count = deps.count()
				deps.setCount((count.ok ? (count.value ?? 0) : 0) + 1)
				return 1
			},
		})
		.idle({ validateArgs: (args): args is [] => args.length === 0, execute: () => 7 }))
	.done()

const system = createWidgetSystem({ plugins: [plugin] })
const compiled = system.createBlueprint({ id: 'root', type: 'deps' })
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')
const blueprint = compiled

describe('ctx.deps identity', () => {
	it('is the same object on every evaluation and invocation of a member, and per Runtime', () => {
		for (const key of Object.keys(seen))
			seen[key] = []
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		expect(seen.doubled)
			.toEqual([])

		widget.properties.doubled.get()
		widget.state.count.set(5)
		widget.properties.doubled.get()
		widget.methods.bump()
		widget.properties.doubled.get()
		widget.methods.bump()
		widget.properties.constant.get()

		expect(seen.doubled!.length)
			.toBeGreaterThanOrEqual(3)
		expect(new Set(seen.doubled).size)
			.toBe(1)
		expect(seen.bump)
			.toHaveLength(2)
		expect(seen.bump![1])
			.toBe(seen.bump![0])
		expect(seen.constant)
			.toHaveLength(1)
		expect(Array.isArray(seen.constant![0]))
			.toBe(true)
		expect(seen.constant![0])
			.not
			.toBe(seen.doubled![0])

		const other = blueprint.createRuntime()
		other.getWidget('root')!.methods.bump()
		expect(seen.bump![2])
			.not
			.toBe(seen.bump![0])
		expect(widget.state.count.get())
			.toBe(7)
	})

	it('serves a member first used long after creation, and a member without dependencies', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		for (let index = 0; index < 5; index++)
			widget.methods.bump()

		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 10 })
		expect(widget.methods.idle())
			.toEqual({ ok: true, value: 7 })
	})
})
