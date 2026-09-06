export const INSPECTOR_FRAME_BOOTSTRAP_TYPE = '@deviltea/widget-devtools/frame-bootstrap'
export const INSPECTOR_FRAME_BOOTSTRAP_VERSION = 1

export interface InspectorFrameBootstrapRequest {
	readonly type: typeof INSPECTOR_FRAME_BOOTSTRAP_TYPE
	readonly version: typeof INSPECTOR_FRAME_BOOTSTRAP_VERSION
	readonly sessionId: string
	readonly generation: number
}

export interface InspectorFrameBootstrapAcceptance {
	readonly request: InspectorFrameBootstrapRequest
	readonly port: MessagePort
}

export interface AcceptInspectorFrameBootstrapOptions {
	readonly expectedSource: MessageEventSource
	readonly expectedOrigin: string
	readonly sessionId: string
	readonly expectedGeneration: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createInspectorFrameBootstrapRequest(
	sessionId: string,
	generation: number,
): InspectorFrameBootstrapRequest {
	if (sessionId.length === 0)
		throw new TypeError('Inspector frame bootstrap sessionId must not be empty.')
	if (!Number.isSafeInteger(generation) || generation < 0)
		throw new TypeError('Inspector frame bootstrap generation must be a non-negative safe integer.')
	return {
		type: INSPECTOR_FRAME_BOOTSTRAP_TYPE,
		version: INSPECTOR_FRAME_BOOTSTRAP_VERSION,
		sessionId,
		generation,
	}
}

export function parseInspectorFrameBootstrapRequest(value: unknown): InspectorFrameBootstrapRequest | null {
	if (!isRecord(value)
		|| value.type !== INSPECTOR_FRAME_BOOTSTRAP_TYPE
		|| value.version !== INSPECTOR_FRAME_BOOTSTRAP_VERSION
		|| typeof value.sessionId !== 'string'
		|| value.sessionId.length === 0
		|| typeof value.generation !== 'number'
		|| !Number.isSafeInteger(value.generation)
		|| value.generation < 0) {
		return null
	}
	return {
		type: INSPECTOR_FRAME_BOOTSTRAP_TYPE,
		version: INSPECTOR_FRAME_BOOTSTRAP_VERSION,
		sessionId: value.sessionId,
		generation: value.generation,
	}
}

/**
 * Validate the one global-window message used to bootstrap a dedicated frame channel.
 * Ordinary Inspector traffic must continue only on the returned MessagePort.
 */
export function acceptInspectorFrameBootstrap(
	event: MessageEvent<unknown>,
	options: AcceptInspectorFrameBootstrapOptions,
): InspectorFrameBootstrapAcceptance | null {
	if (event.source !== options.expectedSource || event.origin !== options.expectedOrigin)
		return null
	const request = parseInspectorFrameBootstrapRequest(event.data)
	if (request === null
		|| request.sessionId !== options.sessionId
		|| request.generation !== options.expectedGeneration
		|| event.ports.length !== 1) {
		return null
	}
	return { request, port: event.ports[0]! }
}
