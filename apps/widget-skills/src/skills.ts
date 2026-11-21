/**
 * The three Markdown skills (Agent Skills layout: `SKILL.md` with `name`/`description` frontmatter, plus
 * `references/`). `source-json-authoring` and `renderer-implementation` are generated from the IR;
 * `plugin-authoring` is generic to `@deviltea/widget-core` and only quotes the System for examples.
 */

import type { Doc, PluginIr, SystemIr } from './ir'
import { CONSTRAINT_TAGS } from './ir'

function kebab(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[^a-z0-9]+/gi, '-')
		.toLowerCase()
}

function frontmatter(name: string, description: string): string {
	return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n`
}

function prose(doc: Doc, fallback: string | null = null): string {
	const text = [doc.summary, doc.remarks].filter(part => part !== '')
		.join('\n\n')
	return text !== '' ? text : fallback ?? '_Not documented._'
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

/** The named types `shape` mentions, transitively, in a stable order. */
function configTypeNames(ir: SystemIr, plugin: PluginIr): string[] {
	const seen = new Set<string>()
	const visit = (shape: import('./ir').Shape): void => {
		if (shape.kind === 'ref') {
			if (seen.has(shape.name) || ir.types[shape.name] === undefined)
				return
			seen.add(shape.name)
			visit(ir.types[shape.name]!.shape)
		}
		else if (shape.kind === 'array') {
			visit(shape.items)
		}
		else if (shape.kind === 'record') {
			visit(shape.value)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(visit)
		}
		else if (shape.kind === 'object') {
			shape.properties.forEach(property => visit(property.shape))
		}
	}
	if (plugin.config !== null)
		visit(plugin.config.rawShape)
	return [...seen]
}

function slotList(plugin: PluginIr): string {
	if (plugin.slots.length === 0)
		return 'No slots: this widget cannot have children.'
	return plugin.slots.map(slot => `- \`${slot.name}\`${slot.expected === null
		? ''
		: ` (expects ${slot.expected.map(type => `\`${type}\``)
			.join(', ')})`}: ${prose(slot.doc, slot.runtimeDescription)}`)
		.join('\n')
}

function authoringReference(ir: SystemIr, plugin: PluginIr): string {
	const lines = [`# ${plugin.type}`, '', prose(plugin.doc, plugin.runtimeDescription), '', '## Config', '']
	if (plugin.config === null) {
		lines.push('This type takes no config. Leave `config` out.')
	}
	else {
		lines.push(plugin.config.runtimeDescription ?? '', '', plugin.config.omittable ? '`config` may be left out.' : '`config` is required.', '', `Raw config type: \`${plugin.config.rawText}\``, '', fence(TYPE_FENCE, typeExcerpt(ir, configTypeNames(ir, plugin)) || `type Config = ${plugin.config.rawText}`))
	}
	lines.push('', '## Slots', '', slotList(plugin))
	if (plugin.reasons !== null && plugin.reasons.length > 0)
		lines.push('', '## Diagnostic reasons', '', ...plugin.reasons.map(reason => `- \`${reason.name}\` (payload \`${reason.payloadText}\`): ${prose(reason.doc)}`))
	return `${lines.join('\n')}\n`
}

function rendererReference(ir: SystemIr, plugin: PluginIr): string {
	const lines = [`# ${plugin.type} renderer`, '', prose(plugin.doc, plugin.runtimeDescription), '']
	lines.push('## Config (resolved)', '', plugin.config === null ? 'No config: `config` is not on the surface.' : `\`config\` is the resolved config: \`${plugin.config.resolvedText}\`.`, '')
	lines.push('## State', '', plugin.state.length === 0
		? 'No State.'
		: ['| Name | Type | authorWritable | Description |', '| --- | --- | --- | --- |', ...plugin.state.map(member => `| \`${member.name}\` | \`${member.typeText.replaceAll('|', '\\|')}\` | ${member.authorWritable === null ? 'unknown' : String(member.authorWritable)} | ${prose(member.doc)
				.replaceAll('\n', ' ')}${tagLines(member.doc)} |`)].join('\n'), '')
	lines.push('## Properties (read-only, computed)', '', plugin.properties.length === 0
		? 'No Properties.'
		: ['| Name | Type | Description |', '| --- | --- | --- |', ...plugin.properties.map(member => `| \`${member.name}\` | \`${member.typeText.replaceAll('|', '\\|')}\` | ${prose(member.doc)
				.replaceAll('\n', ' ')} |`)].join('\n'), '')
	lines.push('## Methods', '')
	if (plugin.methods.length === 0)
		lines.push('No Methods.')
	for (const method of plugin.methods) {
		lines.push(`### \`${method.signature}\``, '', prose(method.doc))
		for (const param of method.params)
			lines.push(`- \`${param.name}${param.optional ? '?' : ''}: ${param.typeText}\`${param.doc === '' ? '' : `: ${param.doc}`}`)
		lines.push(`- Returns \`${method.returnText}\`${method.returnsDoc === '' ? '' : `: ${method.returnsDoc}`}`, '')
	}
	lines.push('## Events', '', plugin.events.length === 0
		? 'No Events.'
		: plugin.events.map(event => `- \`${event.name}(${event.payload.map(item => `${item.label ?? 'arg'}: ${item.typeText}`)
				.join(', ')})\`: ${prose(event.doc, event.runtimeDescription)}`)
				.join('\n'), '')
	lines.push('## Slots', '', plugin.slots.length === 0 ? 'No slots: `WidgetSlot` is not on the surface.' : `${slotList(plugin)}\n\nRender each with \`<WidgetSlot name="...">\` from this widget's \`useWidget()\` result.`, '')
	const excerpt = typeExcerpt(ir, plugin.typeNames)
	if (excerpt !== '')
		lines.push('## Referenced types', '', fence(TYPE_FENCE, excerpt), '')
	return lines.join('\n')
}

