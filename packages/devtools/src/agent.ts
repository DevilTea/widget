import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { InspectionNodeId, RuntimeWidgetInspection } from '@deviltea/widget-core/inspection'
import type {
	InspectorEventMap,
	InspectorEventName,
	InspectorProtocolError,
	InspectorRequestMessage,
	InspectorRequestMethod,
	WidgetRef,
} from './protocol'
import type { InspectorTransport } from './transport'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import {
	projectBlueprintSnapshot,
	projectRuntimeMemberSnapshot,
	projectRuntimeWidgetSnapshot,
} from './projection'
import {
	INSPECTOR_PROTOCOL_VERSION,
	isCompatibleProtocolVersion,
	parseInspectorRequestMessage,
} from './protocol'

const SUPPORTED_METHODS = Object.freeze([
	'handshake',
	'runtime.list',
	'blueprint.getSnapshot',
	'runtime.getWidgetSnapshot',
	'runtime.subscribeMember',
	'runtime.unsubscribeMember',
	'inspect.enable',
	'inspect.disable',
	'highlight.show',
	'highlight.clear',
] satisfies InspectorRequestMethod[])

const SUPPORTED_EVENTS = Object.freeze([
	'runtime.memberChanged',
	'inspect.hovered',
	'inspect.selected',
	'agent.status',
] satisfies InspectorEventName[])

let runtimeSequence = 1
let subscriptionSequence = 1

function createRuntimeId(): string {
	try {
		if (typeof globalThis.crypto?.randomUUID === 'function')
			return `runtime-${globalThis.crypto.randomUUID()}`
	}
	catch {
		// Fall through to a deterministic realm-local opaque identity.
	}
	return `runtime-${runtimeSequence++}`
}

interface DomAnchor {
	readonly element: Element
	readonly widgetId: string
	readonly widgetType: string
}

export interface InspectorAgentDomOptions {
	readonly root: HTMLElement
	readonly highlightClass?: string
	readonly badgeClass?: string
}

export interface CreateInspectorAgentOptions {
	readonly runtime: WidgetSystemRuntime
	readonly transport: InspectorTransport
	readonly runtimeId?: string
	readonly dom?: InspectorAgentDomOptions
	/** Keep a host-owned shared transport alive when replacing only this Agent/Runtime binding. */
	readonly closeTransportOnDispose?: boolean
}

export interface InspectorAgent {
	readonly runtimeId: string
	readonly inspectEnabled: boolean
	dispose: () => void
}

function protocolError(code: InspectorProtocolError['code'], message: string): InspectorProtocolError {
	return { code, message }
}

