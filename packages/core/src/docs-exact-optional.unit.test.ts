/**
 * The docs types under `exactOptionalPropertyTypes` (Discussion #12, "Descriptions live in the plugin builder; JSON
 * Schema is inferred from the types (0.4.0)", point 8). The repository compiles without the flag, so this test
 * builds one program with it, over a source that imports the public entry, and checks which lines fail.
 */

import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url))
const virtualFile = `${sourceDirectory}__exact-optional-docs__.ts`

const source = `
import type { FieldDocs } from './index'
import { createWidgetPlugin, defineFieldDocs, undocumented } from './index'

interface Raw {
	readonly title?: string
	readonly nested?: { readonly a?: number }
	readonly list?: readonly { readonly id: string }[]
}

// Optional keys are still required in the docs.
export const complete = defineFieldDocs<Raw>()({
	fields: {
		title: { description: 'The title.' },
		nested: { description: 'Nested.', fields: { a: { description: 'A.' } } },
		list: { description: 'A list.', items: { fields: { id: { description: 'Its id.' } } } },
	},
})
export const omittedDescription: FieldDocs<Raw> = { fields: complete.fields }

// LINE:missing
export const missing: FieldDocs<Raw> = { fields: { title: { description: 'T.' }, nested: { description: 'N.', fields: { a: { description: 'A.' } } } } }
// LINE:explicit-undefined
export const explicitUndefined: FieldDocs<Raw> = { description: undefined, fields: complete.fields }

export const plugin = createWidgetPlugin('exact')
	.description('Exact.')
	.interfaces<{ config: { raw: Raw | null, resolved: { title: string } }, methods: { run: (count?: number) => void } }>()
	.config({ description: 'C.', raw: complete, resolved: { fields: { title: { description: 'T.' } } }, validate: (input): input is Raw | null => input === null, resolve: raw => ({ title: raw?.title ?? '' }) })
	.methods(methods => methods.run({ description: 'Runs.', params: [{ description: 'How many.' }], validateArgs: (args): args is [number?] => args.length <= 1, execute: () => {} }))
	.done()

export const waived = createWidgetPlugin('waived').description(undocumented).interfaces<{ state: { s: Raw } }>()
	.state(state => state.s({ description: undocumented, validate: (input): input is Raw => input !== null }))
	.done()
`

function diagnosticsByLine(): ReadonlyMap<string, readonly string[]> {
	const options: ts.CompilerOptions = {
		strict: true,
		exactOptionalPropertyTypes: true,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ['lib.es2022.d.ts'],
		types: [],
	}
	const host = ts.createCompilerHost(options)
	const getSourceFile = host.getSourceFile.bind(host)
	host.getSourceFile = (fileName, languageVersion, ...rest) => fileName === virtualFile
		? ts.createSourceFile(fileName, source, languageVersion)
		: getSourceFile(fileName, languageVersion, ...rest)
	const fileExists = host.fileExists.bind(host)
	host.fileExists = fileName => fileName === virtualFile || fileExists(fileName)
	const program = ts.createProgram([virtualFile], options, host)
	const lines = source.split('\n')
	const byMarker = new Map<string, string[]>()
	const checked = program.getSourceFile(virtualFile)!
	// Only the virtual consumer file is checked: Core's own implementation is not compiled with this flag.
	for (const diagnostic of [...program.getSyntacticDiagnostics(checked), ...program.getSemanticDiagnostics(checked)]) {
		const file = diagnostic.file
		const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
		if (file === undefined) {
			byMarker.set('outside', [...byMarker.get('outside') ?? [], message])
			continue
		}
		const line = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line
		const marker = /\/\/ LINE:(\S+)/.exec(lines[line - 1] ?? '')?.[1] ?? `line ${line + 1}`
		byMarker.set(marker, [...byMarker.get(marker) ?? [], message])
	}
	return byMarker
}

describe('docs types with exactOptionalPropertyTypes', () => {
	it('require every optional key, reject an explicit undefined, and accept everything else', { timeout: 60_000 }, () => {
		const byMarker = diagnosticsByLine()

		expect([...byMarker.keys()].sort())
			.toEqual(['explicit-undefined', 'missing'])
		expect(byMarker.get('missing')!.join('\n'))
			.toContain('list')
	})
})
