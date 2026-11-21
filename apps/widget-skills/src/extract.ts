/**
 * IR extraction: walks `typeof <system>` -> `WidgetSystem<[...plugins]>` -> each `WidgetPlugin<Type, Interfaces>`
 * with the TypeScript checker and reads the Interfaces members and their JSDoc (Core 0.3: the JSDoc is the only
 * documentation; Core carries no prose at run time).
 *
 * Slots are the 0.3 record `{ /** doc *\/ name: Expected }`, where `Expected` is a union of plugin types, a
 * `WidgetContract<Shape, Types>` or `WidgetChild`.
 */

import type { Capability, ConstraintTag, Doc, EventIr, MemberIr, MethodIr, NamedType, PluginIr, ReasonIr, RuntimeFacts, Shape, ShapeProperty, SlotIr, StateIr, SystemIr } from './ir'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { CAPABILITIES, CONSTRAINT_TAGS, emptyDoc, PROSE_TAGS } from './ir'

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
	/** Creates the TypeScript program (a seam for tests that count programs). Defaults to `ts.createProgram`. */
	createProgram?: (options: ts.CreateProgramOptions) => ts.Program
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

/** The tsconfig files a program's options come from: `tsconfigPath` (or the one found), the files it extends, and `sourceTsconfigPath`. */
export interface ProgramConfig {
	compilerOptions: ts.CompilerOptions
	configFiles: string[]
}

export function readProgramConfig(options: Pick<ExtractOptions, 'modulePath' | 'tsconfigPath' | 'sourceTsconfigPath'>): ProgramConfig {
	const modulePath = resolve(options.modulePath)
	const tsconfigPath = options.tsconfigPath !== undefined
		? resolve(options.tsconfigPath)
		: ts.findConfigFile(dirname(modulePath), ts.sys.fileExists)
	let compilerOptions: ts.CompilerOptions = { strict: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext }
	const configFiles: string[] = []
	if (tsconfigPath !== undefined) {
		const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
		if (parsed === undefined)
			throw new Error(`Cannot parse ${tsconfigPath}.`)
		compilerOptions = parsed.options
		configFiles.push(tsconfigPath, ...((compilerOptions.configFile as ts.TsConfigSourceFile | undefined)?.extendedSourceFiles ?? []))
	}
	if (options.sourceTsconfigPath !== undefined) {
		const sourceTsconfigPath = resolve(options.sourceTsconfigPath)
		configFiles.push(sourceTsconfigPath)
		compilerOptions = { ...compilerOptions, paths: { ...compilerOptions.paths, ...readPaths(sourceTsconfigPath) } }
	}
	return { compilerOptions, configFiles: [...new Set(configFiles.map(file => resolve(file)))] }
}

/** Builds the TypeScript program over the System's module. This is the expensive step a cache hit skips. */
export function createExtractionProgram(options: ExtractOptions, config: ProgramConfig = readProgramConfig(options)): ts.Program {
	const create = options.createProgram ?? ts.createProgram
	return create({ rootNames: [resolve(options.modulePath)], options: { ...config.compilerOptions, noEmit: true } })
}

export function extractIr(options: ExtractOptions): SystemIr {
	return extractIrFromProgram(createExtractionProgram(options), options)
}

