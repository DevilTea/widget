/**
 * Conformance coverage for `WidgetSystem.createBlueprintFromJson(text)`: observably equivalent to
 * `createBlueprint(JSON.parse(text))`, with the JSON-domain proof established by construction.
 */

import type { WidgetInterfaces } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'

interface NoteInterfaces extends WidgetInterfaces {
	config: {
		raw: { readonly text: string }
		resolved: { readonly text: string }
	}
	slots: 'children'
	state: { count: number }
}

const notePlugin = createWidgetPlugin('note')
	.description('Test widget')
	.interfaces<NoteInterfaces>()
	.config({
		description: 'Test config',
		validate: (input): input is { text: string } => typeof input === 'object' && input !== null && typeof (input as { text?: unknown }).text === 'string',
		resolve: raw => ({ text: raw?.text ?? '' }),
	})
	.slots({ children: { description: 'Test slot' } })
	.state(state => state.count({ validate: (input): input is number => typeof input === 'number', default: () => 0 }))
	.done()

const system = createWidgetSystem({ plugins: [notePlugin] })

function summarize(blueprint: ReturnType<typeof system.createBlueprint>) {
	return {
		status: blueprint.status,
		sourceJsonCompatible: blueprint.sourceJsonCompatible,
		source: blueprint.source,
		diagnostics: blueprint.diagnostics.map(diagnostic => ({ code: diagnostic.code, location: diagnostic.location.type })),
	}
}

const texts = {
	'valid': '{"id":"root","type":"note","config":{"text":"a"},"slots":{"children":[{"id":"b","type":"note","config":{"text":"b"}}]}}',
	'semantically invalid': '{"id":"root","type":"note","config":{"text":1},"slots":{"children":[{"id":"root","type":"missing"}]}}',
	'JSON edge values': '{"id":"root","type":"note","config":{"text":"x","__proto__":{"y":1},"n":-0,"deep":[[[{}]]]}}',
	'non-object root': '[1,2,3]',
}

describe('createBlueprintFromJson', () => {
	for (const [name, text] of Object.entries(texts)) {
		it(`matches createBlueprint(JSON.parse(text)) for ${name} input`, () => {
			const fromJson = system.createBlueprintFromJson(text)
			const fromValue = system.createBlueprint(JSON.parse(text))

			expect(summarize(fromJson))
				.toEqual(summarize(fromValue))
			expect(fromJson.sourceJsonCompatible)
				.toBe(true)
		})
	}

	it('creates a working Runtime from valid JSON text', () => {
		const blueprint = system.createBlueprintFromJson(texts.valid)
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')

		const widget = blueprint.createRuntime()
			.getWidget('b')
		expect(widget?.state.count.get())
			.toBe(0)
	})

	it('throws the SyntaxError from JSON.parse for invalid JSON text', () => {
		expect(() => system.createBlueprintFromJson('{"id": "root",'))
			.toThrow(SyntaxError)
	})
})
