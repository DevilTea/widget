import type { SystemIr } from './ir'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkIr } from './check'
import { emitDocs } from './docs'
import { extractIr } from './extract'
import { createFlatConverter } from './flat'
import { emitFullSchema, emitLlmSchema } from './schema'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')
const scratch = mkdtempSync(join(tmpdir(), 'widget-docs-object-'))

/** A types-only System that uses the prose tags and a type with named properties plus an index signature. */
const source = `import type { WidgetPlugin, WidgetSystem } from '@deviltea/widget-core'

/**
 * A tag cloud.
 *
 * @example
 * { "id": "tags", "type": "Tags", "config": { "title": "Tags" } }
 * @see TagsRaw
 */
interface TagsInterfaces {
	/** The tag cloud's config. */
	config: { raw: TagsRaw, resolved: TagsRaw }
	state: {
		/**
		 * The old counter.
		 *
		 * @deprecated Use the Property instead.
		 */
		legacy: number
	}
}

/** The authored config: a title, and a text per tag name. */
export interface TagsRaw {
	/**
	 * The title.
	 *
	 * @defaultValue "Tags"
	 */
	title?: string
	/**
	 * The label.
	 *
	 * @defaultValue the plugin's name
	 */
	label?: string
	/** Every other key is a tag name. */
	[tag: string]: string | undefined
}

export declare const system: WidgetSystem<readonly [WidgetPlugin<'Tags', TagsInterfaces>]>
`

let ir: SystemIr

beforeAll(() => {
	writeFileSync(join(scratch, 'tsconfig.json'), JSON.stringify({
		compilerOptions: {
			strict: true,
			module: 'esnext',
			moduleResolution: 'bundler',
			target: 'esnext',
			skipLibCheck: true,
			types: [],
			paths: { '@deviltea/widget-core': [resolve(repositoryRoot, 'packages/core/dist/index.d.mts')] },
		},
	}))
	writeFileSync(join(scratch, 'system.ts'), source)
	ir = extractIr({ modulePath: join(scratch, 'system.ts'), exportName: 'system', tsconfigPath: join(scratch, 'tsconfig.json'), cwd: scratch })
}, 120_000)
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('the docs object', () => {
	it('carries @example, @see, @deprecated and @defaultValue', () => {
		const docs = emitDocs(ir)
		const tags = docs.plugins.Tags!
		expect(tags.example)
			.toEqual(['{ "id": "tags", "type": "Tags", "config": { "title": "Tags" } }'])
		expect(tags.see)
			.toEqual(['TagsRaw'])
		expect([tags.deprecated, tags.defaultValue])
			.toEqual([null, null])
		expect(tags.state!.legacy)
			.toMatchObject({ summary: 'The old counter.', deprecated: 'Use the Property instead.', example: [], see: [] })
		expect(docs.types.TagsRaw!.fields!.title)
			.toMatchObject({ summary: 'The title.', defaultValue: '"Tags"', optional: true })
	})

	it('turns a @defaultValue that is valid JSON into the schema default, and leaves prose alone', () => {
		const schema = emitDocs(ir).plugins.Tags!.config!.schema as { $defs: Record<string, { properties: Record<string, Record<string, unknown>> }> }
		const raw = schema.$defs.type_TagsRaw!
		expect(raw.properties.title)
			.toMatchObject({ type: 'string', default: 'Tags' })
		expect(raw.properties.label).not.toHaveProperty('default')
	})

	it('types the other keys of an object with an index signature instead of closing it', () => {
		const docsSchema = emitDocs(ir).plugins.Tags!.config!.schema as { $defs: Record<string, Record<string, unknown>> }
		expect(docsSchema.$defs.type_TagsRaw)
			.toMatchObject({ required: [], additionalProperties: { type: 'string' } })
		const full = emitFullSchema(ir) as { $defs: Record<string, Record<string, unknown>> }
		expect(full.$defs.type_TagsRaw!.additionalProperties)
			.toEqual({ type: 'string' })
		// The LLM profile keeps every object closed and says so.
		const llm = emitLlmSchema(ir) as { $defs: Record<string, Record<string, unknown>> }
		expect(llm.$defs.type_TagsRaw)
			.toMatchObject({ additionalProperties: false, description: expect.stringContaining('keys not listed here') })
		// The other keys round-trip through the flat form, and the check visits the index signature\'s values.
		const tree = { id: 'tags', type: 'Tags', config: { title: 'Tags', news: 'News' } }
		const converter = createFlatConverter(ir)
		expect(converter.flatToTree(converter.treeToFlat(tree)))
			.toEqual(tree)
		expect(checkIr(ir).ok)
			.toBe(true)
	})

	it('lists the named types with their docs, and which plugin mentions them', () => {
		const docs = emitDocs(ir)
		expect(Object.keys(docs.types))
			.toEqual(['TagsRaw'])
		expect(docs.plugins.Tags!.typeNames)
			.toEqual(['TagsRaw'])
		expect(docs.types.TagsRaw)
			.toMatchObject({
				summary: 'The authored config: a title, and a text per tag name.',
				declaration: expect.stringContaining('export interface TagsRaw {'),
				fields: { title: { optional: true }, label: { optional: true } },
			})
	})
})
