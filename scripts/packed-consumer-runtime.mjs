import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import {
	createWidgetDocument,
	createWidgetPlugin,
	createWidgetSystem,
	undocumented,
} from '@deviltea/widget-core'
import {
	inspectBlueprint,
	inspectRuntime,
} from '@deviltea/widget-core/inspection'
import { getWidgetEventEmitter } from '@deviltea/widget-core/integration'
import { WIDGET_DOCS_VERSION } from '@deviltea/widget-docs-generator/docs'
import { createFlatConverter, FlatConversionError } from '@deviltea/widget-docs-generator/runtime'
import { widgetDocs } from '@deviltea/widget-docs-generator/vite'
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { inspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import { createMessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInspectorFrameBootstrapRequest } from '@deviltea/widget-inspector/frame-bootstrap'
import { INSPECTOR_PROTOCOL_VERSION } from '@deviltea/widget-inspector/protocol'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'
import { encodeInspectableValue } from '@deviltea/widget-inspector/value'
import {
	createWidgetVueRenderer,
	useWidget,
} from '@deviltea/widget-vue'
import { createWidgetTestHost } from '@deviltea/widget-vue/testing'

const exportedFunctions = [
	['@deviltea/widget-core:createWidgetDocument', createWidgetDocument],
	['@deviltea/widget-core:createWidgetPlugin', createWidgetPlugin],
	['@deviltea/widget-core:createWidgetSystem', createWidgetSystem],
	['@deviltea/widget-core/inspection:inspectBlueprint', inspectBlueprint],
	['@deviltea/widget-core/inspection:inspectRuntime', inspectRuntime],
	['@deviltea/widget-core/integration:getWidgetEventEmitter', getWidgetEventEmitter],
	['@deviltea/widget-docs-generator/runtime:createFlatConverter', createFlatConverter],
	['@deviltea/widget-docs-generator/runtime:FlatConversionError', FlatConversionError],
	['@deviltea/widget-docs-generator/vite:widgetDocs', widgetDocs],
	['@deviltea/widget-inspector/agent:createInspectorAgent', createInspectorAgent],
	['@deviltea/widget-inspector/anchor:inspectAnchorAttributes', inspectAnchorAttributes],
	['@deviltea/widget-inspector/channel:createMessagePortChannelHub', createMessagePortChannelHub],
	['@deviltea/widget-inspector/client:createInspectorClient', createInspectorClient],
	['@deviltea/widget-inspector/frame-bootstrap:createInspectorFrameBootstrapRequest', createInspectorFrameBootstrapRequest],
	['@deviltea/widget-inspector/transport:createInProcessInspectorTransportPair', createInProcessInspectorTransportPair],
	['@deviltea/widget-inspector/value:encodeInspectableValue', encodeInspectableValue],
	['@deviltea/widget-vue:createWidgetVueRenderer', createWidgetVueRenderer],
	['@deviltea/widget-vue:useWidget', useWidget],
	['@deviltea/widget-vue/testing:createWidgetTestHost', createWidgetTestHost],
]

for (const [name, exported] of exportedFunctions) {
	if (typeof exported !== 'function')
		throw new TypeError(`Expected ${name} to be a function, got ${typeof exported}.`)
}

if (typeof INSPECTOR_PROTOCOL_VERSION.minor !== 'number')
	throw new TypeError('Expected @deviltea/widget-inspector/protocol to export INSPECTOR_PROTOCOL_VERSION.')

const anchor = inspectAnchorAttributes({ widgetId: 'root', widgetType: 'Packed' })
if (anchor['data-widget-id'] !== 'root' || anchor['data-widget-type'] !== 'Packed')
	throw new Error('Packed inspectAnchorAttributes returned unexpected attributes.')

// The installed Inspector must accept a Runtime built by the installed Core peer: a bundled second
// Core copy would make `inspectRuntime` reject it as foreign.
const system = createWidgetSystem({ plugins: [createWidgetPlugin('Packed')
	.description(undocumented)
	.interfaces()
	.done()] })
const blueprint = system.createBlueprint({ id: 'root', type: 'Packed' })
if (blueprint.status !== 'valid')
	throw new Error('Packed smoke Blueprint did not compile.')
const pair = createInProcessInspectorTransportPair()
const agent = createInspectorAgent({ runtime: blueprint.createRuntime(), transport: pair.agent, runtimeId: 'packed' })
const client = createInspectorClient(pair.client)
try {
	const handshake = await client.handshake()
	if (handshake.protocol.minor !== INSPECTOR_PROTOCOL_VERSION.minor)
		throw new Error('Packed Inspector handshake negotiated an unexpected protocol minor.')
	const { runtimes } = await client.request('runtime.list', {})
	if (runtimes.length !== 1 || runtimes[0].runtimeId !== 'packed')
		throw new Error('Packed Inspector did not list the host Runtime.')
}
finally {
	client.dispose()
	agent.dispose()
}

if (WIDGET_DOCS_VERSION !== 2)
	throw new Error(`Expected @deviltea/widget-docs-generator/docs to export WIDGET_DOCS_VERSION 2, got ${WIDGET_DOCS_VERSION}.`)

// The generator's bin, run as an installed bin (its shebang, on this Node), against a System module written here. It
// imports the System through tsx in a worker thread (`dist/runtime-worker.mjs`), reads its `plugin.docs`, and compiles
// the `--example` document with the consumer's Core before writing anything.
const scratch = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), 'docs-generator-'))
try {
	const project = join(scratch, 'project')
	mkdirSync(project)
	// ESM, so that tsx's namespace loads it; Core resolves from the consumer's `node_modules` above.
	writeFileSync(join(project, 'package.json'), '{ "type": "module" }\n')
	writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, types: [] }, include: ['./*.ts'] }))
	writeFileSync(join(project, 'system.ts'), [
		'import { createWidgetPlugin, createWidgetSystem } from \'@deviltea/widget-core\'',
		'',
		'interface BadgeInterfaces { state: { count: number } }',
		'const badge = createWidgetPlugin(\'Badge\')',
		'\t.description(\'A badge.\')',
		'\t.interfaces<BadgeInterfaces>()',
		'\t.state(state => state.count({ description: \'The count.\', validate: (input): input is number => typeof input === \'number\', default: () => 0 }))',
		'\t.done()',
		'',
		'interface PanelInterfaces { slots: { items: \'Badge\' } }',
		'const panel = createWidgetPlugin(\'Panel\')',
		'\t.description(\'A panel of badges.\')',
		'\t.interfaces<PanelInterfaces>()',
		'\t.slots({ items: { description: \'The badges.\' } })',
		'\t.done()',
		'',
		'export const system = createWidgetSystem({ plugins: [panel, badge] as const })',
		'',
	].join('\n'))
	const example = { id: 'root', type: 'Panel', slots: { items: [{ id: 'first', type: 'Badge' }, { id: 'second', type: 'Badge' }] } }
	writeFileSync(join(project, 'example.json'), `${JSON.stringify(example)}\n`)

	const bin = fileURLToPath(new URL('./node_modules/.bin/widget-docs-generator', import.meta.url))
	const run = args => spawnSync(bin, ['--module', join(project, 'system.ts'), '--export', 'system', '--tsconfig', join(project, 'tsconfig.json'), ...args], { cwd: project, encoding: 'utf8', timeout: 120_000 })

	const check = run(['--check'])
	if (check.error !== undefined || check.status !== 0 || check.stdout !== '4/4 descriptions documented, 0 error(s), 0 warning(s).\n')
		throw new Error(`widget-docs-generator --check failed (${check.error ?? `exit ${check.status}`}):\n${check.stdout}${check.stderr}`)

	const out = join(scratch, 'out')
	const generate = run(['--example', join(project, 'example.json'), '--out', out])
	if (generate.error !== undefined || generate.status !== 0 || generate.stderr !== '')
		throw new Error(`widget-docs-generator --out failed (${generate.error ?? `exit ${generate.status}`}):\n${generate.stdout}${generate.stderr}`)
	const written = JSON.parse(readFileSync(join(out, '.generated.json'), 'utf8')).files
	for (const file of ['ir.json', 'schema/document.schema.json', 'schema/document.llm.schema.json']) {
		if (!written.includes(file))
			throw new Error(`widget-docs-generator did not write ${file}; it wrote: ${written.join(', ')}`)
	}
	const ir = JSON.parse(readFileSync(join(out, 'ir.json'), 'utf8'))
	if (ir.plugins.find(plugin => plugin.type === 'Panel')?.doc?.summary !== 'A panel of badges.')
		throw new Error('The generated ir.json does not carry the prose read from plugin.docs.')

	// `./runtime` with the IR the bin wrote: a model's flat node list back to the document tree, and the way there.
	const { treeToFlat, flatToTree } = createFlatConverter(ir)
	const flat = { nodes: [{ id: 'root', type: 'Panel' }, { id: 'first', type: 'Badge', parent: 'root', slot: 'items' }, { id: 'second', type: 'Badge', parent: 'root', slot: 'items' }] }
	if (!isDeepStrictEqual(flatToTree(flat), example))
		throw new Error(`flatToTree returned ${JSON.stringify(flatToTree(flat))}`)
	if (!isDeepStrictEqual(flatToTree(treeToFlat(example)), example))
		throw new Error('treeToFlat and flatToTree do not round-trip the example.')
	let rejected = false
	try {
		flatToTree({ nodes: [] })
	}
	catch (error) {
		rejected = error instanceof FlatConversionError
	}
	if (!rejected)
		throw new Error('flatToTree accepted a document without a root.')
}
finally {
	rmSync(scratch, { recursive: true, force: true })
}

console.log(`Packed runtime smoke passed for ${exportedFunctions.length} named exports across all public subpaths, and the generator's bin and ./runtime work on Node ${process.versions.node}.`)
