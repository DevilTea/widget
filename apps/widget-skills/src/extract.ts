/**
 * IR extraction: walks `typeof <system>` -> `WidgetSystem<[...plugins]>` -> each `WidgetPlugin<Type, Interfaces>`
 * with the TypeScript checker and reads the Interfaces members and their JSDoc.
 *
 * Both slot forms are read: the 0.2 string-literal union (`slots: 'a' | 'b'`, no per-slot doc in the types) and
 * the 0.3 record (`slots: { /** doc *\/ a: Expected }`).
 */

import type { ConstraintTag, Doc, EventIr, MemberIr, MethodIr, NamedType, PluginIr, ReasonIr, RuntimeFacts, Shape, ShapeProperty, SlotIr, StateIr, SystemIr } from './ir'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { CONSTRAINT_TAGS, emptyDoc, PROSE_TAGS } from './ir'

export interface ExtractOptions {
	/** The module that exports the System. */
	modulePath: string
	/** The name of the exported System. */
	exportName: string
	/** The tsconfig the module is compiled with. Defaults to the nearest `tsconfig.json` above the module. */
	tsconfigPath?: string
	/** A tsconfig whose `compilerOptions.paths` are added on top (for example to resolve workspace packages to source). */
	sourceTsconfigPath?: string
	/** The runtime facts to cross-check against. Without them the names are not checked and `authorWritable` is `null`. */
	runtime?: RuntimeFacts
	/** Paths in the IR are relative to this directory. Defaults to the working directory. */
	cwd?: string
}

const TYPE_FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
const MAX_DEPTH = 16