const TAG_SPEC = `## JSDoc tag set

The \`XxxInterfaces\` type and its JSDoc are the single source of a plugin's shape and documentation. Every member
(config property, State, Property, Method, Event, slot, reason) needs a summary. The tags are TSDoc-compatible;
the custom ones are declared in \`tsdoc.json\`.

| Tag | Applies to | Meaning |
| --- | --- | --- |
| summary (first paragraph) | every member | What it is, for an author who has not read the code. |
| \`@remarks\` | every member | Longer explanation: rules, interplay with other members. |
| \`@format\` | strings | A named format (\`date\`, \`email\`, \`uri\`, ...). |
| \`@pattern\` | strings | A regular expression the value matches. |
| \`@minimum\`, \`@maximum\`, \`@exclusiveMinimum\`, \`@exclusiveMaximum\`, \`@multipleOf\` | numbers | Numeric bounds. |
| \`@minLength\`, \`@maxLength\` | strings | Length bounds. |
| \`@minItems\`, \`@maxItems\` | arrays | Size bounds. |
| \`@default\` | config properties | The value used when it is left out, as JSON. |
| \`@examples\` | any value | A JSON array of example values. |
| \`@widgetRef A | B\` | strings | The value is the id of a widget of one of these types. |
| \`@param name - text\`, \`@returns\` | Methods | Argument and result documentation. |

Constraint tags (${CONSTRAINT_TAGS.map(tag => `\`@${tag}\``)
	.join(', ')}) become keywords in the full JSON Schema and prose
in the LLM schema. They document; \`config.validate\` and the State/Method validators enforce. Any other tag fails
\`widget-skills --check\`.
`

const PLUGIN_AUTHORING = `# Writing a Widget plugin

A plugin is built with \`createWidgetPlugin(type)\` from \`@deviltea/widget-core\` and describes one widget type:
its config, slots, State, Properties, Methods and Events. Core compiles authored JSON against the registered
plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

## 1. Declare the Interfaces first

\`\`\`text
export interface CounterInterfaces extends WidgetInterfaces {
	config: { raw: CounterRawConfig | null, resolved: CounterConfig }
	state: {
		/** The current count. */
		count: number
	}
	methods: {
		/**
		 * Adds to the count.
		 * @param by - How much to add.
		 * @returns The new count.
		 */
		increment: (by: number) => number
	}
	events: {
		/** The count changed. */
		changed: [count: number]
	}
}
\`\`\`

- A capability exists only when its key is a required property of the Interfaces type. Leave a key out to not
  have the capability; \`slots: never\` is the explicit "declared, empty" spelling.
- \`config.raw\` is what the author writes; include \`null\` when the config may be left out. \`config.resolved\`
  is what the plugin and its renderer read.
- Label Event payload tuples (\`[count: number]\`) and name Method parameters: the names are documentation.

## 2. Builder phases, in this order

\`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done\`

- A phase can be skipped but not reordered. Section builders are sealed and capture definitions by value; a
  malformed declaration throws a \`TypeError\` naming plugin, section, member and field when the plugin is built.
- \`.config({ validate, resolve, schema?, description? })\`: \`validate\` always runs (an omitted config is
  validated as \`null\`) and reports problems with \`ctx.addDiagnostic({ message, path, reason })\`.
- \`.slots({ name: { validateStructure? } })\` and \`.structure(validateStructure)\` check children and placement.
  \`.structure\` is not a capability.
- \`.state\`: each member has \`validate\` and \`default\`. \`authorWritable: true\` is passive metadata telling editors
  the value may be set by an author.
- \`.properties\`: \`registerDeps\` declares what \`compute\` reads; \`compute\` is pure.
- \`.methods\`: \`validateArgs\`, \`registerDeps\`, \`emits\` (the Events it may emit, required when it emits), \`execute\`.
- \`.events\`: declared after the Methods; \`emits\` names are validated against them in \`done()\`.

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

- Config and structure problems are Blueprint diagnostics with a \`path\` and a machine-readable \`reason\`.
- A refused Method call adds a diagnostic with \`addDiagnostic({ message, reason })\`, writes nothing and emits
  nothing. Refused input is ordinary, not exceptional.
- When 0.3.0 lands, declare the reasons in the Interfaces as \`reasons: { reasonName: Payload }\` with JSDoc.

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
plugin. An application loads exactly one Core instance; a plugin library declares Core as a peer dependency.
Run \`widget-skills --check\` on the System: it fails on a member without JSDoc, an unknown tag, or a name the
types and the runtime disagree on.

See \`references/jsdoc-tags.md\` for the tag set and \`references/example-interfaces.md\` for this System's Interfaces.
`

