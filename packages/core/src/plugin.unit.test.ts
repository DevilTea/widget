/**
 * Runtime conformance of the plugin builder: section builders register only real member declarations,
 * seal once their build callback returns, and capture member definitions by value, so a completed
 * plugin cannot change after `done()`.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'
import { inspectPlugin } from './inspection/index'

interface CountInterfaces {
	state: { count: number }
}

function capture(run: () => unknown): unknown {
	try {
		run()
	}
	catch (error) {
		return error
	}
	return undefined
}

/** A contract violation is an uncoded `TypeError` whose message names every listed identifier. */
function expectContractViolation(error: unknown, names: readonly string[]): void {
	expect(error)
		.toBeInstanceOf(TypeError)
	for (const name of names) {
		expect((error as TypeError).message)
			.toContain(name)
	}
}

function runtimeStateKeys(plugin: ReturnType<typeof countPlugin>): string[] {
	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'w', type: plugin.type })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	return Object.keys(blueprint.createRuntime()
		.getWidget('w')!.state)
}

function countPlugin(type: string, probe: (section: unknown) => void = () => {}) {
	return createWidgetPlugin(type)
		.description('Count widget')
		.interfaces<CountInterfaces>()
		.state((state) => {
			probe(state)
			return state.count({ validate: (input): input is number => typeof input === 'number', default: () => 0 })
		})
		.done()
}

describe('section builders register only real member declarations', () => {
	it('rejects a JSON.stringify probe of the section with a TypeError and registers nothing', () => {
		const error = capture(() => countPlugin('json-probe', section => JSON.stringify(section)))

		expectContractViolation(error, ['json-probe', 'state', 'toJSON'])
	})

	it('rejects string coercion of the section with a TypeError and registers nothing', () => {
		const error = capture(() => countPlugin('string-probe', section => `${String(section)}`))

		expectContractViolation(error, ['string-probe', 'state', 'toString'])
	})

	it('keeps a JSON.stringify probe that the build callback catches from registering a member', () => {
		const plugin = countPlugin('caught-probe', (section) => {
			expect(capture(() => JSON.stringify(section)))
				.toBeInstanceOf(TypeError)
		})

		expect([...inspectPlugin(plugin).state!.keys()])
			.toEqual(['count'])
		expect(runtimeStateKeys(plugin))
			.toEqual(['count'])
	})

	it('rejects a non-object member definition for every section', () => {
		const notObjects: readonly unknown[] = [undefined, null, 'definition', 1, () => ({})]

		for (const value of notObjects) {
			expectContractViolation(capture(() => createWidgetPlugin('state-arg')
				.description('d')
				.interfaces<{ state: { a: number } }>()
				.state(state => state.a(value as never))), ['state-arg', 'state', '"a"'])
			expectContractViolation(capture(() => createWidgetPlugin('properties-arg')
				.description('d')
				.interfaces<{ properties: { a: number } }>()
				.properties(properties => properties.a(value as never))), ['properties-arg', 'properties', '"a"'])
			expectContractViolation(capture(() => createWidgetPlugin('methods-arg')
				.description('d')
				.interfaces<{ methods: { a: () => void } }>()
				.methods(methods => methods.a(value as never))), ['methods-arg', 'methods', '"a"'])
			expectContractViolation(capture(() => createWidgetPlugin('events-arg')
				.description('d')
				.interfaces<{ events: { a: [] } }>()
				.events(events => events.a(value as never))), ['events-arg', 'events', '"a"'])
		}
	})

	it('keeps JavaScript-special member names legal when they are declared with a definition object', () => {
		interface SpecialInterfaces {
			state: { then: number, toJSON: number, toString: number, constructor: number }
		}
		const validate = (input: unknown): input is number => typeof input === 'number'

		const plugin = createWidgetPlugin('special-names')
			.description('d')
			.interfaces<SpecialInterfaces>()
			.state(state => state
				.then({ validate })
				.toJSON({ validate })
				.toString({ validate })
				.constructor({ validate }))
			.done()

		expect([...inspectPlugin(plugin).state!.keys()])
			.toEqual(['then', 'toJSON', 'toString', 'constructor'])
	})
})

describe('a section is sealed once its build callback returns', () => {
	it('throws for a retained section after done() and leaves the plugin unchanged', () => {
		let retained: any
		const plugin = countPlugin('retained', (section) => {
			retained = section
		})

		const error = capture(() => retained.injected({ validate: () => true, default: () => 'surprise' }))

		expectContractViolation(error, ['retained', 'state', 'injected'])
		expect([...inspectPlugin(plugin).state!.keys()])
			.toEqual(['count'])
		expect(runtimeStateKeys(plugin))
			.toEqual(['count'])
	})

	it('settles a thenable probe of the section by rejecting, without adding a `then` member after done()', async () => {
		let probe: Promise<unknown> | undefined
		const plugin = countPlugin('thenable-probe', (section) => {
			probe = Promise.resolve(section)
		})

		await expect(probe)
			.rejects
			.toBeInstanceOf(TypeError)
		expect([...inspectPlugin(plugin).state!.keys()])
			.toEqual(['count'])
		expect(runtimeStateKeys(plugin))
			.toEqual(['count'])
	})

	it('seals the section even when the build callback throws', () => {
		let retained: any
		const builder = createWidgetPlugin('throwing-build')
			.description('d')
			.interfaces<CountInterfaces>()

		expect(capture(() => builder.state((state) => {
			retained = state
			throw new Error('build failed')
		})))
			.toEqual(new Error('build failed'))
		expectContractViolation(capture(() => retained.count({ validate: () => true })), ['throwing-build', 'state', 'count'])
	})
})

describe('member definitions are captured by value at registration', () => {
	it('ignores later mutation of the author\'s member and slot definition objects', () => {
		interface Interfaces {
			slots: 'body'
			state: { count: number }
		}
		const countDefinition = { validate: (input: unknown): input is number => typeof input === 'number', default: () => 1 }
		const bodyDefinition = { description: 'Body slot' }

		const plugin = createWidgetPlugin('captured')
			.description('d')
			.interfaces<Interfaces>()
			.slots({ body: bodyDefinition })
			.state(state => state.count(countDefinition))
			.done()

		countDefinition.default = () => 999
		bodyDefinition.description = 'Mutated'
		Object.assign(countDefinition, { authorWritable: true })

		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'w', type: 'captured', slots: { body: [] } })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		expect(blueprint.createRuntime()
			.getWidget('w')!.state.count.get())
			.toBe(1)
		expect(plugin.descriptions.slots?.get('body'))
			.toBe('Body slot')
		expect(inspectPlugin(plugin).state?.get('count')?.authorWritable)
			.toBe(false)
	})
})