function readPaths(tsconfigPath: string): Record<string, string[]> {
	const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
	if (error !== undefined)
		throw new Error(`Cannot read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
	const paths = (config as { compilerOptions?: { paths?: Record<string, string[]> } }).compilerOptions?.paths ?? {}
	const base = dirname(tsconfigPath)
	return Object.fromEntries(Object.entries(paths)
		.map(([key, targets]) => [key, targets.map(target => resolve(base, target))]))
}

function createProgram(options: ExtractOptions): ts.Program {
	const modulePath = resolve(options.modulePath)
	const tsconfigPath = options.tsconfigPath !== undefined
		? resolve(options.tsconfigPath)
		: ts.findConfigFile(dirname(modulePath), ts.sys.fileExists)
	let compilerOptions: ts.CompilerOptions = { strict: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext }
	if (tsconfigPath !== undefined) {
		const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
		if (parsed === undefined)
			throw new Error(`Cannot parse ${tsconfigPath}.`)
		compilerOptions = parsed.options
	}
	if (options.sourceTsconfigPath !== undefined)
		compilerOptions = { ...compilerOptions, paths: { ...compilerOptions.paths, ...readPaths(resolve(options.sourceTsconfigPath)) } }
	return ts.createProgram({ rootNames: [modulePath], options: { ...compilerOptions, noEmit: true } })
}

export function extractIr(options: ExtractOptions): SystemIr {
	const cwd = options.cwd ?? process.cwd()
	const modulePath = resolve(options.modulePath)
	const program = createProgram(options)
	const checker = program.getTypeChecker()
	const sourceFile = program.getSourceFile(modulePath)
	if (sourceFile === undefined)
		throw new Error(`${modulePath} is not part of the program.`)
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
	const systemSymbol = moduleSymbol === undefined
		? undefined
		: checker.getExportsOfModule(moduleSymbol)
				.find(symbol => symbol.name === options.exportName)
	if (systemSymbol === undefined)
		throw new Error(`${modulePath} has no export "${options.exportName}".`)

	const types: Record<string, NamedType> = {}
	const namedByDeclaration = new Map<ts.Node, string>()

	const textOf = (type: ts.Type): string => checker.typeToString(type, undefined, TYPE_FORMAT)

	function docOf(symbol: ts.Symbol | undefined): Doc {
		const doc = emptyDoc()
		if (symbol === undefined)
			return doc
		doc.summary = ts.displayPartsToString(symbol.getDocumentationComment(checker))
			.trim()
		for (const tag of symbol.getJsDocTags(checker)) {
			const text = ts.displayPartsToString(tag.text)
				.trim()
			if (tag.name === 'remarks')
				doc.remarks = text
			else if ((CONSTRAINT_TAGS as readonly string[]).includes(tag.name))
				doc.tags[tag.name as ConstraintTag] = text
			else if (!(PROSE_TAGS as readonly string[]).includes(tag.name))
				doc.unknownTags.push(tag.name)
		}
		return doc
	}

	/** The user-declared interface or alias `type` is an instance of, when it has one and takes no type arguments. */
	function namedDeclarationOf(type: ts.Type): { symbol: ts.Symbol, declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration } | null {
		const symbol = type.aliasSymbol ?? type.getSymbol()
		if (symbol === undefined)
			return null
		if (type.aliasSymbol !== undefined ? (type.aliasTypeArguments?.length ?? 0) > 0 : ((type as ts.TypeReference).typeArguments?.length ?? 0) > 0)
			return null
		const declaration = symbol.declarations?.find((candidate): candidate is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => ts.isInterfaceDeclaration(candidate) || ts.isTypeAliasDeclaration(candidate))
		if (declaration === undefined)
			return null
		const file = declaration.getSourceFile()
		if (program.isSourceFileDefaultLibrary(file) || program.isSourceFileFromExternalLibrary(file) || file.fileName.includes('/node_modules/'))
			return null
		return { symbol, declaration }
	}

	function declarationText(declaration: ts.Node): string {
		const file = declaration.getSourceFile()
		const comments = ts.getLeadingCommentRanges(file.text, declaration.getFullStart()) ?? []
		const jsdoc = comments.map(range => file.text.slice(range.pos, range.end))
			.filter(text => text.startsWith('/**'))
			.at(-1)
		return `${jsdoc === undefined ? '' : `${jsdoc}\n`}${declaration.getText(file)}`
	}

	function structuralShape(type: ts.Type, depth: number): Shape {
		if (depth > MAX_DEPTH)
			return { kind: 'unknown' }
		const flags = type.flags
		if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
			return { kind: 'unknown' }
		if (flags & ts.TypeFlags.StringLiteral)
			return { kind: 'literal', value: (type as ts.StringLiteralType).value }
		if (flags & ts.TypeFlags.NumberLiteral)
			return { kind: 'literal', value: (type as ts.NumberLiteralType).value }
		if (flags & ts.TypeFlags.BooleanLiteral)
			return { kind: 'literal', value: textOf(type) === 'true' }
		if (flags & ts.TypeFlags.String)
			return { kind: 'string' }
		if (flags & ts.TypeFlags.Number)
			return { kind: 'number' }
		if (flags & ts.TypeFlags.Boolean)
			return { kind: 'boolean' }
		if (flags & ts.TypeFlags.Null)
			return { kind: 'null' }
		if (type.isUnion()) {
			const members = type.types.filter(member => !(member.flags & ts.TypeFlags.Undefined))
				.map(member => shapeOf(member, depth + 1))
			const hasTrue = members.some(member => member.kind === 'literal' && member.value === true)
			const hasFalse = members.some(member => member.kind === 'literal' && member.value === false)
			const merged = hasTrue && hasFalse
				? [...members.filter(member => !(member.kind === 'literal' && typeof member.value === 'boolean')), { kind: 'boolean' } as Shape]
				: members
			return merged.length === 1 ? merged[0]! : { kind: 'union', members: merged }
		}
		if (checker.isTupleType(type)) {
			const elements = checker.getTypeArguments(type as ts.TypeReference)
				.map(element => shapeOf(element, depth + 1))
			return { kind: 'array', items: elements.length === 1 ? elements[0]! : { kind: 'union', members: elements } }
		}
		if (checker.isArrayType(type))
			return { kind: 'array', items: shapeOf(checker.getTypeArguments(type as ts.TypeReference)[0]!, depth + 1) }
		if (flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
			if (type.getCallSignatures().length > 0)
				return { kind: 'unknown' }
			const properties = checker.getPropertiesOfType(type)
			const index = checker.getIndexInfoOfType(type, ts.IndexKind.String)
			if (properties.length === 0 && index !== undefined)
				return { kind: 'record', value: shapeOf(index.type, depth + 1) }
			return { kind: 'object', properties: properties.map(property => propertyOf(property, depth)) }
		}
		return { kind: 'unknown' }
	}

	function propertyOf(property: ts.Symbol, depth: number): ShapeProperty {
		return {
			name: property.name,
			optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
			shape: shapeOf(checker.getTypeOfSymbol(property), depth + 1),
			doc: docOf(property),
		}
	}

	/** The shape of `type`; a user-declared named type is registered in `types` and referenced by name. */
	function shapeOf(type: ts.Type, depth = 0): Shape {
		const named = namedDeclarationOf(type)
		if (named === null)
			return structuralShape(type, depth)
		const existing = namedByDeclaration.get(named.declaration)
		if (existing !== undefined)
			return { kind: 'ref', name: existing }
		let name = named.symbol.name
		for (let suffix = 2; name in types; suffix++)
			name = `${named.symbol.name}${suffix}`
		namedByDeclaration.set(named.declaration, name)
		// Registered before the walk so a recursive type refers to itself instead of looping.
		const entry: NamedType = {
			name,
			text: declarationText(named.declaration),
			file: relative(cwd, named.declaration.getSourceFile().fileName),
			shape: { kind: 'unknown' },
			doc: docOf(named.symbol),
		}
		types[name] = entry
		entry.shape = structuralShape(type, depth)
		return { kind: 'ref', name }
	}

	function refsOf(shape: Shape, into: Set<string>): void {
		if (shape.kind === 'ref') {
			if (into.has(shape.name))
				return
			into.add(shape.name)
			refsOf(types[shape.name]!.shape, into)
		}
		else if (shape.kind === 'array') {
			refsOf(shape.items, into)
		}
		else if (shape.kind === 'record') {
			refsOf(shape.value, into)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(member => refsOf(member, into))
		}
		else if (shape.kind === 'object') {
			shape.properties.forEach(property => refsOf(property.shape, into))
		}
	}

	function nonNullable(type: ts.Type): { type: ts.Type, hadNull: boolean } {
		const hadNull = type.isUnion() && type.types.some(member => (member.flags & ts.TypeFlags.Null) !== 0)
		return { type: checker.getNonNullableType(type), hadNull }
	}

	function membersOf(interfaces: ts.Type, section: string): { symbol: ts.Symbol, type: ts.Type }[] | null {
		const property = interfaces.getProperty(section)
		if (property === undefined || (property.flags & ts.SymbolFlags.Optional) !== 0)
			return null
		return checker.getPropertiesOfType(checker.getTypeOfSymbol(property))
			.map(symbol => ({ symbol, type: checker.getTypeOfSymbol(symbol) }))
	}

	function expectedTypesOf(type: ts.Type): string[] | null {
		const members = type.isUnion() ? type.types : [type]
		const names: string[] = []
		for (const member of members) {
			if (member.flags & ts.TypeFlags.StringLiteral) {
				names.push((member as ts.StringLiteralType).value)
				continue
			}
			// A plugin (or any object) type that carries a literal `type`.
			const typeProperty = member.getProperty('type')
			const literal = typeProperty === undefined ? undefined : checker.getTypeOfSymbol(typeProperty)
			if (literal !== undefined && (literal.flags & ts.TypeFlags.StringLiteral) !== 0)
				names.push((literal as ts.StringLiteralType).value)
			else
				return null
		}
		return names.length === 0 ? null : names
	}

	function extractPlugin(pluginType: ts.Type): PluginIr {
		const [typeArgument, interfaces] = pluginType.aliasTypeArguments ?? checker.getTypeArguments(pluginType as ts.TypeReference)
		if (typeArgument === undefined || interfaces === undefined || !(typeArgument.flags & ts.TypeFlags.StringLiteral))
			throw new Error(`Cannot read the plugin type and Interfaces of ${textOf(pluginType)}: expected WidgetPlugin<'Literal', Interfaces>.`)
		const type = (typeArgument as ts.StringLiteralType).value
		const refs = new Set<string>()
		const track = (memberType: ts.Type): Shape => {
			const shape = shapeOf(memberType)
			refsOf(shape, refs)
			return shape
		}
		const interfacesSymbol = interfaces.aliasSymbol ?? interfaces.getSymbol()
		const plugin: PluginIr = {
			type,
			interfacesName: interfacesSymbol === undefined || interfacesSymbol.name.startsWith('__') ? null : interfacesSymbol.name,
			doc: docOf(interfacesSymbol),
			runtimeDescription: null,
			config: null,
			slotForm: null,
			slotsOpen: false,
			slots: [],
			state: [],
			properties: [],
			methods: [],
			events: [],
			reasons: null,
			typeNames: [],
		}

		const configProperty = interfaces.getProperty('config')
		if (configProperty !== undefined && !(configProperty.flags & ts.SymbolFlags.Optional)) {
			const configType = checker.getTypeOfSymbol(configProperty)
			const raw = configType.getProperty('raw')
			const resolved = configType.getProperty('resolved')
			if (raw === undefined || resolved === undefined)
				throw new Error(`${type}: config must declare both raw and resolved.`)
			const rawType = checker.getTypeOfSymbol(raw)
			const resolvedType = checker.getTypeOfSymbol(resolved)
			const { type: rawValue, hadNull } = nonNullable(rawType)
			track(resolvedType)
			plugin.config = {
				rawText: textOf(rawType),
				resolvedText: textOf(resolvedType),
				rawShape: track(rawValue),
				omittable: hadNull,
				runtimeDescription: null,
			}
		}

		const slotsProperty = interfaces.getProperty('slots')
		if (slotsProperty !== undefined && !(slotsProperty.flags & ts.SymbolFlags.Optional)) {
			const slotsType = checker.getTypeOfSymbol(slotsProperty)
			const literals = (slotsType.isUnion() ? slotsType.types : [slotsType])
			if (literals.some(member => (member.flags & ts.TypeFlags.String) !== 0)) {
				// `slots: string` (or a union that widens to it): an open slot set. The names come from the runtime.
				plugin.slotForm = 'union'
				plugin.slotsOpen = true
			}
			else if (literals.every(member => (member.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.Never)) !== 0)) {
				plugin.slotForm = 'union'
				plugin.slots = literals
					.filter(member => (member.flags & ts.TypeFlags.StringLiteral) !== 0)
					.map((member): SlotIr => ({ name: (member as ts.StringLiteralType).value, doc: emptyDoc(), expected: null, runtimeDescription: null }))
			}
			else {
				plugin.slotForm = 'record'
				plugin.slots = checker.getPropertiesOfType(slotsType)
					.map((symbol): SlotIr => ({ name: symbol.name, doc: docOf(symbol), expected: expectedTypesOf(checker.getTypeOfSymbol(symbol)), runtimeDescription: null }))
			}
		}

		plugin.state = (membersOf(interfaces, 'state') ?? []).map(({ symbol, type: memberType }): StateIr => {
			return { name: symbol.name, typeText: textOf(memberType), shape: track(memberType), doc: docOf(symbol), authorWritable: null }
		})
		plugin.properties = (membersOf(interfaces, 'properties') ?? []).map(({ symbol, type: memberType }): MemberIr => {
			return { name: symbol.name, typeText: textOf(memberType), shape: track(memberType), doc: docOf(symbol) }
		})
		plugin.methods = (membersOf(interfaces, 'methods') ?? []).map(({ symbol, type: memberType }): MethodIr => {
			const signature = checker.getSignaturesOfType(memberType, ts.SignatureKind.Call)[0]
			if (signature === undefined)
				throw new Error(`${type}.methods.${symbol.name} is not callable.`)
			const paramDocs = new Map<string, string>()
			let returnsDoc = ''
			for (const tag of symbol.getJsDocTags(checker)) {
				const text = ts.displayPartsToString(tag.text)
					.trim()
				if (tag.name === 'param') {
					// `name - text` (TSDoc) or `name text` (JSDoc).
					const space = text.search(/\s/)
					const name = space === -1 ? text : text.slice(0, space)
					if (name !== '') {
						paramDocs.set(name, space === -1
							? ''
							: text.slice(space)
									.trim()
									.replace(/^-\s*/, ''))
					}
				}
				else if (tag.name === 'returns') {
					returnsDoc = text
				}
			}
			const params = signature.getParameters()
				.map((parameter) => {
					const parameterType = checker.getTypeOfSymbol(parameter)
					const declaration = parameter.valueDeclaration
					const optional = declaration !== undefined && ts.isParameter(declaration) && checker.isOptionalParameter(declaration)
					return { name: parameter.name, typeText: textOf(parameterType), optional, doc: paramDocs.get(parameter.name) ?? '', shape: track(parameterType) }
				})
			const returnType = signature.getReturnType()
			const returnShape = track(returnType)
			const returnText = textOf(returnType)
			return {
				name: symbol.name,
				signature: `${symbol.name}(${params.map(param => `${param.name}${param.optional ? '?' : ''}: ${param.typeText}`)
					.join(', ')}): ${returnText}`,
				params,
				returnText,
				returnShape,
				returnsDoc,
				doc: docOf(symbol),
			}
		})
		plugin.events = (membersOf(interfaces, 'events') ?? []).map(({ symbol, type: memberType }): EventIr => {
			const elements = checker.isTupleType(memberType) ? checker.getTypeArguments(memberType as ts.TypeReference) : []
			const labels = checker.isTupleType(memberType) ? (memberType as ts.TupleTypeReference).target.labeledElementDeclarations : undefined
			return {
				name: symbol.name,
				payload: elements.map((element, index) => {
					const label = labels?.[index]
					return { label: label === undefined ? null : label.name.getText(), typeText: textOf(element), shape: track(element) }
				}),
				doc: docOf(symbol),
				runtimeDescription: null,
			}
		})
		const reasons = membersOf(interfaces, 'reasons')
		if (reasons !== null) {
			plugin.reasons = reasons.map(({ symbol, type: memberType }): ReasonIr => {
				return { name: symbol.name, payloadText: textOf(memberType), shape: track(memberType), doc: docOf(symbol) }
			})
		}
		plugin.typeNames = [...refs].sort()
		return plugin
	}

	const systemType = checker.getTypeOfSymbol(systemSymbol)
	const pluginsProperty = systemType.getProperty('plugins')
	if (pluginsProperty === undefined)
		throw new Error(`Export "${options.exportName}" is not a WidgetSystem: it has no "plugins".`)
	const pluginsType = checker.getTypeOfSymbol(pluginsProperty)
	if (!checker.isTupleType(pluginsType)) {
		throw new Error(`The plugins of "${options.exportName}" are not a tuple (${textOf(pluginsType)
			.slice(0, 120)}), so its plugin types cannot be enumerated. Declare the plugin list \`as const\`.`)
	}
	const plugins = checker.getTypeArguments(pluginsType as ts.TypeReference)
		.map(extractPlugin)

	const ir: SystemIr = {
		irVersion: 1,
		system: options.exportName,
		module: relative(cwd, modulePath),
		plugins,
		types: Object.fromEntries(Object.entries(types)
			.sort(([a], [b]) => a.localeCompare(b))),
		mismatches: [],
	}
	if (options.runtime !== undefined)
		applyRuntimeFacts(ir, options.runtime)
	return ir
}