/** Reads the IR from a program built by `createExtractionProgram`. */
export function extractIrFromProgram(program: ts.Program, options: ExtractOptions): SystemIr {
	const cwd = options.cwd ?? process.cwd()
	const modulePath = resolve(options.modulePath)
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

	/** The string literal values of `type` (a literal or a union of literals), or `null` when it is anything else. */
	function literalNames(type: ts.Type): string[] | null {
		const members = type.isUnion() ? type.types : [type]
		if (!members.every(member => (member.flags & ts.TypeFlags.StringLiteral) !== 0))
			return null
		return members.map(member => (member as ts.StringLiteralType).value)
	}

	/** `[Shape, Types]` when `type` is a `WidgetContract<Shape, Types>` (`WidgetChild` included), otherwise `null`. */
	function contractArguments(type: ts.Type): readonly [ts.Type, ts.Type] | null {
		const symbol = type.getSymbol()
		if (symbol?.name !== 'WidgetContract' || !(type.flags & ts.TypeFlags.Object) || !((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference))
			return null
		const [shape, types] = checker.getTypeArguments(type as ts.TypeReference)
		return shape === undefined || types === undefined ? null : [shape, types]
	}

	function slotOf(pluginType: string, symbol: ts.Symbol): SlotIr {
		const type = checker.getTypeOfSymbol(symbol)
		const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
		const expectationText = declaration !== undefined && ts.isPropertySignature(declaration) && declaration.type !== undefined
			? declaration.type.getText()
			: textOf(type)
		const slot: SlotIr = { name: symbol.name, doc: docOf(symbol), expected: null, contract: null, expectationText }
		const names = literalNames(type)
		if (names !== null) {
			slot.expected = names
			return slot
		}
		const contract = contractArguments(type)
		if (contract === null)
			throw new Error(`${pluginType}.slots.${symbol.name}: expected a union of plugin types, a WidgetContract or WidgetChild, got ${textOf(type)}.`)
		const [shape, types] = contract
		if (!(types.flags & ts.TypeFlags.Never)) {
			const expected = literalNames(types)
			if (expected === null)
				throw new Error(`${pluginType}.slots.${symbol.name}: the Types of the WidgetContract must be plugin type literals, got ${textOf(types)}.`)
			slot.expected = expected
		}
		if (checker.getPropertiesOfType(shape).length > 0)
			slot.contract = textOf(shape)
		return slot
	}

	function hasCapability(interfaces: ts.Type, capability: Capability): boolean {
		const property = interfaces.getProperty(capability)
		return property !== undefined && (property.flags & ts.SymbolFlags.Optional) === 0
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
			capabilities: Object.fromEntries(CAPABILITIES.map(capability => [capability, hasCapability(interfaces, capability)])) as Record<Capability, boolean>,
			config: null,
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
				doc: docOf(configProperty),
				rawText: textOf(rawType),
				resolvedText: textOf(resolvedType),
				rawShape: track(rawValue),
				omittable: hadNull,
			}
		}

		const slotsProperty = interfaces.getProperty('slots')
		if (slotsProperty !== undefined && !(slotsProperty.flags & ts.SymbolFlags.Optional)) {
			const slotsType = checker.getTypeOfSymbol(slotsProperty)
			// `slots: never` is the explicit-empty spelling: no properties. A string type is the 0.2 union form.
			if (!(slotsType.flags & ts.TypeFlags.Never) && (slotsType.flags & ts.TypeFlags.StringLike || (slotsType.isUnion() && slotsType.types.some(member => member.flags & ts.TypeFlags.StringLike))))
				throw new Error(`${type}.slots is a union of names (${textOf(slotsType)}); Core 0.3 declares slots as a record { name: Expected }.`)
			plugin.slots = (slotsType.flags & ts.TypeFlags.Never)
				? []
				: checker.getPropertiesOfType(slotsType)
						.map(symbol => slotOf(type, symbol))
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
			}
		})
		const reasons = membersOf(interfaces, 'reasons')
		if (reasons !== null) {
			plugin.reasons = reasons.map(({ symbol, type: memberType }): ReasonIr => {
				const payload = (memberType.flags & ts.TypeFlags.Void) !== 0 ? null : { typeText: textOf(memberType), shape: track(memberType) }
				return { name: symbol.name, payload, doc: docOf(symbol) }
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
		irVersion: 2,
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

function compareNames(label: string, fromTypes: readonly string[], fromRuntime: readonly string[], mismatches: string[]): void {
	const missing = fromTypes.filter(name => !fromRuntime.includes(name))
	const extra = fromRuntime.filter(name => !fromTypes.includes(name))
	if (missing.length > 0)
		mismatches.push(`${label}: declared in the types but not at runtime: ${missing.join(', ')}.`)
	if (extra.length > 0)
		mismatches.push(`${label}: declared at runtime but not in the types: ${extra.join(', ')}.`)
}

/**
 * Fills the runtime-only fact (`authorWritable`) and records every difference between the types and the runtime in
 * `ir.mismatches`: capability presence (all six), and the names of slots, State, Properties and Events. Method
 * names are not compared: neither the catalog nor `inspectPlugin` has a Method inventory.
 */
export function applyRuntimeFacts(ir: SystemIr, runtime: RuntimeFacts): void {
	const mismatches = ir.mismatches
	compareNames('plugin types', ir.plugins.map(plugin => plugin.type), runtime.plugins.map(plugin => plugin.type), mismatches)
	for (const plugin of ir.plugins) {
		const facts = runtime.plugins.find(candidate => candidate.type === plugin.type)
		if (facts === undefined)
			continue
		for (const capability of CAPABILITIES) {
			if (plugin.capabilities[capability] !== facts.capabilities[capability])
				mismatches.push(`${plugin.type}.${capability}: the types ${plugin.capabilities[capability] ? 'declare' : 'do not declare'} the capability but the runtime ${facts.capabilities[capability] ? 'does' : 'does not'}.`)
		}
		if (plugin.capabilities.slots && facts.slots !== null)
			compareNames(`${plugin.type}.slots`, plugin.slots.map(slot => slot.name), facts.slots, mismatches)
		if (plugin.capabilities.state && facts.state !== null)
			compareNames(`${plugin.type}.state`, plugin.state.map(member => member.name), facts.state.map(member => member.name), mismatches)
		if (plugin.capabilities.properties && facts.properties !== null)
			compareNames(`${plugin.type}.properties`, plugin.properties.map(member => member.name), facts.properties, mismatches)
		if (plugin.capabilities.events && facts.events !== null)
			compareNames(`${plugin.type}.events`, plugin.events.map(member => member.name), facts.events, mismatches)
		for (const member of plugin.state)
			member.authorWritable = facts.state?.find(candidate => candidate.name === member.name)?.authorWritable ?? null
	}
}
