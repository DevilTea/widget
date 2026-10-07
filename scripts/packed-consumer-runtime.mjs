import {
	createWidgetDocument,
	createWidgetPlugin,
	createWidgetSystem,
} from '@deviltea/widget-core'
import {
	inspectBlueprint,
	inspectRuntime,
} from '@deviltea/widget-core/inspection'
import { getWidgetEventEmitter } from '@deviltea/widget-core/integration'
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

const exportedFunctions = [
	['@deviltea/widget-core:createWidgetDocument', createWidgetDocument],
	['@deviltea/widget-core:createWidgetPlugin', createWidgetPlugin],
	['@deviltea/widget-core:createWidgetSystem', createWidgetSystem],
	['@deviltea/widget-core/inspection:inspectBlueprint', inspectBlueprint],
	['@deviltea/widget-core/inspection:inspectRuntime', inspectRuntime],
	['@deviltea/widget-core/integration:getWidgetEventEmitter', getWidgetEventEmitter],
	['@deviltea/widget-inspector/agent:createInspectorAgent', createInspectorAgent],
	['@deviltea/widget-inspector/anchor:inspectAnchorAttributes', inspectAnchorAttributes],
	['@deviltea/widget-inspector/channel:createMessagePortChannelHub', createMessagePortChannelHub],
	['@deviltea/widget-inspector/client:createInspectorClient', createInspectorClient],
	['@deviltea/widget-inspector/frame-bootstrap:createInspectorFrameBootstrapRequest', createInspectorFrameBootstrapRequest],
	['@deviltea/widget-inspector/transport:createInProcessInspectorTransportPair', createInProcessInspectorTransportPair],
	['@deviltea/widget-inspector/value:encodeInspectableValue', encodeInspectableValue],
	['@deviltea/widget-vue:createWidgetVueRenderer', createWidgetVueRenderer],
	['@deviltea/widget-vue:useWidget', useWidget],
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
	.description('Packed smoke widget')
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

console.log(`Packed runtime smoke passed for ${exportedFunctions.length} named exports across all public subpaths.`)
