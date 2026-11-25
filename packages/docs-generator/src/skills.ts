/**
 * The two System skills (Agent Skills layout: `<out>/skills/<name>/SKILL.md` with `name`/`description` frontmatter,
 * plus `references/`), generated from the IR: `<system>-source-json-authoring` and `<system>-renderer-implementation`.
 * The skills that describe an API and no System ship with their package: `widget-plugin-authoring` with
 * `@deviltea/widget-core`, `widget-vue-renderer` with `@deviltea/widget-vue`; the renderer skill refers to the latter.
 */

import type { Doc, PluginIr, ReasonIr, Shape, SystemIr } from './ir'
import { describeExpectation, describeWidgetRef, namedTypesOf, widgetRefOf } from './schema'

function kebab(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[^a-z0-9]+/gi, '-')
		.toLowerCase()
}

function frontmatter(name: string, description: string): string {
	return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n`
}

function prose(doc: Doc): string {
	const text = [doc.summary, doc.remarks].filter(part => part !== '')
		.join('\n\n')
	return text !== '' ? text : '_Not documented._'
}

function inline(doc: Doc): string {
	return prose(doc)
		.replaceAll(/\s*\n\s*/g, ' ')
}

function oneLine(text: string): string {
	return text.replaceAll(/\s*\n\s*/g, ' ')
}

/**
 * The info string of generated TypeScript excerpts. Not `ts`: `scripts/docs-samples.unit.test.ts` walks every Markdown
 * file of the repository, the committed examples included, and requires a sample marker on each `ts` fence.
 */
const TYPE_FENCE = 'text'

function fence(language: string, text: string): string {
	return `\`\`\`${language}\n${text.trimEnd()}\n\`\`\``
}

function typeExcerpt(ir: SystemIr, names: readonly string[]): string {
	return names.map(name => ir.types[name])
		.filter(type => type !== undefined)
		.map(type => `// ${type.file}\n${type.text}`)
		.join('\n\n')
}

/** The object members of a value shape (through unions and `null`), named types left out: they are listed by name. */
function inlineObjects(shape: Shape): Extract<Shape, { kind: 'object' }>[] {
	switch (shape.kind) {
		case 'object': return [shape]
		case 'union': return shape.members.flatMap(inlineObjects)
		case 'array': return inlineObjects(shape.items)
		default: return []
	}
}

/**
 * The documented fields of the inline object types in `shape`, one list item each (a field in several members of a
 * union once), nested fields indented below their field. A widget reference says which types it names.
 */
function fieldLines(shape: Shape, indent: string, depth = 0): string[] {
	if (depth > 4)
		return []
	const lines: string[] = []
	const seen = new Set<string>()
	for (const object of inlineObjects(shape)) {
		for (const property of object.properties) {
			if (seen.has(property.name))
				continue
			seen.add(property.name)
			const widgetRef = widgetRefOf(property.shape)
			lines.push(`${indent}- \`${property.name}\`${property.optional ? ' (optional)' : ''}: ${inline(property.doc)}${widgetRef === null ? '' : ` ${describeWidgetRef(widgetRef)}`}`)
			lines.push(...fieldLines(property.shape, `${indent}  `, depth + 1))
		}
	}
	return lines
}

/** The descriptions of named types and their fields, as a list (the excerpts above them carry no prose). */
function typeNotes(ir: SystemIr, names: readonly string[]): string {
	return names.map(name => ir.types[name])
		.filter(type => type !== undefined)
		.map(type => [`- \`${type.name}\`${type.doc.summary === '' ? '' : `: ${inline(type.doc)}`}`, ...fieldLines(type.shape, '  ')].join('\n'))
		.join('\n')
}

function slotList(plugin: PluginIr): string {
	if (plugin.slots.length === 0)
		return 'No slots: this widget cannot have children.'
	return plugin.slots.map(slot => `- \`${slot.name}\` (\`${slot.expectationText}\`): ${inline(slot.doc)} ${describeExpectation(slot)}`)
		.join('\n')
}