export function emitSkills(ir: SystemIr, schemas: { fullSchema: string, llmSchema: string }): Record<string, string> {
	const files: Record<string, string> = {}
	const system = kebab(ir.system)
	const typeList = ir.plugins.map(plugin => `- \`${plugin.type}\`: ${prose(plugin.doc, plugin.runtimeDescription)
		.split('\n')[0]} See \`references/${kebab(plugin.type)}.md\`.`)
		.join('\n')
	const rootCandidates = ir.plugins.filter(plugin => !ir.plugins.some(parent => parent.slots.some(slot => slot.expected?.includes(plugin.type))))

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
- \`meta\`: reserved for tools; do not write it.

${fence('json', JSON.stringify({ id: 'root', type: ir.plugins[0]?.type ?? 'Type', config: {}, slots: ir.plugins[0]?.slots[0] === undefined ? undefined : { [ir.plugins[0].slots[0].name]: [] } }, null, 2))}

## Types

${typeList}

${rootCandidates.length > 0 && rootCandidates.length < ir.plugins.length
	? `Types no slot names as a child (root candidates): ${rootCandidates.map(plugin => `\`${plugin.type}\``)
		.join(', ')}.\n`
	: ''}
## References between widgets

A config value that names another widget holds that widget's \`id\` (documented with \`@widgetRef\` in the type's
reference). The id must exist in the same document and be of a listed type.

## Structured output: the flat node list

When the output must follow a JSON Schema (tool input, structured output), use
\`references/document.llm.schema.json\` instead of the tree:

- \`{ "nodes": [{ "id", "type", "parent", "slot", "config" }] }\`; exactly one node has no \`parent\` and no
  \`slot\` (the root).
- Children of one slot keep the order they have in \`nodes\`; list parents before children.
- Leave an optional key out; do not write \`null\` for it. Leave \`config\` out when the type takes none.
- \`slots\` (a list of slot names) is only needed to declare a slot that has no children.
- The schema is meant for non-strict structured output: it gets the structure roughly right, no more.
- A dictionary (for example text per language) is a list of \`{ "key", "value" }\` entries.
- Limits (ranges, lengths, formats) are in the descriptions, not in schema keywords: read them.

\`flatToTree\` from \`@deviltea/widget-skills\` converts the list back to the tree deterministically (\`treeToFlat\`
is the inverse). \`references/document.schema.json\` is the full schema of the tree form.

## Validate and repair

The schemas only get the structure roughly right. The arbiter is the compiler:

1. \`const blueprint = system.createBlueprint(tree)\` (or \`createBlueprintFromJson(text)\`).
2. \`blueprint.status\` is \`'valid'\` or \`'invalid'\`; \`blueprint.diagnostics\` lists every problem.
3. Each diagnostic has a \`code\` (for example \`invalid-widget-config\`, \`invalid-widget-structure\`,
   \`unexpected-widget-field\`, \`duplicate-widget-id\`), a \`message\`, a location naming the widget, and for config
   problems a \`path\` into the config and a machine-readable \`reason\`.
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
	files[`${renderer}/SKILL.md`] = `${frontmatter(`${system}-renderer-implementation`, `Implement Vue renderers for the ${ir.system} widget types with @deviltea/widget-vue: the useWidget() surface, and each type's State, Properties, Methods, Events and slots.`)}
# Implementing ${ir.system} renderers

A renderer is a Vue component registered for one widget type. In its \`setup()\` it calls
\`useWidget(Plugin)\` from \`@deviltea/widget-vue\` with the exact plugin object (it is the type witness and a
runtime identity check; calling it outside a registered renderer throws \`WidgetVueIntegrationError\`).

## The \`useWidget()\` surface

Only the accessors of the capabilities the plugin declares are present.

| Accessor | Present when | What it gives |
| --- | --- | --- |
| \`config\` | config | The resolved config, deeply read-only (never the raw one). |
| \`useState()\` | state | One writable ref per State member. Writing runs the member's \`validate\`; a rejected write is a diagnostic, not a throw. |
| \`useProperties()\` | properties | One read-only ref per Property. Lazy: a Property is computed when first read. |
| \`useMethods()\` | methods | One function per Method. It returns an execution result (\`{ ok: true, value }\` or \`{ ok: false, ... }\`); a refused call writes nothing and emits nothing. |
| \`emit\` | events | The typed Event emitter. Prefer letting Methods emit. |
| \`widgetId\`, \`widgetType\` | always | The identity of the widget being rendered. |
| \`useStateDiagnostics()\`, \`usePropertyDiagnostics()\`, \`useMethodDiagnostics()\` | the capability | One diagnostics ref per member: show why a write or call was refused. |
| \`useDiagnostics()\` | always | The widget's own diagnostics. |
| \`WidgetSlot\` | slots | The component that renders a slot's children with their registered renderers. |

The accessor names above are read from \`UseWidgetResult\` in \`packages/vue/src/types.ts\`; check that file for the
exact member types (refs, execution results, the \`WidgetSlot\` scope: \`Child\`, \`id\`, \`type\`, \`index\`).

## Rules

- A renderer displays State and Properties and calls Methods. It does not keep a second copy of widget state.
- \`authorWritable\` State is meant to be set by an author or editor; other State is changed through Methods.
- Methods are synchronous. Async work belongs to the host: listen to the Event, wait, then call a Method.
- Never stamp DOM attributes for the Inspector by hand.

## Types

${ir.plugins.map(plugin => `- \`${plugin.type}\`: \`references/${kebab(plugin.type)}.md\``)
	.join('\n')}
