import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { InspectionNodeId, RuntimeWidgetInspection } from '@deviltea/widget-core/inspection'
import type {
	InspectorEventMap,
	InspectorEventName,
	InspectorProtocolError,
	InspectorRequestMessage,
	InspectorRequestMethod,
	InspectorSemanticTarget,
	WidgetRef,
} from './protocol'
import type { InspectorTransport } from './transport'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import { createSemanticGeometryController } from './geometry'
import {
	projectBlueprintSnapshot,
	projectEventArgs,
	projectRuntimeMemberSnapshot,
	projectRuntimeWidgetSnapshot,
} from './projection'
import {
	INSPECTOR_PROTOCOL_VERSION,
	isCompatibleProtocolVersion,
	parseInspectorRequestMessage,
} from './protocol'

const PROTOCOL_0_1_METHODS = Object.freeze([
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

const PROTOCOL_0_2_METHODS = Object.freeze([
	'runtime.subscribeEvent',
	'runtime.unsubscribeEvent',
] satisfies InspectorRequestMethod[])

const PROTOCOL_0_2_GEOMETRY_METHODS = Object.freeze([
	'inspect.hitTest',
	'geometry.resolve',
] satisfies InspectorRequestMethod[])

const PROTOCOL_0_1_EVENTS = Object.freeze([
	'runtime.memberChanged',
	'inspect.hovered',
	'inspect.selected',
	'agent.status',
] satisfies InspectorEventName[])

const PROTOCOL_0_2_EVENTS = Object.freeze([
	'runtime.eventOccurred',
] satisfies InspectorEventName[])

const PROTOCOL_0_2_GEOMETRY_EVENTS = Object.freeze([
	'geometry.invalidated',
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
	/** Host-owned hint after CSSOM/adoptedStyleSheets changes; no Client mutation RPC is exposed. */
	invalidateGeometry: () => void
	dispose: () => void
}

function protocolError(code: InspectorProtocolError['code'], message: string): InspectorProtocolError {
	return { code, message }
}

export function createInspectorAgent(options: CreateInspectorAgentOptions): InspectorAgent {
	const runtimeId = options.runtimeId ?? createRuntimeId()
	const runtimeInspection = inspectRuntime(options.runtime)
	const dom = options.dom
	const memberSubscriptions = new Map<string, () => void>()
	const eventSubscriptions = new Map<string, () => void>()
	// One Inspector transport has one peer. Re-handshake may explicitly upgrade/downgrade it;
	// standalone requests remain valid before the first handshake.
	let negotiatedMinor: number = INSPECTOR_PROTOCOL_VERSION.minor
	const envelopeVersion = () => ({ major: INSPECTOR_PROTOCOL_VERSION.major, minor: negotiatedMinor })
	function capabilitiesForMinor(minor: number): { readonly methods: readonly InspectorRequestMethod[], readonly events: readonly InspectorEventName[] } {
		if (minor < 2) {
			return {
				methods: PROTOCOL_0_1_METHODS,
				events: PROTOCOL_0_1_EVENTS,
			}
		}
		return {
			methods: dom === undefined
				? Object.freeze([...PROTOCOL_0_1_METHODS, ...PROTOCOL_0_2_METHODS])
				: Object.freeze([...PROTOCOL_0_1_METHODS, ...PROTOCOL_0_2_METHODS, ...PROTOCOL_0_2_GEOMETRY_METHODS]),
			events: dom === undefined
				? Object.freeze([...PROTOCOL_0_1_EVENTS, ...PROTOCOL_0_2_EVENTS])
				: Object.freeze([...PROTOCOL_0_1_EVENTS, ...PROTOCOL_0_2_EVENTS, ...PROTOCOL_0_2_GEOMETRY_EVENTS]),
		}
	}
	let inspectEnabled = false
	let disposed = false
	let highlightedElement: Element | null = null
	let badgeElement: HTMLDivElement | null = null

	function emit<Event extends InspectorEventName>(event: Event, payload: InspectorEventMap[Event]): void {
		if (disposed || options.transport.closed || !capabilitiesForMinor(negotiatedMinor).events.includes(event))
			return
		options.transport.send({
			protocol: envelopeVersion(),
			kind: 'event',
			event,
			payload,
		})
	}

	function sendSuccess(request: InspectorRequestMessage, result: unknown): void {
		if (disposed || options.transport.closed)
			return
		options.transport.send({
			protocol: envelopeVersion(),
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
			protocol: envelopeVersion(),
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
		let element: Element | null = target.closest('[data-widget-id][data-widget-type]')
		while (element !== null && dom.root.contains(element)) {
			const widgetId = element.getAttribute('data-widget-id')
			const widgetType = element.getAttribute('data-widget-type')
			if (widgetId !== null && widgetType !== null && nodeForAnchor({ widgetId, widgetType }) !== null)
				return { element, widgetId, widgetType }
			if (element === dom.root)
				break
			element = element.parentElement?.closest('[data-widget-id][data-widget-type]') ?? null
		}
		return null
	}

	function semanticTargetForRef(ref: WidgetRef): InspectorSemanticTarget | null {
		const nodeId = resolveNodeId(ref)
		if (nodeId === null)
			return null
		const node = runtimeInspection.blueprint.getNode(nodeId)
		if (node === null || !node.resolved)
			return null
		return { ref, widgetId: node.node.id, widgetType: node.node.type }
	}

	function semanticTargetForAnchorElement(element: Element): InspectorSemanticTarget | null {
		if (dom === undefined || !dom.root.contains(element))
			return null
		const widgetId = element.getAttribute('data-widget-id')
		const widgetType = element.getAttribute('data-widget-type')
		if (widgetId === null || widgetType === null)
			return null
		const ref = nodeForAnchor({ widgetId, widgetType })
		return ref === null ? null : { ref, widgetId, widgetType }
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
		const label = `${anchor.widgetType}#${anchor.widgetId}`
		if (badge.textContent !== label)
			badge.textContent = label
		const rootRect = dom.root.getBoundingClientRect()
		const anchorRect = anchor.element.getBoundingClientRect()
		const top = `${anchorRect.top - rootRect.top + dom.root.scrollTop}px`
		const left = `${anchorRect.left - rootRect.left + dom.root.scrollLeft}px`
		// Re-highlighting unchanged chrome should not mutate the Preview.
		if (badge.style.top !== top)
			badge.style.top = top
		if (badge.style.left !== left)
			badge.style.left = left
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
		const matches = (element: Element): boolean =>
			element.getAttribute('data-widget-id') === node.node.id
			&& element.getAttribute('data-widget-type') === node.node.type
		// The Preview root is a valid semantic anchor, not only its descendants.
		if (matches(dom.root)) {
			highlightAnchor({ element: dom.root, widgetId: node.node.id, widgetType: node.node.type })
			return true
		}
		for (const element of dom.root.querySelectorAll('[data-widget-id][data-widget-type]')) {
			if (matches(element)) {
				highlightAnchor({ element, widgetId: node.node.id, widgetType: node.node.type })
				return true
			}
		}
		return false
	}

	const geometry = dom === undefined
		? null
		: createSemanticGeometryController({
				root: dom.root,
				resolveRef: semanticTargetForRef,
				resolveAnchor: semanticTargetForAnchorElement,
				onInvalidated: revision => emit('geometry.invalidated', { revision }),
			})

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
		memberSubscriptions.set(subscriptionId, unsubscribe)
		sendSuccess(request, { subscriptionId, member: projected })
	}

	function subscribeEvent(request: Extract<InspectorRequestMessage, { method: 'runtime.subscribeEvent' }>): void {
		if (request.params.ref.runtimeId !== runtimeId) {
			sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
			return
		}
		const widget = resolveWidget(request.params.ref)
		if (widget === null) {
			sendError(request.requestId, protocolError('widget-not-found', 'The requested widget does not exist in this Runtime snapshot.'))
			return
		}
		const observable = widget.getEvent(request.params.event)
		if (observable === null) {
			sendError(request.requestId, protocolError('event-not-found', 'The requested Runtime event does not exist.'))
			return
		}
		const subscriptionId = `event-subscription-${subscriptionSequence++}`
		let unsubscribe: () => void
		try {
			unsubscribe = observable.subscribe((args) => {
				emit('runtime.eventOccurred', {
					subscriptionId,
					ref: request.params.ref,
					event: request.params.event,
					args: projectEventArgs(args),
				})
			})
		}
		catch {
			sendError(request.requestId, protocolError('internal-error', 'Unable to subscribe to the Runtime event.'))
			return
		}
		eventSubscriptions.set(subscriptionId, unsubscribe)
		sendSuccess(request, { subscriptionId, event: request.params.event })
	}

	function handleRequest(request: InspectorRequestMessage): void {
		if (!isCompatibleProtocolVersion(request.protocol)) {
			sendError(request.requestId, protocolError('unsupported-version', `Unsupported Inspector protocol major ${request.protocol.major}.`))
			return
		}

		if (request.method !== 'handshake') {
			negotiatedMinor = Math.min(negotiatedMinor, request.protocol.minor)
			if (!capabilitiesForMinor(negotiatedMinor).methods.includes(request.method)) {
				sendError(request.requestId, protocolError('unknown-method', 'Method unavailable in this Inspector protocol session.'))
				return
			}
		}

		switch (request.method) {
			case 'handshake': {
				if (!isCompatibleProtocolVersion(request.params.protocol)) {
					sendError(request.requestId, protocolError('unsupported-version', `Unsupported Inspector protocol major ${request.params.protocol.major}.`))
					return
				}
				negotiatedMinor = Math.min(INSPECTOR_PROTOCOL_VERSION.minor, request.protocol.minor, request.params.protocol.minor)
				const capabilities = capabilitiesForMinor(negotiatedMinor)
				sendSuccess(request, {
					protocol: envelopeVersion(),
					capabilities,
				})
				return
			}
			case 'runtime.list':
				sendSuccess(request, { runtimes: [{ runtimeId, rootNodeId: runtimeInspection.blueprint.rootNodeId }] })
				return
			case 'blueprint.getSnapshot':
				if (request.params.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				sendSuccess(request, projectBlueprintSnapshot(runtimeId, runtimeInspection.blueprint, negotiatedMinor))
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
			case 'runtime.subscribeEvent':
				subscribeEvent(request)
				return
			case 'runtime.unsubscribeMember': {
				const unsubscribe = memberSubscriptions.get(request.params.subscriptionId)
				if (unsubscribe === undefined) {
					sendSuccess(request, { removed: false })
					return
				}
				memberSubscriptions.delete(request.params.subscriptionId)
				unsubscribe()
				sendSuccess(request, { removed: true })
				return
			}
			case 'runtime.unsubscribeEvent': {
				const unsubscribe = eventSubscriptions.get(request.params.subscriptionId)
				if (unsubscribe === undefined) {
					sendSuccess(request, { removed: false })
					return
				}
				eventSubscriptions.delete(request.params.subscriptionId)
				unsubscribe()
				sendSuccess(request, { removed: true })
				return
			}
			case 'inspect.hitTest':
				if (geometry === null) {
					sendError(request.requestId, protocolError('internal-error', 'DOM geometry is unavailable for this Inspector Agent.'))
					return
				}
				sendSuccess(request, geometry.hitTest(request.params))
				return
			case 'geometry.resolve':
				if (request.params.ref.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				if (geometry === null) {
					sendError(request.requestId, protocolError('internal-error', 'DOM geometry is unavailable for this Inspector Agent.'))
					return
				}
				sendSuccess(request, geometry.resolve(request.params.ref))
				return
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
		for (const unsubscribe of memberSubscriptions.values())
			unsubscribe()
		memberSubscriptions.clear()
		for (const unsubscribe of eventSubscriptions.values())
			unsubscribe()
		eventSubscriptions.clear()
		removeDomListeners()
		geometry?.dispose()
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
		invalidateGeometry() {
			geometry?.invalidate()
		},
		dispose() {
			cleanup(options.closeTransportOnDispose ?? true)
		},
	}
}
