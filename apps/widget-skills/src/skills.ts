/**
 * The three Markdown skills (Agent Skills layout: `SKILL.md` with `name`/`description` frontmatter, plus
 * `references/`). `source-json-authoring` and `renderer-implementation` are generated from the IR;
 * `plugin-authoring` is generic to `@deviltea/widget-core` and only quotes the System for examples.
 */

import type { Doc, PluginIr, ReasonIr, SystemIr } from './ir'
import { CONSTRAINT_TAGS } from './ir'
import { describeExpectation, namedTypesOf } from './schema'

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

function tagLines(doc: Doc): string {
	const entries = Object.entries(doc.tags)
	return entries.length === 0
		? ''
		: ` (${entries.map(([tag, value]) => `\`@${tag} ${value}\``)
			.join(', ')})`
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

function slotList(plugin: PluginIr): string {
	if (plugin.slots.length === 0)
		return 'No slots: this widget cannot have children.'
	return plugin.slots.map(slot => `- \`${slot.name}\` (\`${slot.expectationText}\`): ${inline(slot.doc)} ${describeExpectation(slot)}`)
		.join('\n')
}

function reasonList(reasons: readonly ReasonIr[]): string {
	return reasons.map(reason => `- \`${reason.name}\` (${reason.payload === null ? 'no `details`' : `\`details: ${reason.payload.typeText}\``}): ${inline(reason.doc)}`)
		.join('\n')
}

function authoringReference(ir: SystemIr, plugin: PluginIr): string {
	const lines = [`# ${plugin.type}`, '', prose(plugin.doc), '', '## Config', '']
	if (plugin.config === null) {
		lines.push('This type takes no config. Leave `config` out.')
	}
	else {
		lines.push(prose(plugin.config.doc), '', plugin.config.omittable ? '`config` may be left out.' : '`config` is required.', '', `Raw config type: \`${plugin.config.rawText}\``, '', fence(TYPE_FENCE, typeExcerpt(ir, namedTypesOf(ir, plugin.config.rawShape)) || `type Config = ${plugin.config.rawText}`))
	}
	lines.push('', '## Slots', '', slotList(plugin))
	if (plugin.reasons !== null && plugin.reasons.length > 0)
		lines.push('', '## Diagnostic reasons', '', 'A diagnostic this type reports names one of these `reason`s and carries `details` as shown. Read them to decide the repair.', '', reasonList(plugin.reasons))
	return `${lines.join('\n')}\n`
}

function rendererReference(ir: SystemIr, plugin: PluginIr): string {
	const lines = [`# ${plugin.type} renderer`, '', prose(plugin.doc), '']
	lines.push('## Config (resolved)', '', plugin.config === null ? 'No config: `config` is not on the surface.' : `\`config\` is the resolved config: \`${plugin.config.resolvedText}\`.`, '')
	lines.push('## State', '', plugin.state.length === 0
		? 'No State.'
		: ['| Name | Type | authorWritable | Description |', '| --- | --- | --- | --- |', ...plugin.state.map(member => `| \`${member.name}\` | \`${member.typeText.replaceAll('|', '\\|')}\` | ${member.authorWritable === null ? 'unknown' : String(member.authorWritable)} | ${inline(member.doc)}${tagLines(member.doc)} |`)].join('\n'), '')
	lines.push('## Properties (read-only, computed)', '', plugin.properties.length === 0
		? 'No Properties.'
		: ['| Name | Type | Description |', '| --- | --- | --- |', ...plugin.properties.map(member => `| \`${member.name}\` | \`${member.typeText.replaceAll('|', '\\|')}\` | ${inline(member.doc)} |`)].join('\n'), '')
	lines.push('## Methods', '')
	if (plugin.methods.length === 0)
		lines.push('No Methods.')
	for (const method of plugin.methods) {
		lines.push(`### \`${method.signature}\``, '', prose(method.doc))
		for (const param of method.params)
			lines.push(`- \`${param.name}${param.optional ? '?' : ''}: ${param.typeText}\`${param.doc === '' ? '' : `: ${param.doc}`}`)
		lines.push(`- Returns \`${method.returnText}\`${method.returnsDoc === '' ? '' : `: ${method.returnsDoc.replace(/\.$/, '')}`}. Through \`useMethods()\` the call returns \`${method.returnText} | null\`: \`null\` when it failed (read \`useMethodDiagnostics().${method.name}\`).`, '')
	}
	lines.push('## Events', '', plugin.events.length === 0
		? 'No Events.'
		: plugin.events.map(event => `- \`${event.name}(${event.payload.map(item => `${item.label ?? 'arg'}: ${item.typeText}`)
				.join(', ')})\`: ${prose(event.doc)}`)
				.join('\n'), '')
	lines.push('## Slots', '', plugin.slots.length === 0 ? 'No slots: `WidgetSlot` is not on the surface.' : `${slotList(plugin)}\n\nRender each with \`<WidgetSlot name="...">\` from this widget's \`useWidget()\` result.`, '')
	lines.push('## Diagnostic reasons', '', plugin.reasons === null || plugin.reasons.length === 0
		? 'None declared: a diagnostic of this type may carry any `reason` string and any JSON `details`.'
		: `The diagnostics of this type's State, Properties and Methods are a union discriminated by \`reason\`: \`details\` is present exactly when the reason has a payload, and has its type.\n\n${reasonList(plugin.reasons)}`, '')
	const excerpt = typeExcerpt(ir, plugin.typeNames)
	if (excerpt !== '')
		lines.push('## Referenced types', '', fence(TYPE_FENCE, excerpt), '')
	return lines.join('\n')
}