function reasonList(reasons: readonly ReasonIr[]): string {
	return reasons.map((reason) => {
		const head = `- \`${reason.name}\` (${reason.payload === null ? 'no `details`' : `\`details: ${reason.payload.typeText}\``}): ${inline(reason.doc)}`
		return [head, ...(reason.payload === null ? [] : fieldLines(reason.payload.shape, '  '))].join('\n')
	})
		.join('\n')
}

function authoringReference(ir: SystemIr, plugin: PluginIr): string {
	const lines = [`# ${plugin.type}`, '', prose(plugin.doc), '', '## Config', '']
	if (plugin.config === null) {
		lines.push('This type takes no config. Leave `config` out.')
	}
	else {
		const named = namedTypesOf(ir, plugin.config.rawShape)
		lines.push(prose(plugin.config.doc), '', plugin.config.omittable ? '`config` may be left out.' : '`config` is required.', '', `Raw config type: \`${plugin.config.rawText}\``, '', fence(TYPE_FENCE, typeExcerpt(ir, named) || `type Config = ${plugin.config.rawText}`))
		const fields = fieldLines(plugin.config.rawShape, '')
		if (fields.length > 0)
			lines.push('', 'Fields:', '', ...fields)
		if (named.length > 0)
			lines.push('', 'Types:', '', typeNotes(ir, named))
	}
	lines.push('', '## Slots', '', slotList(plugin))
	if (plugin.reasons !== null && plugin.reasons.length > 0)
		lines.push('', '## Diagnostic reasons', '', 'A diagnostic this type reports names one of these `reason`s and carries `details` as shown. Read them to decide the repair.', '', reasonList(plugin.reasons))
	return `${lines.join('\n')}\n`
}

function rendererReference(ir: SystemIr, plugin: PluginIr): string {
	const lines = [`# ${plugin.type} renderer`, '', prose(plugin.doc), '']
	lines.push('## Config (resolved)', '', plugin.config === null ? 'No config: `config` is not on the surface.' : `\`config\` is the resolved config: \`${plugin.config.resolvedText}\`.`, '')
	if (plugin.config !== null) {
		const fields = fieldLines(plugin.config.resolvedShape, '')
		if (fields.length > 0)
			lines.push(...fields, '')
	}
	lines.push('## State', '', plugin.state.length === 0
		? 'No State.'
		: ['| Name | Type | authorWritable | Description |', '| --- | --- | --- | --- |', ...plugin.state.map(member => `| \`${member.name}\` | \`${member.typeText.replaceAll('|', '\\|')}\` | ${member.authorWritable === null ? 'unknown' : String(member.authorWritable)} | ${inline(member.doc)
				.replaceAll('|', '\\|')} |`)].join('\n'), '')
	lines.push('## Properties (read-only, computed)', '', plugin.properties.length === 0
		? 'No Properties.'
		: ['| Name | Type | Description |', '| --- | --- | --- |', ...plugin.properties.map(member => `| \`${member.name}\` | \`${member.typeText.replaceAll('|', '\\|')}\` | ${inline(member.doc)
				.replaceAll('|', '\\|')} |`)].join('\n'), '')
	lines.push('## Methods', '')
	if (plugin.methods.length === 0)
		lines.push('No Methods.')
	for (const method of plugin.methods) {
		lines.push(`### \`${method.signature}\``, '', prose(method.doc))
		for (const param of method.params)
			lines.push(`- \`${param.name}${param.optional ? '?' : ''}: ${param.typeText}\`${param.doc === '' ? '' : `: ${oneLine(param.doc)}`}`)
		lines.push(`- Returns \`${method.returnText}\`${method.returnsDoc === ''
			? ''
			: `: ${oneLine(method.returnsDoc)
				.replace(/\.$/, '')}`}. Through \`useMethods()\` the call returns \`${method.returnText} | null\`: \`null\` when it failed (read \`useMethodDiagnostics().${method.name}\`).`, '')
	}
	lines.push('## Events', '', plugin.events.length === 0
		? 'No Events.'
		: plugin.events.map(event => [
				`- \`${event.name}(${event.payload.map(item => `${item.label ?? 'arg'}: ${item.typeText}`)
					.join(', ')})\`: ${prose(event.doc)}`,
				...event.payload.filter(item => item.doc !== '')
					.map(item => `  - \`${item.label ?? 'arg'}\`: ${oneLine(item.doc)}`),
			].join('\n'))
				.join('\n'), '')
	lines.push('## Slots', '', plugin.slots.length === 0 ? 'No slots: `WidgetSlot` is not on the surface.' : `${slotList(plugin)}\n\nRender each with \`<WidgetSlot name="...">\` from this widget's \`useWidget()\` result.`, '')
	lines.push('## Diagnostic reasons', '', plugin.reasons === null || plugin.reasons.length === 0
		? 'None declared: a diagnostic of this type may carry any `reason` string and any JSON `details`.'
		: `The diagnostics of this type's State, Properties and Methods are a union discriminated by \`reason\`: \`details\` is present exactly when the reason has a payload, and has its type.\n\n${reasonList(plugin.reasons)}`, '')
	const excerpt = typeExcerpt(ir, plugin.typeNames)
	if (excerpt !== '')
		lines.push('## Referenced types', '', fence(TYPE_FENCE, excerpt), '', typeNotes(ir, plugin.typeNames), '')
	return lines.join('\n')
}