`
	for (const plugin of ir.plugins)
		files[`${renderer}/references/${kebab(plugin.type)}.md`] = rendererReference(ir, plugin)

	// --- plugin-authoring ----------------------------------------------------------------------------
	const authoringPlugin = 'skills/widget-plugin-authoring'
	files[`${authoringPlugin}/SKILL.md`] = `${frontmatter('widget-plugin-authoring', 'Write a @deviltea/widget-core plugin: Interfaces as the single source of shape and documentation, builder phases, synchronous callbacks, diagnostics, read-only Methods, async at the host, and the JSDoc tag set.')}\n${PLUGIN_AUTHORING}`
	files[`${authoringPlugin}/references/jsdoc-tags.md`] = `# JSDoc tags\n\n${TAG_SPEC}`
	files[`${authoringPlugin}/references/example-interfaces.md`] = `# Interfaces of ${ir.system}\n\nRead from the types; the member documentation is whatever JSDoc the Interfaces carry today.\n\n${ir.plugins.map(plugin => `## ${plugin.type}${plugin.interfacesName === null ? '' : ` (\`${plugin.interfacesName}\`)`}\n\n${fence(TYPE_FENCE, [
		plugin.config === null ? '' : `config: { raw: ${plugin.config.rawText}, resolved: ${plugin.config.resolvedText} }`,
		plugin.slots.length === 0
			? ''
			: `slots: ${plugin.slotForm === 'record'
				? `{ ${plugin.slots.map(slot => `${slot.name}: ${slot.expected?.map(type => `'${type}'`)
					.join(' | ') ?? 'unknown'}`)
					.join(', ')} }`
				: plugin.slots.map(slot => `'${slot.name}'`)
						.join(' | ')}`,
		...plugin.state.map(member => `state.${member.name}: ${member.typeText}`),
		...plugin.properties.map(member => `properties.${member.name}: ${member.typeText}`),
		...plugin.methods.map(member => `methods.${member.signature}`),
		...plugin.events.map(event => `events.${event.name}: [${event.payload.map(item => `${item.label ?? 'arg'}: ${item.typeText}`)
			.join(', ')}]`),
	].filter(line => line !== '')
		.join('\n'))}`)
		.join('\n\n')}\n`
	return files
}
