/**
 * The keyed surfaces keep the JSDoc written on the plugin's Interfaces members, so IDE hover shows it.
 *
 * `expectTypeOf` cannot see documentation, so this reads it the way an editor does: it builds a real
 * TypeScript program over this very file (compiled with the package's test tsconfig), takes the type of the
 * `Probe` alias below and asks the checker for the documentation comment of each member symbol. The control
 * is a mapping over a key union, which is what the surfaces were before: it must show no documentation,
 * otherwise this test would not prove anything about the homomorphic mapping.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { UseWidgetResult } from './types'
import { createWidgetPlugin } from '@deviltea/widget-core'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

interface DocumentedInterfaces extends WidgetInterfaces {
	state: {
		/** How many times the button was pressed. */
		count: number
		/** The caption. */
		caption: string
	}
	properties: {
		/** The count, doubled. */
		doubled: number
	}
	methods: {
		/** Adds `step` to the count and returns the new count. */
		increment: (step: number) => number
	}
	events: {
		/** The button was pressed. */
		pressed: []
	}
	slots: {
		/** The content the button wraps. */
		content: 'Label'
	}
}

const DocumentedPlugin = createWidgetPlugin('Documented')
	.interfaces<DocumentedInterfaces>()
	.slots({ content: {} })
	.state(state => state
		.count({ validate: (input): input is number => typeof input === 'number', default: () => 0 })
		.caption({ validate: (input): input is string => typeof input === 'string', default: () => '' }))
	.properties(properties => properties.doubled({ compute: () => 0 }))
	.methods(methods => methods.increment({
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: ({ args: [step] }) => step,
	}))
	.events(['pressed'])
	.done()

/** Read by the TypeScript program below, by name. */
export type Probe = UseWidgetResult<typeof DocumentedPlugin>

/** The pre-0.3 shape: a mapping over a key union has no source property to take documentation from. */
export type KeyUnionControl = { readonly [Key in keyof DocumentedInterfaces['state'] & string]: number }

const testFile = new URL(import.meta.url).pathname.replace(/\.ts\?.*$/, '.ts')

function createProgram(): ts.Program {
	const configPath = ts.findConfigFile(testFile, ts.sys.fileExists, 'tsconfig.tests.json')
	if (configPath === undefined)
		throw new Error('tsconfig.tests.json not found')
	const config = ts.readConfigFile(configPath, ts.sys.readFile)
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, configPath.slice(0, configPath.lastIndexOf('/')))
	return ts.createProgram({
		rootNames: [testFile],
		options: { ...parsed.options, noEmit: true, composite: false, incremental: false, tsBuildInfoFile: undefined },
	})
}

describe('keyed surfaces carry the Interfaces\' JSDoc', () => {
	it('reads a plugin that really exists', () => {
		expect(DocumentedPlugin.type)
			.toBe('Documented')
	})

	const program = createProgram()
	const checker = program.getTypeChecker()
	const sourceFile = program.getSourceFile(testFile)!

	function aliasType(name: string): ts.Type {
		const declaration = sourceFile.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
		if (declaration === undefined)
			throw new Error(`type alias ${name} not found`)
		return checker.getTypeAtLocation(declaration.name)
	}

	function member(type: ts.Type, name: string): ts.Symbol {
		const symbol = checker.getPropertyOfType(checker.getApparentType(type), name)
		if (symbol === undefined)
			throw new Error(`no member ${name} on ${checker.typeToString(type)}`)
		return symbol
	}

	function documentation(symbol: ts.Symbol): string {
		return ts.displayPartsToString(symbol.getDocumentationComment(checker))
	}

	/** The type a surface accessor returns: `useState` -> the object `useState()` gives. */
	function surface(accessor: string): ts.Type {
		const signatures = checker.getSignaturesOfType(checker.getTypeOfSymbol(member(aliasType('Probe'), accessor)), ts.SignatureKind.Call)
		return checker.getReturnTypeOfSignature(signatures[0]!)
	}

	it('shows the member JSDoc on `useState()` and `useStateDiagnostics()`', () => {
		expect(documentation(member(surface('useState'), 'count')))
			.toBe('How many times the button was pressed.')
		expect(documentation(member(surface('useState'), 'caption')))
			.toBe('The caption.')
		expect(documentation(member(surface('useStateDiagnostics'), 'count')))
			.toBe('How many times the button was pressed.')
	})

	it('shows the Property JSDoc on `useProperties()` and `usePropertyDiagnostics()`', () => {
		expect(documentation(member(surface('useProperties'), 'doubled')))
			.toBe('The count, doubled.')
		expect(documentation(member(surface('usePropertyDiagnostics'), 'doubled')))
			.toBe('The count, doubled.')
	})

	it('shows the Method JSDoc on `useMethods()` and `useMethodDiagnostics()`', () => {
		expect(documentation(member(surface('useMethods'), 'increment')))
			.toBe('Adds `step` to the count and returns the new count.')
		expect(documentation(member(surface('useMethodDiagnostics'), 'increment')))
			.toBe('Adds `step` to the count and returns the new count.')
	})

	it('shows the Event JSDoc on `emit`', () => {
		const emit = checker.getTypeOfSymbol(member(aliasType('Probe'), 'emit'))
		expect(documentation(member(emit, 'pressed')))
			.toBe('The button was pressed.')
	})

	it('has no documentation on a mapping over a key union (the control)', () => {
		expect(documentation(member(aliasType('KeyUnionControl'), 'count')))
			.toBe('')
	})
})
