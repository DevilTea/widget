import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { InspectionNodeId, RuntimeWidgetInspection } from '@deviltea/widget-core/inspection'
import type { SemanticGeometryController } from './geometry'
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
import type { InspectableValueEncodingOptions } from './value'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import { ANCHOR_SELECTOR, createSemanticGeometryController, readAnchorIdentity } from './geometry'
import { createInspectorOverlay } from './overlay'
import {
	projectBlueprintSnapshot,
	projectEventArgs,
	projectRuntimeMemberSnapshot,
	projectRuntimeWidgetSnapshot,
} from './projection'
import {
	classifyInspectorRequest,
	INSPECTOR_PROTOCOL_VERSION,
	isCompatibleProtocolVersion,
} from './protocol'

const PROTOCOL_0_1_METHODS = Object.freeze([
	'handshake',
	'runtime.list',
	'blueprint.getSnapshot',
	'runtime.getWidgetSnapshot',
	'runtime.subscribeMember',
	'runtime.unsubscribeMember',
] satisfies InspectorRequestMethod[])

/** Present only when the Agent has an inspected DOM root: without one they cannot do anything. */
const PROTOCOL_0_1_DOM_METHODS = Object.freeze([
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

const PROTOCOL_0_4_EVENTS = Object.freeze([
	'runtime.disposed',
] satisfies InspectorEventName[])

/** `runtime.disposed` and the `runtime-disposed` error code exist from this protocol minor on. */
const RUNTIME_LIFECYCLE_PROTOCOL_MINOR = 4

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
	/**
	 * The inspected renderer root. Anchors (see `@deviltea/widget-inspector/anchor`) are only read from
	 * inside it. The Agent never mutates renderer elements: highlight chrome is an Agent-owned
	 * ShadowRoot overlay attached to the root's document.
	 */
	readonly root: HTMLElement
}

export interface CreateInspectorAgentOptions {
	readonly runtime: WidgetSystemRuntime
	readonly transport: InspectorTransport
	readonly runtimeId?: string
	readonly dom?: InspectorAgentDomOptions
	/** Keep a host-owned shared transport alive when replacing only this Agent/Runtime binding. */
	readonly closeTransportOnDispose?: boolean
	/**
	 * Optional cap on this Agent's live Runtime member and event subscriptions, counted together.
	 * There is no default: unlimited unless configured. Once the cap is reached, further subscribe
	 * requests fail with `subscription-limit` (protocol 0.3+; an older-minor peer receives
	 * `internal-error` instead). Must be a positive safe integer.
	 */
	readonly maxSubscriptions?: number
	/**
	 * Overrides the limits applied when Runtime values and event arguments are encoded for the wire (see
	 * `InspectableValueEncodingOptions`; omitted fields keep `DEFAULT_INSPECTABLE_VALUE_LIMITS`). Every
	 * limit must be a positive safe integer; `maxDepth` may also be 0.
	 */
	readonly valueLimits?: Pick<InspectableValueEncodingOptions, 'maxDepth' | 'maxEntries' | 'maxStringLength' | 'maxNodes'>
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
	const maxSubscriptions = options.maxSubscriptions
	if (maxSubscriptions !== undefined && !(Number.isSafeInteger(maxSubscriptions) && maxSubscriptions >= 1))
		throw new RangeError('maxSubscriptions must be a positive safe integer when configured.')
	const valueLimits = { ...options.valueLimits }
	for (const [name, limit] of Object.entries(valueLimits)) {
		const minimum = name === 'maxDepth' ? 0 : 1
		if (limit !== undefined && !(Number.isSafeInteger(limit) && limit >= minimum))
			throw new RangeError(`valueLimits.${name} must be a safe integer of at least ${minimum} when configured.`)
	}
	const runtimeId = options.runtimeId ?? createRuntimeId()
	const runtimeInspection = inspectRuntime(options.runtime)
	const dom = options.dom
	const memberSubscriptions = new Map<string, () => void>()
	const eventSubscriptions = new Map<string, () => void>()
	// One Inspector transport has one peer. Only a handshake sets (or re-sets) the negotiated minor;
	// standalone requests remain valid before the first handshake.
	let negotiatedMinor: number = INSPECTOR_PROTOCOL_VERSION.minor
	// While one request is handled, answers use the lower of the negotiated minor and the request's own
	// envelope minor, so a peer that never handshakes still sees the shapes of the minor it speaks. This
	// never changes `negotiatedMinor`, which event delivery uses.
	let requestMinor: number | null = null
	const currentMinor = () => requestMinor ?? negotiatedMinor
	const envelopeVersion = () => ({ major: INSPECTOR_PROTOCOL_VERSION.major, minor: currentMinor() })
	// Peers negotiated below 0.4 predate the truncated-key marker, so they never receive it.
	const valueEncoding = (): InspectableValueEncodingOptions => ({ ...valueLimits, markTruncatedKeys: currentMinor() >= 4 })
	function capabilitiesForMinor(minor: number): { readonly methods: readonly InspectorRequestMethod[], readonly events: readonly InspectorEventName[] } {
		if (minor < 2) {
			return {
				methods: dom === undefined ? PROTOCOL_0_1_METHODS : Object.freeze([...PROTOCOL_0_1_METHODS, ...PROTOCOL_0_1_DOM_METHODS]),
				events: PROTOCOL_0_1_EVENTS,
			}
		}
		return {
			methods: dom === undefined
				? Object.freeze([...PROTOCOL_0_1_METHODS, ...PROTOCOL_0_2_METHODS])
				: Object.freeze([...PROTOCOL_0_1_METHODS, ...PROTOCOL_0_1_DOM_METHODS, ...PROTOCOL_0_2_METHODS, ...PROTOCOL_0_2_GEOMETRY_METHODS]),
			events: Object.freeze([
				...PROTOCOL_0_1_EVENTS,
				...PROTOCOL_0_2_EVENTS,
				...(dom === undefined ? [] : PROTOCOL_0_2_GEOMETRY_EVENTS),
				...(minor < RUNTIME_LIFECYCLE_PROTOCOL_MINOR ? [] : PROTOCOL_0_4_EVENTS),
			]),
		}
	}
	let inspectEnabled = false
	let disposed = false
	const overlay = dom === undefined ? null : createInspectorOverlay(dom.root.ownerDocument)
	let highlightedTarget: InspectorSemanticTarget | null = null

	// Set once the peer has been told (or could not be told) that this Agent's Runtime is gone.
	let runtimeDisposalAnnounced = false

	function emit<Event extends InspectorEventName>(event: Event, payload: InspectorEventMap[Event]): void {
		if (event !== 'runtime.disposed')
			observeRuntimeDisposal()
		if (disposed || options.transport.closed || !capabilitiesForMinor(negotiatedMinor).events.includes(event))
			return
		try {
			options.transport.send({
				protocol: { major: INSPECTOR_PROTOCOL_VERSION.major, minor: negotiatedMinor },
				kind: 'event',
				event,
				payload,
			})
		}
		catch {
			// An event that cannot be delivered must not break the Runtime/DOM callback that produced it.
		}
	}

	/**
	 * Announces disposal at most once. The Agent registers `runtime.subscribeDisposal()` so this runs inside
	 * `runtime.dispose()`. It also checks `isDisposed` when any request arrives, before it emits any other
	 * event, and when the Agent itself is disposed: that is the only path for an Agent created on a Runtime
	 * that was already disposed (subscribing to one throws), and it keeps everything consistent whenever the
	 * listener could not tell the peer.
	 */
	function observeRuntimeDisposal(): boolean {
		if (!options.runtime.isDisposed)
			return false
		if (!runtimeDisposalAnnounced) {
			runtimeDisposalAnnounced = true
			// Core already tore down its side of every live subscription; release the Agent's bookkeeping.
			releaseSubscriptions()
			emit('runtime.disposed', { runtimeId, reason: 'runtime-disposed' })
		}
		return true
	}

	function releaseSubscriptions(): void {
		for (const unsubscribe of memberSubscriptions.values())
			unsubscribe()
		memberSubscriptions.clear()
		for (const unsubscribe of eventSubscriptions.values())
			unsubscribe()
		eventSubscriptions.clear()
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
		// Innermost resolvable anchor wins; stale/unknown anchors fall through to their ancestors.
		let element: Element | null = target.closest(ANCHOR_SELECTOR)
		while (element !== null && dom.root.contains(element)) {
			const identity = readAnchorIdentity(element)
			if (identity !== null && nodeForAnchor(identity) !== null)
				return { element, ...identity }
			if (element === dom.root)
				break
			element = element.parentElement?.closest(ANCHOR_SELECTOR) ?? null
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
		const identity = readAnchorIdentity(element)
		if (identity === null)
			return null
		const ref = nodeForAnchor(identity)
		return ref === null ? null : { ref, ...identity }
	}

	// Document-wide geometry observation (scroll/resize/mutation/resize observers) starts on first use:
	// geometry, hit-test, inspect mode or highlight. An idle Agent observes and reports nothing.
	let geometryController: SemanticGeometryController | null = null
	function ensureGeometry(): SemanticGeometryController | null {
		if (dom === undefined || disposed)
			return geometryController
		geometryController ??= createSemanticGeometryController({
			root: dom.root,
			resolveRef: semanticTargetForRef,
			resolveAnchor: semanticTargetForAnchorElement,
			onInvalidated: (revision) => {
				// Layout, scroll, or a renderer re-render moved/replaced anchors: follow them.
				drawHighlight()
				emit('geometry.invalidated', { revision })
			},
		})
		return geometryController
	}

	function clearHighlight(): void {
		highlightedTarget = null
		overlay?.clear()
	}

	/** Draws every fragment of the highlighted Widget; returns whether any anchor element exists. */
	function drawHighlight(): boolean {
		const geometry = ensureGeometry()
		if (overlay === null || geometry === null || highlightedTarget === null)
			return false
		const measurement = geometry.measure(highlightedTarget)
		if (measurement.rects.length === 0)
			overlay.clear()
		else
			overlay.show({ label: `${highlightedTarget.widgetType}#${highlightedTarget.widgetId}`, rects: measurement.rects })
		return measurement.anchorCount > 0
	}

	function highlightTarget(target: InspectorSemanticTarget): boolean {
		const geometry = ensureGeometry()
		if (geometry === null || overlay === null || geometry.measure(target).anchorCount === 0)
			return false
		highlightedTarget = target
		return drawHighlight()
	}

	function highlightRef(ref: WidgetRef): boolean {
		const target = semanticTargetForRef(ref)
		return target !== null && highlightTarget(target)
	}

	function disableInspect(): void {
		if (!inspectEnabled)
			return
		inspectEnabled = false
		clearHighlight()
		setHovered(null)
		emit('agent.status', { inspectEnabled: false })
	}

	// The Widget the peer was last told is hovered; `inspect.hovered` is only re-emitted when it changes.
	let hoveredNodeId: number | null = null

	function setHovered(target: InspectorSemanticTarget | null): void {
		const nodeId = target === null ? null : target.ref.nodeId
		if (nodeId === hoveredNodeId)
			return
		hoveredNodeId = nodeId
		emit('inspect.hovered', target === null
			? { ref: null }
			: { ref: target.ref, widgetId: target.widgetId, widgetType: target.widgetType })
	}

	function onPointerOver(event: PointerEvent): void {
		if (!inspectEnabled)
			return
		const anchor = resolveAnchor(event.target)
		if (anchor === null) {
			clearHighlight()
			setHovered(null)
			return
		}
		const ref = nodeForAnchor(anchor)
		if (ref === null) {
			clearHighlight()
			setHovered(null)
			return
		}
		const target = { ref, widgetId: anchor.widgetId, widgetType: anchor.widgetType }
		highlightTarget(target)
		setHovered(target)
	}

	function onPointerLeave(): void {
		if (!inspectEnabled)
			return
		clearHighlight()
		setHovered(null)
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

	/** With no configured cap this never rejects: unlimited is the default. */
	function rejectAtSubscriptionLimit(request: InspectorRequestMessage): boolean {
		if (maxSubscriptions === undefined || memberSubscriptions.size + eventSubscriptions.size < maxSubscriptions)
			return false
		const message = `This Inspector Agent allows at most ${maxSubscriptions} live subscriptions.`
		// A peer negotiated below protocol 0.3 cannot parse the new code; keep it within its vocabulary.
		sendError(request.requestId, protocolError(currentMinor() >= 3 ? 'subscription-limit' : 'internal-error', message))
		return true
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
		const projected = projectRuntimeMemberSnapshot(widget, member, valueEncoding())
		if (observable === null || projected === null) {
			sendError(request.requestId, protocolError('member-not-found', 'The requested Runtime member does not exist.'))
			return
		}
		if (rejectAtSubscriptionLimit(request))
			return
		const subscriptionId = `subscription-${subscriptionSequence++}`
		let unsubscribe: () => void
		try {
			unsubscribe = observable.subscribe(() => {
				const next = projectRuntimeMemberSnapshot(widget, member, valueEncoding())
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
		try {
			sendSuccess(request, { subscriptionId, member: projected })
		}
		catch (error) {
			// The peer never learned this id: registration and response are atomic, so roll back.
			memberSubscriptions.delete(subscriptionId)
			unsubscribe()
			throw error
		}
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
		if (rejectAtSubscriptionLimit(request))
			return
		const subscriptionId = `event-subscription-${subscriptionSequence++}`
		let unsubscribe: () => void
		try {
			unsubscribe = observable.subscribe((args) => {
				emit('runtime.eventOccurred', {
					subscriptionId,
					ref: request.params.ref,
					event: request.params.event,
					args: projectEventArgs(args, valueEncoding()),
				})
			})
		}
		catch {
			sendError(request.requestId, protocolError('internal-error', 'Unable to subscribe to the Runtime event.'))
			return
		}
		eventSubscriptions.set(subscriptionId, unsubscribe)
		try {
			sendSuccess(request, { subscriptionId, event: request.params.event })
		}
		catch (error) {
			// The peer never learned this id: registration and response are atomic, so roll back.
			eventSubscriptions.delete(subscriptionId)
			unsubscribe()
			throw error
		}
	}

	/** The Runtime id a request addresses (directly or through a WidgetRef), if it addresses one. */
	function addressedRuntimeId(request: InspectorRequestMessage): string | null {
		switch (request.method) {
			case 'blueprint.getSnapshot':
				return request.params.runtimeId
			case 'runtime.getWidgetSnapshot':
			case 'runtime.subscribeMember':
			case 'runtime.subscribeEvent':
			case 'geometry.resolve':
			case 'highlight.show':
				return request.params.ref.runtimeId
			default:
				return null
		}
	}

	/** Methods that address no Runtime id but still act on the live Runtime's inspected document. */
	function dependsOnLiveRuntime(request: InspectorRequestMessage): boolean {
		return request.method === 'inspect.hitTest' || request.method === 'inspect.enable' || request.method === 'highlight.clear'
	}

	function handleRequest(request: InspectorRequestMessage): void {
		try {
			handleRequestAtMinor(request)
		}
		finally {
			requestMinor = null
		}
	}

	function handleRequestAtMinor(request: InspectorRequestMessage): void {
		if (!isCompatibleProtocolVersion(request.protocol)) {
			sendError(request.requestId, protocolError('unsupported-version', `Unsupported Inspector protocol major ${request.protocol.major}.`))
			return
		}

		const runtimeDisposed = observeRuntimeDisposal()

		if (request.method !== 'handshake') {
			requestMinor = Math.min(negotiatedMinor, request.protocol.minor)
			if (!capabilitiesForMinor(requestMinor).methods.includes(request.method)) {
				sendError(request.requestId, protocolError('unknown-method', 'Method unavailable in this Inspector protocol session.'))
				return
			}
			// From 0.4 a disposed Runtime is no longer addressable and the methods that act on the live Runtime
			// (hit testing, inspect mode, highlight) stop answering; older peers keep the earlier behavior.
			// Releasing things the peer holds (`unsubscribe*`, `inspect.disable`) stays answerable.
			if (runtimeDisposed && requestMinor >= RUNTIME_LIFECYCLE_PROTOCOL_MINOR
				&& (addressedRuntimeId(request) === runtimeId || dependsOnLiveRuntime(request))) {
				sendError(request.requestId, protocolError('runtime-disposed', 'The requested Runtime has been disposed.'))
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
				sendSuccess(request, {
					runtimes: runtimeDisposed && currentMinor() >= RUNTIME_LIFECYCLE_PROTOCOL_MINOR
						? []
						: [{ runtimeId, rootNodeId: runtimeInspection.blueprint.rootNodeId }],
				})
				return
			case 'blueprint.getSnapshot':
				if (request.params.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				sendSuccess(request, projectBlueprintSnapshot(runtimeId, runtimeInspection.blueprint, currentMinor()))
				return
			case 'runtime.getWidgetSnapshot': {
				if (request.params.ref.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				const nodeId = resolveNodeId(request.params.ref)
				const snapshot = nodeId === null ? null : projectRuntimeWidgetSnapshot(runtimeId, runtimeInspection, nodeId, valueEncoding())
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
			case 'inspect.hitTest': {
				const geometry = ensureGeometry()
				if (geometry === null) {
					sendError(request.requestId, protocolError('internal-error', 'DOM geometry is unavailable for this Inspector Agent.'))
					return
				}
				sendSuccess(request, geometry.hitTest(request.params))
				return
			}
			case 'geometry.resolve': {
				if (request.params.ref.runtimeId !== runtimeId) {
					sendError(request.requestId, protocolError('runtime-not-found', 'The requested Runtime is not registered.'))
					return
				}
				const geometry = ensureGeometry()
				if (geometry === null) {
					sendError(request.requestId, protocolError('internal-error', 'DOM geometry is unavailable for this Inspector Agent.'))
					return
				}
				sendSuccess(request, geometry.resolve(request.params.ref))
				return
			}
			case 'inspect.enable':
				ensureGeometry()
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
	// Subscribing to an already disposed Runtime throws; the lazy checks cover that case.
	const unsubscribeDisposal = options.runtime.isDisposed
		? () => {}
		: options.runtime.subscribeDisposal(() => {
				observeRuntimeDisposal()
			})
	const unsubscribeTransport = options.transport.subscribe((raw) => {
		let requestId: string | null = null
		try {
			const classified = classifyInspectorRequest(raw)
			if (classified.ok) {
				requestId = classified.request.requestId
				handleRequest(classified.request)
				return
			}
			// Without a request id there is nothing to correlate an answer with.
			if (classified.requestId === null)
				return
			requestId = classified.requestId
			if (classified.protocol !== null && !isCompatibleProtocolVersion(classified.protocol)) {
				sendError(requestId, protocolError('unsupported-version', `Unsupported Inspector protocol major ${classified.protocol.major}.`))
			}
			else if (classified.code === 'unknown-method') {
				sendError(requestId, protocolError('unknown-method', 'The requested method is not defined by this Inspector protocol.'))
			}
			else if (classified.code === 'invalid-params') {
				sendError(requestId, protocolError('invalid-params', 'Invalid parameters for the requested Inspector method.'))
			}
			else {
				sendError(requestId, protocolError('invalid-message', 'Invalid Inspector protocol request.'))
			}
		}
		catch (error) {
			// Catch-all: every request that carries an id gets exactly one answer, and the Agent keeps
			// serving. The failure detail never reaches the peer (it only learns the failure was internal);
			// it is reported in this realm out-of-band, like Core's isolated listener failures.
			queueMicrotask(() => {
				throw error
			})
			try {
				if (requestId === null && typeof raw === 'object' && raw !== null
					&& 'requestId' in raw && typeof raw.requestId === 'string') {
					requestId = raw.requestId
				}
				if (requestId !== null)
					sendError(requestId, protocolError('internal-error', 'The Inspector Agent failed to handle the request.'))
			}
			catch {
				// The transport itself is unusable; its close notification owns cleanup.
			}
		}
	})
	let unsubscribeClose: () => void = () => {}

	function cleanup(closeTransport: boolean): void {
		if (disposed)
			return
		// A peer that keeps the transport open learns the binding is gone; one whose transport closes
		// learns it from the disconnect.
		if (!closeTransport && !runtimeDisposalAnnounced) {
			runtimeDisposalAnnounced = true
			emit('runtime.disposed', { runtimeId, reason: options.runtime.isDisposed ? 'runtime-disposed' : 'agent-disposed' })
		}
		disposed = true
		unsubscribeDisposal()
		releaseSubscriptions()
		removeDomListeners()
		geometryController?.dispose()
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
			geometryController?.invalidate()
		},
		dispose() {
			cleanup(options.closeTransportOnDispose ?? true)
		},
	}
}