const TAG_SPEC = `## JSDoc tag set

Document the \`XxxInterfaces\` type itself and every member of it with JSDoc: \`config\` and each field of its \`raw\`
type, each slot, State member, Property, Method and its parameters, Event and reason (and each field of a reason's
payload). The JSDoc is the only documentation: Core carries no descriptions at run time. The tags are
TSDoc-compatible; the custom ones are declared in \`tsdoc.json\`.

| Tag | Applies to | Meaning |
| --- | --- | --- |
| summary (first paragraph) | every member | What it is, for an author who has not read the code. |
| \`@remarks\` | every member | Longer explanation: rules, interplay with other members. |
| \`@format\` | strings | A named format (\`date\`, \`email\`, \`uri\`, ...). |
| \`@pattern\` | strings | A regular expression the value matches. |
| \`@minimum\`, \`@maximum\`, \`@exclusiveMinimum\`, \`@exclusiveMaximum\`, \`@multipleOf\` | numbers | Numeric bounds. |
| \`@minLength\`, \`@maxLength\` | strings | Length bounds. |
| \`@integer\` | numbers | The number is a whole number (written bare). |
| \`@minItems\`, \`@maxItems\` | arrays | Size bounds. |
| \`@uniqueItems\` | arrays | No two items are equal (written bare). |
| \`@minProperties\`, \`@maxProperties\` | dictionaries | Bounds on the number of keys. |
| \`@propertyNames\` | dictionaries | A regular expression every key matches. |
| \`@default\` | config properties | The value used when it is left out, as JSON. |
| \`@examples\` | any value | A JSON array of example values. |
| \`@widgetRef A | B\` | strings | The value is the id of a widget of one of these types. |
| \`@param name - text\`, \`@returns\` | Methods | Argument and result documentation. Every parameter needs one. |

Constraint tags (${CONSTRAINT_TAGS.map(tag => `\`@${tag}\``)
	.join(', ')}) become keywords in the full JSON Schema and prose
