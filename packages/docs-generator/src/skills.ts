/**
 * The three Markdown skills (Agent Skills layout: `SKILL.md` with `name`/`description` frontmatter, plus
 * `references/`). `source-json-authoring` and `renderer-implementation` are generated from the IR;
 * `plugin-authoring` is generic to `@deviltea/widget-core` and only quotes the System for examples.
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

const DOCS_SPEC = `## Documentation in the builder

A plugin's prose is written in the builder, beside each definition, and Core keeps it as plain data on
\`plugin.docs\`. The \`Interfaces\` type is the shape; a comment on it is an ordinary comment that no tool reads.
Documentation tools take the shape from the types and every description from \`plugin.docs\`.

| Where | What it documents |
| --- | --- |
| \`.description(text)\` | The plugin. The first phase of the builder. |
| \`.config({ description, raw, resolved, ... })\` | The config, and the fields of the raw and the resolved config (field docs). |
| \`.slots({ name: { description } })\` | Each slot. |
| State and Property definitions: \`description\` plus field docs | The value, and its fields when it has any. |
| Method definitions: \`description\`, \`params\`, \`returns\` | The Method, one entry per parameter (by position), and the return value (left out when it returns nothing). |
| \`.events({ name: { description, payload } })\` | Each Event of the Interfaces, and one entry per payload position. |
| \`.reasons({ reason: { description, details } })\` | Each diagnostic reason; \`details\` documents the payload and is left out for \`void\`. |

**Field docs.** For a value of type \`T\`, the docs beside its description are complete, and the compiler checks it:

- an object type: \`fields\`, an entry for every key (optional keys included; for a union, every key of every member);
- an array: \`items\`, and a dictionary (\`Record\`, an index signature): \`values\`, when the element has fields of its own;
- a primitive, a literal union or a widget reference: the description only. \`null\` and \`undefined\` are ignored.

**Descriptions.** A description is Markdown prose for a reader who has not seen the code: what the value means and
what \`validate\` enforces. Constraints (ranges, lengths, patterns, defaults) are stated in it ("At least 1; 10 when
left out.") and enforced by \`validate\`: the JSON Schema has the shape only. The first paragraph is the summary;
the rest is shown in full where there is room.

**Shared types.** \`defineTypeDocs<T>(name, docs)\` documents a named type once (its description and its fields);
a field of that type refers to it with \`ref\`, and a recursive type refers to itself with a thunk
(\`items: { ref: () => conditionDocs }\`, with the annotation \`const conditionDocs: TypeDocs<Condition>\`). Use the
type's own name: it is the type's one \`$defs\` entry in the schemas. A named type documented in two places must be
documented the same way in both (\`--check\` reports a conflict), so give a type used by several fields or plugins
its \`defineTypeDocs\`. \`defineFieldDocs<T>()(docs)\` checks docs held in a variable exactly, at every depth.

**Widget references.** A config field that holds the id of another widget is typed \`WidgetRef<'A' | 'B'>\` (from
\`@deviltea/widget-core\`): any string is accepted, nothing is checked at run time, and the schemas say which widget
types the id must name.

**\`undocumented\`.** The marker type-checks wherever a description or a docs object is required, so a draft or a
test plugin compiles. \`widget-docs-generator --check\` reports each one as an error, with its plugin and docs path.
`

const PLUGIN_AUTHORING = `# Writing a Widget plugin

A plugin is built with \`createWidgetPlugin(type)\` from \`@deviltea/widget-core\` and describes one widget type:
its config, slots, State, Properties, Methods, Events and diagnostic reasons. Core compiles authored JSON against
the registered plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

This skill describes the API of the \`@deviltea/widget-core\` 0.4 line. Check the package's own documentation when
the installed version differs.

## 1. Declare the Interfaces first

The \`Interfaces\` type is the single source of the plugin's shape. Core stores no schema: JSON Schema is generated
from the types. The prose is written in the builder (section 2).

\`\`\`text
import type { WidgetRef } from '@deviltea/widget-core'

export interface CounterRawConfig {
	step?: number
	mirrorOf?: WidgetRef<'Counter'>
}

export interface CounterInterfaces {
	config: {
		raw: CounterRawConfig | null
		resolved: { step: number, mirrorOf: string | null }
	}
	slots: {
		labels: 'Label' | 'Icon'
	}
	state: {
		count: number
	}
	methods: {
		increment: () => number
	}
	events: {
		changed: [count: number]
	}
	reasons: {
		'invalid-step': { received: unknown }
		'at-limit': void
	}
}
\`\`\`

- A capability exists only when its key is a required property of the Interfaces type. Leave a key out to not
  have the capability; \`slots: never\` is the explicit "declared, empty" spelling.
- \`config.raw\` is what the author writes; include \`null\` when the config may be left out (an omitted config is
  validated as \`null\`). \`config.resolved\` is what the plugin and its renderer read.
- A config field that holds another widget's id is a \`WidgetRef<Types>\`: it names the widget types the id may
  name. It is type-level only: nothing checks it at run time.
- \`slots\` is a record: each key is a slot name and each value what the slot expects of its children: a union of
  plugin \`type\` literals (\`'Label' | 'Icon'\`), \`WidgetContract<Shape>\` (any widget that has the members of
  \`Shape\`), \`WidgetContract<Shape, 'Label' | 'Icon'>\` (the named types, each of which must have them), or
  \`WidgetChild\` (any widget). The expectation is type-level only: Core checks nothing at run time, so enforce it in
  the slot's \`validateStructure\` when it matters.
- \`reasons\` lists the diagnostic reasons the plugin reports. Each value is the type of the diagnostic's
  \`details\` (\`void\` for none); \`details\` must be a JSON value.
- Label Event payload tuples (\`[count: number]\`) and name Method parameters: the names show up in the generated
  references, and the docs of each position are written by position in the builder.

## 2. Builder phases, in this order, with their docs

\`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → reasons? → done\`

\`\`\`text
createWidgetPlugin('Counter')
	.description('A counter that counts in steps.')
	.interfaces<CounterInterfaces>()
	.config({
		description: 'How the counter counts.',
		raw: {
			fields: {
				step: { description: 'How much one step adds: a whole number of at least 1; 1 when left out.' },
				mirrorOf: { description: 'Another counter whose count this one shows.' },
			},
		},
		resolved: {
			fields: {
				step: { description: 'How much one step adds.' },
				mirrorOf: { description: 'The mirrored counter, or null for none.' },
			},
		},
		validate: (input, ctx): input is CounterRawConfig | null => { /* ... */ },
		resolve: raw => ({ step: raw?.step ?? 1, mirrorOf: raw?.mirrorOf ?? null }),
	})
	.slots({ labels: { description: 'Labels shown next to the count.' } })
	.state(state => state.count({
		description: 'The current count.',
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.methods(methods => methods.increment({
		description: 'Adds one step.',
		returns: { description: 'The new count.' },
		/* validateArgs, registerDeps, emits, execute */
	}))
	.events({ changed: { description: 'The count changed.', payload: [{ description: 'The new count.' }] } })
	.reasons({
		'invalid-step': { description: 'The step is not a positive whole number.', details: { fields: { received: { description: 'The value given.' } } } },
		'at-limit': { description: 'The count reached its limit.' },
	})
	.done()
\`\`\`

- \`.description(text)\` comes first; then \`.interfaces<Interfaces>()\`. A later phase can be skipped but not
  reordered. Section builders are sealed and capture definitions by value; a malformed declaration throws a
  \`TypeError\` naming plugin, section, member and field when the plugin is built.
- Every definition carries its docs (see \`references/plugin-docs.md\`): the compiler requires a description for every
  member and field docs for every field, so nothing can be left undocumented by accident.
- \`.config({ description, raw, resolved, validate, resolve })\`: \`validate\` always runs and reports problems with
  \`ctx.addDiagnostic({ message, path, reason, details })\`; \`resolve\` turns the raw config into the resolved one
  (and is called with \`null\` when validation failed).
- \`.slots({ name: { description, validateStructure? } })\`: one complete map, every declared slot present.
- \`.structure(validateStructure)\`: the plugin-level structure check. It is not a capability.
- \`.state\`: each member has \`description\`, \`validate\` and \`default\`. \`authorWritable: true\` is passive metadata
  telling editors the value may be set by an author.
- \`.properties\`: \`registerDeps\` declares what \`compute\` reads; \`compute\` is pure. In a plugin with slots,
  \`registerDeps\` gets \`slot(name)\`: the resolved children of the widget's own slot, each a dependency target. A
  \`WidgetContract\` slot types their reads by its \`Shape\`; other slots give untyped reads (refine with
  \`.validate()\`).
- \`.methods\`: \`description\`, \`params\`, \`returns\`, \`validateArgs\`, \`registerDeps\`, \`emits\` (the Events it may
  emit, required when it emits), \`execute\`.
- \`.events({ changed: { description, payload } })\`: one entry for every Event of the Interfaces. Events are
  declared after the Methods; \`emits\` names are validated against them in \`done()\`.
- \`.reasons({ ... })\`: one entry for every reason of the Interfaces. It records docs only.

## 3. Every callback is synchronous

All framework-owned callbacks (\`validate\`, \`resolve\`, \`default\`, \`compute\`, \`validateArgs\`, \`execute\`, the
structure validators) are synchronous. Returning a Promise or thenable is a contract violation: a type error
where Core can infer it, and a runtime throw otherwise. Callback contexts close when the callback returns:
\`addDiagnostic\`, \`hasAnyDiagnostic\`, \`deps.*\` and \`emit\` must not be kept and called later.

## 4. Async work belongs to the host

A Method records intent and emits an Event; the host (the page, the renderer's owner) listens, does the waiting
(fetch, timers, a backend) and calls another Method with the outcome. The widget never awaits. Model the waiting
as State (\`pending\`, \`confirmed\`, \`declined\`) so the renderer can show it.

## 5. Failure is a diagnostic, not an exception

- Config and structure problems are Blueprint diagnostics with a \`path\`, and, when the plugin gave them, a
  \`reason\` and its \`details\`. Once \`reasons\` is declared, a \`reason\` outside it, a missing payload, a payload on
  a \`void\` reason and \`details\` without a \`reason\` are type errors.
- A Method reports a refusal with \`addDiagnostic({ message, reason, details })\`. Its result is then a failure
  (\`invalid-method-arguments\` from \`validateArgs\`, \`invalid-method-result\` from \`execute\`), and the value it
  returned is diagnostic context only.
- **A failing Method is not rolled back.** Core batches a Method's writes so subscribers are notified once, but
  that is propagation atomicity, not a transaction: a State write or an emitted Event that happened before a
  later failure stays. So refuse first: reject bad arguments in \`validateArgs\` (then \`execute\` never runs), and
  in \`execute\` check every condition and \`return\` before the first \`deps.set...()\` or \`emit\`.

## 6. Read-only Methods

A Method is read-only when it neither writes State nor emits an Event, itself or through the Methods it invokes.
Only a read-only Method may be a dependency of a Property (otherwise: \`property-dependency-has-side-effects\`).
Put shared rules in a read-only Method (for example \`canEnter(index)\`) and let the writing Methods invoke it, so
the rule exists once.

## 7. Source rules worth knowing

A widget node's recognized keys are \`id\`, \`type\`, \`config\`, \`slots\` and \`meta\`; anything else is
\`unexpected-widget-field\`. Duplicate ids are \`duplicate-widget-id\`. Unknown config keys are the plugin's to reject.

## 8. Register and check

\`createWidgetSystem({ plugins: [A, B] as const })\`: keep the tuple \`as const\` so the System's type lists every
plugin. It is a type error when a slot names an unregistered plugin type, or when a plugin named by a
\`WidgetContract<Shape, Types>\` lacks a member of \`Shape\`. An application loads exactly one Core instance; a
plugin library declares Core as a peer dependency. Check the documentation of the System with the generator's
\`--check\`: it fails on an \`undocumented\` marker, on a name the types and the runtime or the docs disagree on, and
on a named type documented two different ways.

See \`references/plugin-docs.md\` for the documentation rules and \`references/example-interfaces.md\` for this
System's Interfaces.
`

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
	files[`${renderer}/SKILL.md`] = `${frontmatter(`${system}-renderer-implementation`, `Implement Vue renderers for the ${ir.system} widget types with @deviltea/widget-vue: registration, the useWidget() surface, and each type's State, Properties, Methods, Events and slots.`)}
# Implementing ${ir.system} renderers

Everything here comes from the public exports of \`@deviltea/widget-vue\`: \`createWidgetVueRenderer\`,
\`useWidget\`, \`WidgetVueIntegrationError\` and the \`UseWidget*\` / \`WidgetSlot*\` types.

## Registration

One Vue component per widget type, registered once for the System:

\`\`\`text
import { createWidgetVueRenderer } from '@deviltea/widget-vue'

export const SystemRenderer = createWidgetVueRenderer(system, renderers => renderers
${ir.plugins.map(plugin => `	.${plugin.type}(${plugin.type}Renderer)`)
	.join('\n')})
\`\`\`

- The registry is exhaustive: the chain names every plugin type of the System exactly once.
- The result is a component bound to that exact System. Mount it with the Runtime to show:
  \`<SystemRenderer :runtime="runtime" />\`. A Runtime of another System is a programming error, not a diagnostic.
- Giving it a different Runtime remounts the whole tree. It never disposes a Runtime: whoever created the
  Runtime (\`blueprint.createRuntime()\`) disposes it.

## The \`useWidget()\` surface

A renderer calls \`useWidget(Plugin)\` in its \`setup()\` with the exact plugin object: it is the type witness and a
runtime identity check. Calling it outside a registered renderer throws \`WidgetVueIntegrationError\`. Only the
accessors of the capabilities the plugin declares are present.

| Accessor | Present when | What it gives |
| --- | --- | --- |
| \`config\` | config | The resolved config, deeply read-only (never the raw one). |
| \`useState()\` | state | One writable \`Ref<T \\| null>\` per State member. Assigning runs the member's \`validate\`; a rejected write is reported in \`useStateDiagnostics()\`. |
| \`useProperties()\` | properties | One read-only ref of \`T \\| null\` per Property, computed lazily on first read. \`null\` means the Property failed; \`usePropertyDiagnostics()\` says why. |
| \`useMethods()\` | methods | One function per Method. It returns the Method's value on success and \`null\` on failure. It never returns a result object and does not throw for a refused call. |
| \`emit\` | events | The typed Event emitter. Prefer letting Methods emit. |
| \`useStateDiagnostics()\`, \`usePropertyDiagnostics()\`, \`useMethodDiagnostics()\` | the capability | One read-only ref of diagnostics per member. |
| \`useDiagnostics()\` | always | The widget's own diagnostics. |
| \`WidgetSlot\` | slots | The component that renders a slot's children. |
| \`widgetId\`, \`widgetType\` | always | The identity of the widget being rendered. |

## Rules

- Handle \`null\`: every State and Property ref may be \`null\`, and so may every Method call's return value.
- To learn why a Method call failed, read \`useMethodDiagnostics().<method>.value\` after the call: each
  diagnostic has a \`code\` (\`invalid-method-arguments\`, \`invalid-method-result\`), a \`message\` and, when the
  plugin gave one, a \`reason\` and its \`details\` (typed by the plugin's declared reasons: see each type's
  reference). A \`null\` return is the only signal on the call itself, so a Method whose
  successful value could be \`null\` must be told apart through its diagnostics.
- A failed Method call is not rolled back: State it wrote and Events it emitted before failing stay. Render
  from State and Properties after the call rather than assuming nothing changed.
- A renderer displays State and Properties and calls Methods. It does not keep a second copy of widget state.
- \`authorWritable\` State is meant to be set by an author or editor; other State is changed through Methods.
- Methods are synchronous. Async work belongs to the host: listen to the Event, wait, then call a Method.
- Render a slot with \`<WidgetSlot name="slotName">\`; its default scoped slot is called once per child with
  \`{ Child, id, type, index }\`, where \`type\` is narrowed to the types the slot expects. Render \`<Child />\` (it
  takes no props) inside whatever wrapper you need, or leave a child out. The expectation is not checked at run
  time: a child of another type is possible when the plugin does not refuse it.

## Types

${ir.plugins.map(plugin => `- \`${plugin.type}\`: \`references/${kebab(plugin.type)}.md\``)
	.join('\n')}
`
	for (const plugin of ir.plugins)
		files[`${renderer}/references/${kebab(plugin.type)}.md`] = rendererReference(ir, plugin)

	// --- plugin-authoring ----------------------------------------------------------------------------
	const authoringPlugin = 'skills/widget-plugin-authoring'
	files[`${authoringPlugin}/SKILL.md`] = `${frontmatter('widget-plugin-authoring', 'Write a @deviltea/widget-core plugin: the Interfaces type, builder phases, synchronous callbacks, diagnostics, why a failing Method is not rolled back, read-only Methods, async at the host, and the documentation written in the builder.')}\n${PLUGIN_AUTHORING}`
	files[`${authoringPlugin}/references/plugin-docs.md`] = `# Plugin documentation\n\n${DOCS_SPEC}`
	files[`${authoringPlugin}/references/example-interfaces.md`] = `# Interfaces of ${ir.system}\n\nRead from the types. The descriptions are written in each plugin's builder (\`plugin.docs\`), not here.\n\n${ir.plugins.map(plugin => `## ${plugin.type}${plugin.interfacesName === null ? '' : ` (\`${plugin.interfacesName}\`)`}\n\n${fence(TYPE_FENCE, [
		plugin.config === null ? '' : `config: { raw: ${plugin.config.rawText}, resolved: ${plugin.config.resolvedText} }`,
		!plugin.capabilities.slots
			? ''
			: `slots: ${plugin.slots.length === 0
				? 'never'
				: `{ ${plugin.slots.map(slot => `${slot.name}: ${slot.expectationText}`)
					.join(', ')} }`}`,
		...plugin.state.map(member => `state.${member.name}: ${member.typeText}`),
		...plugin.properties.map(member => `properties.${member.name}: ${member.typeText}`),
		...plugin.methods.map(member => `methods.${member.signature}`),
		...plugin.events.map(event => `events.${event.name}: [${event.payload.map(item => `${item.label ?? 'arg'}: ${item.typeText}`)
			.join(', ')}]`),
		...(plugin.reasons ?? []).map(reason => `reasons['${reason.name}']: ${reason.payload?.typeText ?? 'void'}`),
	].filter(line => line !== '')
		.join('\n'))}`)
		.join('\n\n')}\n`
	return files
}