export interface SkillOptions {
	/**
	 * A complete, valid document of the System, shown as the example in the authoring skill. The caller is
	 * responsible for having compiled it (`compileWithSystem`): the emitter cannot run Core.
	 */
	example?: unknown
}

export function emitSkills(ir: SystemIr, schemas: { fullSchema: string, llmSchema: string }, options: SkillOptions = {}): Record<string, string> {
	const files: Record<string, string> = {}
	const system = kebab(ir.system)
	const fileNames = new Map<string, string>()
	for (const plugin of ir.plugins) {
		const name = kebab(plugin.type)
		const other = fileNames.get(name)
		if (other !== undefined)
			throw new Error(`The widget types "${other}" and "${plugin.type}" both map to the reference file "${name}.md".`)
		fileNames.set(name, plugin.type)
	}
	const typeList = ir.plugins.map(plugin => `- \`${plugin.type}\`: ${prose(plugin.doc)
		.split('\n')[0]} See \`references/${kebab(plugin.type)}.md\`.`)
		.join('\n')
	const explicitChildren = new Set(ir.plugins.flatMap(parent => parent.slots.flatMap(slot => slot.expected ?? [])))
	const knowsPlacement = ir.plugins.some(parent => parent.slots.some(slot => slot.expected !== null))
	const rootCandidates = ir.plugins.filter(plugin => !explicitChildren.has(plugin.type))
	const example = options.example === undefined
		? `No example document was supplied when this skill was generated. The shape of a node:\n\n${fence('text', '{ "id": "<unique id>", "type": "<one of the types below>", "config": { ... }, "slots": { "<slot name>": [ <child widgets> ] } }')}`
		: `A complete document that compiles without diagnostics:\n\n${fence('json', JSON.stringify(options.example, null, 2))}`

	// --- source-json-authoring -----------------------------------------------------------------------
	const authoring = `skills/${system}-source-json-authoring`
	files[`${authoring}/SKILL.md`] = `${frontmatter(`${system}-source-json-authoring`, `Write or repair the JSON source of a ${ir.system} widget document: node grammar, per-type config, slots, the flat node-list schema for structured output, and how to validate and repair with Blueprint diagnostics.`)}
# Authoring ${ir.system} documents

## Node grammar

A document is one root widget. A widget is a JSON object with these keys and no others:

- \`id\` (string): unique within the document.
- \`type\` (string): one of the types below.
- \`config\` (object): the type's raw config. Required unless the type's reference says it may be left out.
- \`slots\` (object): slot name to an array of child widgets, in order. Only the slots the type declares.
- \`meta\`: reserved for tools; do not write it, and keep it unchanged when editing a document that has it.

${example}

## Types

${typeList}

Each slot names the types it expects (each type's reference lists its slots). The expectation is the plugin's
intent: the compiler enforces only what the plugin's structure validators check, so follow it anyway.${knowsPlacement && rootCandidates.length > 0
	? ` Types no slot names as a child (root candidates): ${rootCandidates.map(plugin => `\`${plugin.type}\``)
		.join(', ')}.`
	: ''}

## References between widgets

A config value that names another widget holds that widget's \`id\` (the type's reference says "Must be the id of a
widget of type ..." for it). The id must exist in the same document and be of a listed type.

## Structured output: the flat node list

When the output must follow a JSON Schema (tool input, structured output), use
\`references/document.llm.schema.json\` instead of the tree. It is sized for non-strict structured output and
only gets the structure roughly right.

- \`{ "nodes": [{ "id", "type", "parent", "slot", "config" }] }\`; exactly one node has no \`parent\` and no
  \`slot\` (the root).
- Children of one slot keep the order they have in \`nodes\`; list parents before children.
- Leave an optional key out; do not write \`null\` for it. Leave \`config\` out when the type takes none.
- \`slots\` (a list of slot names) is only needed to declare a slot that has no children.
- A dictionary (for example text per language) is a list of \`{ "key", "value" }\` entries.
- Limits (ranges, lengths, formats) are in the descriptions, not in schema keywords: read them.

### Converting the flat list to the tree

The conversion is mechanical. Do it in code, or by hand, exactly like this:

1. For every node create a widget \`{ "id", "type" }\`. Copy \`config\` if the node has the key, after rewriting it
   (step 4). Copy \`meta\` unchanged if present.
2. The one node without \`parent\` is the root. Zero or several such nodes, a \`parent\` that is not a node's id, a
   repeated id, or a node that cannot be reached from the root is an error: fix the list, do not guess.
3. For every other node, in list order, append its widget to \`slots[slot]\` of its parent's widget. If a node
   lists \`slots\`, create those slot arrays first, in that order, so a slot without children still exists.
4. In a config, wherever the type's reference shows a dictionary type, turn the entry list
   \`[{ "key": "en", "value": "Hello" }]\` into the object \`{ "en": "Hello" }\`. Leave everything else as it is.

The inverse (tree to flat) walks the tree depth-first, slot by slot, and applies step 4 in reverse.
\`references/document.schema.json\` is the full schema of the tree form.

## Validate and repair

The schemas only get the structure roughly right. The arbiter is the compiler:

1. \`const blueprint = system.createBlueprint(tree)\` (or \`createBlueprintFromJson(text)\`).
2. \`blueprint.status\` is \`'valid'\` or \`'invalid'\`; \`blueprint.diagnostics\` lists every problem.
3. Each diagnostic has a \`code\` (for example \`invalid-widget-config\`, \`invalid-widget-structure\`,
   \`unexpected-widget-field\`, \`duplicate-widget-id\`), a \`message\`, a location naming the widget, for config
   problems a \`path\` into the config, and, when the plugin reported one, a machine-readable \`reason\` with its
   \`details\`. Each type's reference lists its reasons and the shape of their \`details\`.
4. Fix exactly what each diagnostic names, keep everything else, and compile again. Repeat until \`valid\`.
   Do not rewrite the document from scratch: an invalid document still compiles to an inspectable Blueprint, so
   the diagnostics are complete, not just the first error.
`
	for (const plugin of ir.plugins)
		files[`${authoring}/references/${kebab(plugin.type)}.md`] = authoringReference(ir, plugin)
	files[`${authoring}/references/document.schema.json`] = schemas.fullSchema
	files[`${authoring}/references/document.llm.schema.json`] = schemas.llmSchema

	// --- renderer-implementation ---------------------------------------------------------------------
	const renderer = `skills/${system}-renderer-implementation`
	files[`${renderer}/SKILL.md`] = `${frontmatter(`${system}-renderer-implementation`, `Implement Vue renderers for the ${ir.system} widget types with @deviltea/widget-vue: the registration chain, and each type's config, State, Properties, Methods, Events, slots and diagnostic reasons. The widget-vue-renderer skill explains the API.`)}
# Implementing ${ir.system} renderers

This skill lists what is specific to ${ir.system}. The API it uses (\`createWidgetVueRenderer\`, the root renderer,
\`useWidget()\`, \`WidgetSlot\`, \`@deviltea/widget-vue/testing\`, the integration errors) is explained by the
\`widget-vue-renderer\` skill, which ships with \`@deviltea/widget-vue\` in \`skills/widget-vue-renderer/\`
(\`npx skills experimental_sync\` links it from \`node_modules\`). Read that skill first.

## Registration

One Vue component per widget type, registered once for the System:

\`\`\`text
import { createWidgetVueRenderer } from '@deviltea/widget-vue'

export const SystemRenderer = createWidgetVueRenderer(system, renderers => renderers
${ir.plugins.map(plugin => `	.${plugin.type}(${plugin.type}Renderer)`)
	.join('\n')})
\`\`\`

The chain names every plugin type of the System exactly once. Each renderer calls \`useWidget(Plugin)\` with the
plugin of its type.

## Types

Each reference lists the type's resolved config, State (with \`authorWritable\`), Properties, Methods, Events, slots
and diagnostic reasons, with their descriptions.

${ir.plugins.map(plugin => `- \`${plugin.type}\`: \`references/${kebab(plugin.type)}.md\``)
	.join('\n')}
`
	for (const plugin of ir.plugins)
		files[`${renderer}/references/${kebab(plugin.type)}.md`] = rendererReference(ir, plugin)
	return files
}