in the LLM schema. A string or number tag (\`@pattern\`, \`@format\`, the length and numeric bounds, \`@integer\`) on an
array or a dictionary applies to each item or value. They document; \`config.validate\` and the State and Method validators enforce. The standard
TSDoc tags (\`@see\`, \`@example\`, \`@deprecated\`, \`@throws\`, \`@defaultValue\`, \`@typeParam\`, \`@internal\`, \`@beta\`, ...)
are accepted and not interpreted. Any other tag fails \`widget-skills --check\`.
`

const PLUGIN_AUTHORING = `# Writing a Widget plugin

A plugin is built with \`createWidgetPlugin(type)\` from \`@deviltea/widget-core\` and describes one widget type:
its config, slots, State, Properties, Methods, Events and diagnostic reasons. Core compiles authored JSON against
the registered plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

This skill describes the API of the \`@deviltea/widget-core\` 0.3 line. Check the package's own documentation when
the installed version differs.

## 1. Declare the Interfaces first, with JSDoc

The \`Interfaces\` type and its JSDoc are the single source of the plugin's shape and documentation. Core stores no
descriptions and no schema: documentation and JSON Schema are generated from the types.

\`\`\`text
/** A counter. */
export interface CounterInterfaces {
	/** How the counter counts. */
	config: {
		raw: {
			/**
			 * How much one step adds.
			 * @minimum 1
			 * @default 1
			 */
			step?: number
		} | null
		resolved: { step: number }
	}
	slots: {
		/** Labels shown next to the count. */
		labels: 'Label' | 'Icon'
	}
	state: {
		/** The current count. */
		count: number
	}
	methods: {
		/**
		 * Adds one step.
		 * @returns The new count.
		 */
		increment: () => number
	}
	events: {
		/** The count changed. */
		changed: [count: number]
	}
	reasons: {
		/** The step is not a positive number. */
		'invalid-step': { received: unknown }
		/** The count reached its limit. */
		'at-limit': void
	}
}
\`\`\`

- A capability exists only when its key is a required property of the Interfaces type. Leave a key out to not
  have the capability; \`slots: never\` is the explicit "declared, empty" spelling.
- \`config.raw\` is what the author writes; include \`null\` when the config may be left out (an omitted config is
  validated as \`null\`). \`config.resolved\` is what the plugin and its renderer read.
- \`slots\` is a record: each key is a slot name and each value what the slot expects of its children: a union of
  plugin \`type\` literals (\`'Label' | 'Icon'\`), \`WidgetContract<Shape>\` (any widget that has the members of
  \`Shape\`), \`WidgetContract<Shape, 'Label' | 'Icon'>\` (the named types, each of which must have them), or
  \`WidgetChild\` (any widget). The expectation is type-level only: Core checks nothing at run time, so enforce it in
  the slot's \`validateStructure\` when it matters.
- \`reasons\` lists the diagnostic reasons the plugin reports. Each value is the type of the diagnostic's
  \`details\` (\`void\` for none); \`details\` must be a JSON value.
- Label Event payload tuples (\`[count: number]\`) and name Method parameters: the names are documentation.

## 2. Builder phases, in this order

\`interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done\`

- A phase can be skipped but not reordered. Section builders are sealed and capture definitions by value; a
  malformed declaration throws a \`TypeError\` naming plugin, section, member and field when the plugin is built.
- \`.config({ validate, resolve })\`: \`validate\` always runs and reports problems with
  \`ctx.addDiagnostic({ message, path, reason, details })\`; \`resolve\` turns the raw config into the resolved one
  (and is called with \`null\` when validation failed).
- \`.slots({ name: { validateStructure? } })\`: one complete map, every declared slot present (\`{}\` when it has no
  validator).
- \`.structure(validateStructure)\`: the plugin-level structure check. It is not a capability.
- \`.state\`: each member has \`validate\` and \`default\`. \`authorWritable: true\` is passive metadata telling editors
  the value may be set by an author.
- \`.properties\`: \`registerDeps\` declares what \`compute\` reads; \`compute\` is pure. In a plugin with slots,
  \`registerDeps\` gets \`slot(name)\`: the resolved children of the widget's own slot, each a dependency target. A
  \`WidgetContract\` slot types their reads by its \`Shape\`; other slots give untyped reads (refine with
  \`.validate()\`).
- \`.methods\`: \`validateArgs\`, \`registerDeps\`, \`emits\` (the Events it may emit, required when it emits), \`execute\`.
- \`.events(['changed'])\`: the list of every Event name of the Interfaces, each exactly once. Events are declared
  after the Methods; \`emits\` names are validated against them in \`done()\`.

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
\`--check\`: it fails on a member without JSDoc, an unknown tag, or a name the types and the runtime disagree on.

See \`references/jsdoc-tags.md\` for the tag set and \`references/example-interfaces.md\` for this System's Interfaces.
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

A config value that names another widget holds that widget's \`id\` (documented with \`@widgetRef\` in the type's
reference). The id must exist in the same document and be of a listed type.

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
	files[`${authoringPlugin}/SKILL.md`] = `${frontmatter('widget-plugin-authoring', 'Write a @deviltea/widget-core plugin: the Interfaces type, builder phases, synchronous callbacks, diagnostics, why a failing Method is not rolled back, read-only Methods, async at the host, and the JSDoc tag set.')}\n${PLUGIN_AUTHORING}`
	files[`${authoringPlugin}/references/jsdoc-tags.md`] = `# JSDoc tags\n\n${TAG_SPEC}`
	files[`${authoringPlugin}/references/example-interfaces.md`] = `# Interfaces of ${ir.system}\n\nRead from the types; the member documentation is whatever JSDoc the Interfaces carry today.\n\n${ir.plugins.map(plugin => `## ${plugin.type}${plugin.interfacesName === null ? '' : ` (\`${plugin.interfacesName}\`)`}\n\n${fence(TYPE_FENCE, [
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