function compareNames(label: string, fromTypes: readonly string[] | null, fromRuntime: readonly string[] | null, mismatches: string[]): void {
	if (fromRuntime === null || fromTypes === null) {
		if ((fromTypes?.length ?? 0) > 0 || (fromRuntime?.length ?? 0) > 0)
			mismatches.push(`${label}: the types declare [${(fromTypes ?? []).join(', ')}] but the runtime declares [${(fromRuntime ?? []).join(', ')}].`)
		return
	}
	const missing = fromTypes.filter(name => !fromRuntime.includes(name))
	const extra = fromRuntime.filter(name => !fromTypes.includes(name))
	if (missing.length > 0)
		mismatches.push(`${label}: declared in the types but not at runtime: ${missing.join(', ')}.`)
	if (extra.length > 0)
		mismatches.push(`${label}: declared at runtime but not in the types: ${extra.join(', ')}.`)
}

/** Fills the runtime-only facts (descriptions, `authorWritable`) and records every name difference in `ir.mismatches`. */
export function applyRuntimeFacts(ir: SystemIr, runtime: RuntimeFacts): void {
	const mismatches = ir.mismatches
	compareNames('plugin types', ir.plugins.map(plugin => plugin.type), runtime.plugins.map(plugin => plugin.type), mismatches)
	for (const plugin of ir.plugins) {
		const facts = runtime.plugins.find(candidate => candidate.type === plugin.type)
		if (facts === undefined)
			continue
		plugin.runtimeDescription = facts.description
		if ((plugin.config !== null) !== facts.hasConfig)
			mismatches.push(`${plugin.type}.config: the types ${plugin.config === null ? 'do not declare' : 'declare'} a config but the runtime ${facts.hasConfig ? 'does' : 'does not'}.`)
		if (plugin.config !== null)
			plugin.config.runtimeDescription = facts.configDescription
		if ((plugin.methods.length > 0) !== facts.hasMethods && plugin.methods.length > 0)
			mismatches.push(`${plugin.type}.methods: declared in the types but the runtime has no Methods capability.`)
		if (plugin.slotsOpen) {
			// An open slot set (`slots: string`) has no names in the types: the runtime's declarations are the list.
			if (facts.slots === null)
				mismatches.push(`${plugin.type}.slots: declared in the types but the runtime has no Slots capability.`)
			plugin.slots = (facts.slots ?? []).map(slot => ({ name: slot.name, doc: emptyDoc(), expected: null, runtimeDescription: slot.description }))
		}
		else {
			compareNames(`${plugin.type}.slots`, plugin.slotForm === null ? null : plugin.slots.map(slot => slot.name), facts.slots?.map(slot => slot.name) ?? null, mismatches)
		}
		compareNames(`${plugin.type}.state`, plugin.state.map(member => member.name), facts.state?.map(member => member.name) ?? null, mismatches)
		compareNames(`${plugin.type}.properties`, plugin.properties.map(member => member.name), facts.properties, mismatches)
		compareNames(`${plugin.type}.events`, plugin.events.map(member => member.name), facts.events?.map(member => member.name) ?? null, mismatches)
		for (const slot of plugin.slots)
			slot.runtimeDescription = facts.slots?.find(candidate => candidate.name === slot.name)?.description ?? null
		for (const member of plugin.state)
			member.authorWritable = facts.state?.find(candidate => candidate.name === member.name)?.authorWritable ?? null
		for (const event of plugin.events)
			event.runtimeDescription = facts.events?.find(candidate => candidate.name === event.name)?.description ?? null
	}
}