export function createInspectorAgent(options: CreateInspectorAgentOptions): InspectorAgent {
	const runtimeId = options.runtimeId ?? createRuntimeId()
	const runtimeInspection = inspectRuntime(options.runtime)
	const dom = options.dom
	const subscriptions = new Map<string, () => void>()
	let inspectEnabled = false
	let disposed = false
	let highlightedElement: Element | null = null
	let badgeElement: HTMLDivElement | null = null

	function emit<Event extends InspectorEventName>(event: Event, payload: InspectorEventMap[Event]): void {
		if (disposed || options.transport.closed)
			return
		options.transport.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event,
			payload,
		})
	}

	function sendSuccess(request: InspectorRequestMessage, result: unknown): void {
		if (disposed || options.transport.closed)
			return
		options.transport.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: request.requestId,
			ok: true,
			result,
		})
	}

	function sendError(requestId: string, error: InspectorProtocolError): void {
		if (disposed || options.transport.closed)
			return
		options.transport.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId,
			ok: false,
			error,
		})
	}

	function resolveNodeId(ref: WidgetRef): InspectionNodeId | null {
		if (ref.runtimeId !== runtimeId)
			return null
		return runtimeInspection.blueprint.nodes.find(node => node.nodeId === ref.nodeId)?.nodeId ?? null
	}

	function resolveWidget(ref: WidgetRef): RuntimeWidgetInspection | null {
		const nodeId = resolveNodeId(ref)
		return nodeId === null ? null : runtimeInspection.getWidget(nodeId)
	}

	function nodeForAnchor(anchor: Pick<DomAnchor, 'widgetId' | 'widgetType'>): WidgetRef | null {
		const node = runtimeInspection.blueprint.nodes.find(candidate => candidate.resolved
			&& candidate.node.id === anchor.widgetId
			&& candidate.node.type === anchor.widgetType)
		return node === undefined ? null : { runtimeId, nodeId: node.nodeId }
	}

	function resolveAnchor(target: EventTarget | null): DomAnchor | null {
		if (dom === undefined || !(target instanceof Element))
			return null
		const element = target.closest('[data-widget-id][data-widget-type]')
		if (element === null || !dom.root.contains(element))
			return null
		const widgetId = element.getAttribute('data-widget-id')
		const widgetType = element.getAttribute('data-widget-type')
		return widgetId === null || widgetType === null ? null : { element, widgetId, widgetType }
	}

	function ensureBadge(): HTMLDivElement | null {
		if (dom === undefined)
			return null
		if (badgeElement !== null)
			return badgeElement
		const badge = dom.root.ownerDocument.createElement('div')
		badge.setAttribute('aria-hidden', 'true')
		badge.dataset.widgetInspectorBadge = 'true'
		badge.style.pointerEvents = 'none'
		if (dom.badgeClass !== undefined)
			badge.classList.add(dom.badgeClass)
		dom.root.append(badge)
		badgeElement = badge
		return badge
	}

	function clearHighlight(): void {
		if (highlightedElement !== null && dom?.highlightClass !== undefined)
			highlightedElement.classList.remove(dom.highlightClass)
		highlightedElement = null
		badgeElement?.remove()
		badgeElement = null
	}

	function highlightAnchor(anchor: DomAnchor): void {
		if (dom === undefined)
			return
		if (highlightedElement !== anchor.element) {
			clearHighlight()
			if (dom.highlightClass !== undefined)
				anchor.element.classList.add(dom.highlightClass)
			highlightedElement = anchor.element
		}

		const badge = ensureBadge()
		if (badge === null)
			return
		badge.textContent = `${anchor.widgetType}#${anchor.widgetId}`
		const rootRect = dom.root.getBoundingClientRect()
		const anchorRect = anchor.element.getBoundingClientRect()
		badge.style.top = `${anchorRect.top - rootRect.top + dom.root.scrollTop}px`
		badge.style.left = `${anchorRect.left - rootRect.left + dom.root.scrollLeft}px`
	}

	function highlightRef(ref: WidgetRef): boolean {
		if (dom === undefined)
			return false
		const nodeId = resolveNodeId(ref)
		if (nodeId === null)
			return false
		const node = runtimeInspection.blueprint.getNode(nodeId)
		if (node === null || !node.resolved)
			return false
		for (const element of dom.root.querySelectorAll('[data-widget-id][data-widget-type]')) {
			if (element.getAttribute('data-widget-id') === node.node.id
				&& element.getAttribute('data-widget-type') === node.node.type) {
				highlightAnchor({ element, widgetId: node.node.id, widgetType: node.node.type })
				return true
			}
		}
		return false
	}

	function disableInspect(): void {
		if (!inspectEnabled)
			return
		inspectEnabled = false
		clearHighlight()
		emit('inspect.hovered', { ref: null })
		emit('agent.status', { inspectEnabled: false })
	}

	function onPointerOver(event: PointerEvent): void {
		if (!inspectEnabled)
			return
		const anchor = resolveAnchor(event.target)
		if (anchor === null) {
			clearHighlight()
			emit('inspect.hovered', { ref: null })
			return
		}
		const ref = nodeForAnchor(anchor)
		if (ref === null) {
			clearHighlight()
			emit('inspect.hovered', { ref: null })
			return
		}
		highlightAnchor(anchor)
		emit('inspect.hovered', { ref, widgetId: anchor.widgetId, widgetType: anchor.widgetType })
	}

	function onPointerLeave(): void {
		if (!inspectEnabled)
			return
		clearHighlight()
		emit('inspect.hovered', { ref: null })
	}

	function suppressPointerActivation(event: Event): void {
		if (!inspectEnabled || resolveAnchor(event.target) === null)
			return
		event.preventDefault()
		event.stopPropagation()
	}

	function onClick(event: MouseEvent): void {
		if (!inspectEnabled)
			return
		const anchor = resolveAnchor(event.target)
		if (anchor === null)
			return
		event.preventDefault()
		event.stopPropagation()
		const ref = nodeForAnchor(anchor)
		if (ref === null)
			return
		emit('inspect.selected', {
			ref,
			widgetId: anchor.widgetId,
			widgetType: anchor.widgetType,
		})
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && inspectEnabled) {
			event.preventDefault()
			event.stopPropagation()
			disableInspect()
		}
	}

	function installDomListeners(): () => void {
		if (dom === undefined)
			return () => {}
		dom.root.addEventListener('pointerover', onPointerOver)
		dom.root.addEventListener('pointerleave', onPointerLeave)
		dom.root.addEventListener('pointerdown', suppressPointerActivation, true)
		dom.root.addEventListener('pointerup', suppressPointerActivation, true)
		dom.root.addEventListener('click', onClick, true)
		dom.root.ownerDocument.addEventListener('keydown', onKeydown, true)
		return () => {
			dom.root.removeEventListener('pointerover', onPointerOver)
			dom.root.removeEventListener('pointerleave', onPointerLeave)
			dom.root.removeEventListener('pointerdown', suppressPointerActivation, true)
			dom.root.removeEventListener('pointerup', suppressPointerActivation, true)
			dom.root.removeEventListener('click', onClick, true)
			dom.root.ownerDocument.removeEventListener('keydown', onKeydown, true)
		}
	}

	function subscribeMember(request: Extract<InspectorRequestMessage, { method: 'runtime.subscribeMember' }>): void {
		if (request.params.ref.runtimeId !== runtimeId) {
			sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
			return
		}
		const widget = resolveWidget(request.params.ref)
		if (widget === null) {
			sendError(request.requestId, protocolError('widget-not-found', 'The requested widget does not exist in this Runtime snapshot.'))
			return
		}
		const member = request.params.member
		const observable = member.type === 'state' ? widget.getState(member.name) : widget.getProperty(member.name)
		const projected = projectRuntimeMemberSnapshot(widget, member)
		if (observable === null || projected === null) {
			sendError(request.requestId, protocolError('member-not-found', 'The requested Runtime member does not exist.'))
			return
		}
		const subscriptionId = `subscription-${subscriptionSequence++}`
		let unsubscribe: () => void
		try {
			unsubscribe = observable.subscribe(() => {
				const next = projectRuntimeMemberSnapshot(widget, member)
				if (next !== null) {
					emit('runtime.memberChanged', {
						subscriptionId,
						ref: request.params.ref,
						member: next,
					})
				}
			})
		}
		catch {
			sendError(request.requestId, protocolError('internal-error', 'Unable to subscribe to the Runtime member.'))
			return
		}
		subscriptions.set(subscriptionId, unsubscribe)
		sendSuccess(request, { subscriptionId, member: projected })
	}

	function handleRequest(request: InspectorRequestMessage): void {
		if (!isCompatibleProtocolVersion(request.protocol)) {
			sendError(request.requestId, protocolError('unsupported-version', `Unsupported Inspector protocol major ${request.protocol.major}.`))
			return
		}

		switch (request.method) {
			case 'handshake':
				if (!isCompatibleProtocolVersion(request.params.protocol)) {
					sendError(request.requestId, protocolError('unsupported-version', `Unsupported Inspector protocol major ${request.params.protocol.major}.`))
					return
				}
				sendSuccess(request, {
					protocol: INSPECTOR_PROTOCOL_VERSION,
					capabilities: { methods: SUPPORTED_METHODS, events: SUPPORTED_EVENTS },
				})
				return
			case 'runtime.list':
				sendSuccess(request, { runtimes: [{ runtimeId, rootNodeId: runtimeInspection.blueprint.rootNodeId }] })
				return
			case 'blueprint.getSnapshot':
				if (request.params.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				sendSuccess(request, projectBlueprintSnapshot(runtimeId, runtimeInspection.blueprint))
				return
			case 'runtime.getWidgetSnapshot': {
				if (request.params.ref.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				const nodeId = resolveNodeId(request.params.ref)
				const snapshot = nodeId === null ? null : projectRuntimeWidgetSnapshot(runtimeId, runtimeInspection, nodeId)
				if (snapshot === null) {
					sendError(request.requestId, protocolError('widget-not-found', 'The requested widget does not exist in this Runtime snapshot.'))
					return
				}
				sendSuccess(request, snapshot)
				return
			}
			case 'runtime.subscribeMember':
				subscribeMember(request)
				return
			case 'runtime.unsubscribeMember': {
				const unsubscribe = subscriptions.get(request.params.subscriptionId)
				if (unsubscribe === undefined) {
					sendSuccess(request, { removed: false })
					return
				}
				subscriptions.delete(request.params.subscriptionId)
				unsubscribe()
				sendSuccess(request, { removed: true })
				return
			}
			case 'inspect.enable':
				inspectEnabled = true
				emit('agent.status', { inspectEnabled: true })
				sendSuccess(request, { enabled: true })
				return
			case 'inspect.disable':
				disableInspect()
				sendSuccess(request, { enabled: false })
				return
			case 'highlight.show':
				if (request.params.ref.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				sendSuccess(request, { highlighted: highlightRef(request.params.ref) })
				return
			case 'highlight.clear':
				clearHighlight()
				sendSuccess(request, { highlighted: false })
		}
	}

	const removeDomListeners = installDomListeners()
	const unsubscribeTransport = options.transport.subscribe((raw) => {
		const request = parseInspectorRequestMessage(raw)
		if (request !== null) {
			handleRequest(request)
			return
		}
		if (typeof raw === 'object' && raw !== null
			&& 'kind' in raw && raw.kind === 'request'
			&& 'requestId' in raw && typeof raw.requestId === 'string') {
			sendError(raw.requestId, protocolError('invalid-message', 'Invalid Inspector protocol request.'))
		}
	})
	let unsubscribeClose: () => void = () => {}

	function cleanup(closeTransport: boolean): void {
		if (disposed)
			return
		disposed = true
		for (const unsubscribe of subscriptions.values())
			unsubscribe()
		subscriptions.clear()
		removeDomListeners()
		clearHighlight()
		unsubscribeTransport()
		unsubscribeClose()
		if (closeTransport && !options.transport.closed)
			options.transport.close()
	}

	unsubscribeClose = options.transport.subscribeClose(() => cleanup(false))

	return {
		runtimeId,
		get inspectEnabled() {
			return inspectEnabled
		},
		dispose() {
			cleanup(options.closeTransportOnDispose ?? true)
		},
	}
}
