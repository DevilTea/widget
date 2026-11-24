import type { RuntimeFacts, SystemIr } from './ir'
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

/**
 * A types-only System with a type that has named properties plus an index signature. Its JSDoc is not read: the prose
 * comes from the `plugin.docs` in `facts` below, as the runtime import would read it.
 */
const source = `import type { WidgetPlugin, WidgetSystem } from '@deviltea/widget-core'

/** A tag cloud (a comment no tool reads). */
interface TagsInterfaces {
	config: { raw: TagsRaw, resolved: TagsRaw }
	state: {
		legacy: number
	}
}

export interface TagsRaw {
	title?: string
	label?: string
	[tag: string]: string | undefined
}

export declare const system: WidgetSystem<readonly [WidgetPlugin<'Tags', TagsInterfaces>]>
`

const facts: RuntimeFacts = {
	plugins: [{
		type: 'Tags',
		capabilities: { config: true, slots: false, state: true, properties: false, methods: false, events: false },
		slots: null,
		state: [{ name: 'legacy', authorWritable: false }],
		properties: null,
		events: null,
		docs: {
			description: 'A tag cloud.\n\nEvery tag is a key of the config.',
			config: {
				description: 'The tag cloud\'s config.',
				raw: { description: 'The authored config: a title, and a text per tag name.', values: { description: 'The text of a tag.' } },
				resolved: { values: { description: 'The text of a tag.' } },
			},
			slots: null,
			state: { legacy: { description: 'The old counter.' } },
			properties: null,
			methods: null,
			events: null,
			reasons: null,
			types: {},
		},
	}],
}

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
	ir = extractIr({ modulePath: join(scratch, 'system.ts'), exportName: 'system', tsconfigPath: join(scratch, 'tsconfig.json'), cwd: scratch, runtime: facts })
}, 120_000)
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('the docs object', () => {
	it('takes the prose from plugin.docs, the first paragraph as the summary and the rest as the remarks', () => {
		const tags = emitDocs(ir).plugins.Tags!
		expect(tags)
			.toMatchObject({ summary: 'A tag cloud.', remarks: 'Every tag is a key of the config.' })
		expect(tags.state!.legacy)
			.toMatchObject({ summary: 'The old counter.', remarks: '' })
		expect(tags.config)
			.toMatchObject({ summary: 'The tag cloud\'s config.' })
	})

	it('keeps the keys of the retired JSDoc tags, empty', () => {
		const tags = emitDocs(ir).plugins.Tags!
		expect([tags.tags, tags.example, tags.see, tags.deprecated, tags.defaultValue])
			.toEqual([{}, [], [], null, null])
	})

	it('has no prose without the runtime, and --check says why', () => {
		const typesOnly = extractIr({ modulePath: join(scratch, 'system.ts'), exportName: 'system', tsconfigPath: join(scratch, 'tsconfig.json'), cwd: scratch })
		expect(emitDocs(typesOnly).plugins.Tags)
			.toMatchObject({ summary: '', state: { legacy: { summary: '' } } })
		expect(checkIr(typesOnly).problems.map(problem => problem.kind))
			.toEqual(['no-docs'])
	})

	it('types the other keys of an object with an index signature instead of closing it', () => {
		const docsSchema = emitDocs(ir).plugins.Tags!.config!.schema as { $defs: Record<string, Record<string, unknown>> }
		expect(docsSchema.$defs.type_TagsRaw)
			.toMatchObject({ required: [], additionalProperties: { type: 'string', description: 'The text of a tag.' } })
		const full = emitFullSchema(ir) as { $defs: Record<string, Record<string, unknown>> }
		expect(full.$defs.type_TagsRaw!.additionalProperties)
			.toEqual({ type: 'string', description: 'The text of a tag.' })
		// The LLM profile keeps every object closed and says so.
		const llm = emitLlmSchema(ir) as { $defs: Record<string, Record<string, unknown>> }
		expect(llm.$defs.type_TagsRaw)
			.toMatchObject({ additionalProperties: false, description: expect.stringContaining('keys not listed here') })
		// The other keys round-trip through the flat form; the docs document the index signature's values (as Core types them).
		const tree = { id: 'tags', type: 'Tags', config: { title: 'Tags', news: 'News' } }
		const converter = createFlatConverter(ir)
		expect(converter.flatToTree(converter.treeToFlat(tree)))
			.toEqual(tree)
		expect(checkIr(ir))
			.toMatchObject({ ok: true, problems: [] })
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
		// An index signature beside fixed keys is a dictionary (as in Core): the fixed keys take its `values` docs.
		expect(docs.types.TagsRaw!.fields!.title!.summary)
			.toBe('The text of a tag.')
	})
})
