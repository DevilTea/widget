/** Lab-private Preview-frame control protocol. Inspector traffic uses a sibling logical channel. */

import { TOUR_IDS } from '../tutorial/tours'

export const PREVIEW_HOST_PROTOCOL_VERSION = 1
export const PREVIEW_HOST_CHANNEL = 'preview-host'
export const PREVIEW_INSPECTOR_CHANNEL = 'inspector'

/** Tutorial tour ids the Preview frame can evaluate. A tour id is the id of the showcase it teaches. */
export type PreviewTourId = string

export interface PreviewHostDescriptor {
	readonly showcaseId: string
	readonly revision: number
	readonly sourceText: string
}

export interface PreviewHostMountRequest {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'mount'
	readonly requestId: string
	readonly sessionId: string
	readonly generation: number
	readonly preview: PreviewHostDescriptor
}

export interface PreviewHostTutorialEvaluateRequest {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'tutorial.evaluate'
	readonly requestId: string
	readonly tourId: PreviewTourId
	readonly stepIndex: number
	readonly progress: number
}

export interface PreviewHostPresentationUpdateMessage {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'presentation.update'
	readonly locale: 'en' | 'zh-TW'
	readonly theme: 'light' | 'dark'
}

export interface PreviewHostTutorialSpotlightMessage {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'tutorial.spotlight'
	readonly target: string | null
}

export type PreviewHostRequest = PreviewHostMountRequest | PreviewHostTutorialEvaluateRequest
export type PreviewHostCommand = PreviewHostPresentationUpdateMessage | PreviewHostTutorialSpotlightMessage

export interface PreviewHostMountedResponse {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'mounted'
	readonly requestId: string
	readonly generation: number
	readonly revision: number
	readonly runtimeId: string
}

export interface PreviewHostTutorialEvaluatedResponse {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'tutorial.evaluated'
	readonly requestId: string
	readonly tourId: PreviewTourId
	readonly stepIndex: number
	readonly progress: number
}

export interface PreviewHostErrorResponse {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'error'
	readonly requestId: string
	readonly message: string
	/**
	 * The frame had already taken down the Runtime it ran before when the mount failed (a failure after the point where
	 * the new one replaces it), so nothing runs any more. Absent: the old Runtime is untouched. Lab-internal, like the
	 * rest of this protocol; the Inspector protocol is not involved.
	 */
	readonly runtimeTornDown?: boolean
	/**
	 * The frame document cannot recover from this failure by itself (a module it needs failed to load, and the browser
	 * remembers that failure for the life of the document), so the host must discard it and load a new one before the
	 * next mount. Whatever it ran is gone with it. Absent: the frame stays usable. Lab-internal.
	 */
	readonly discardFrame?: boolean
}

export type PreviewHostResponse = PreviewHostMountedResponse | PreviewHostTutorialEvaluatedResponse | PreviewHostErrorResponse

export interface PreviewHostObservationChangedEvent {
	readonly protocol: typeof PREVIEW_HOST_PROTOCOL_VERSION
	readonly kind: 'tutorial.observation-changed'
	readonly tourId: PreviewTourId
}

export type PreviewHostEvent = PreviewHostObservationChangedEvent
export type PreviewHostMessage = PreviewHostRequest | PreviewHostCommand | PreviewHostResponse | PreviewHostEvent

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasProtocol(value: Record<string, unknown>): boolean {
	return value.protocol === PREVIEW_HOST_PROTOCOL_VERSION
}

function isTourId(value: unknown): value is PreviewTourId {
	return typeof value === 'string' && TOUR_IDS.includes(value)
}

export function isPreviewHostDescriptor(value: unknown): value is PreviewHostDescriptor {
	return isRecord(value)
		&& typeof value.showcaseId === 'string'
		&& value.showcaseId.length > 0
		&& isNonNegativeInteger(value.revision)
		&& typeof value.sourceText === 'string'
}

export function parsePreviewHostRequest(value: unknown): PreviewHostRequest | null {
	if (!isRecord(value) || !hasProtocol(value) || typeof value.requestId !== 'string' || value.requestId.length === 0)
		return null
	if (value.kind === 'mount') {
		return typeof value.sessionId === 'string' && value.sessionId.length > 0
			&& isNonNegativeInteger(value.generation)
			&& isPreviewHostDescriptor(value.preview)
			? value as unknown as PreviewHostMountRequest
			: null
	}
	if (value.kind === 'tutorial.evaluate') {
		return isTourId(value.tourId)
			&& isNonNegativeInteger(value.stepIndex)
			&& isNonNegativeInteger(value.progress)
			? value as unknown as PreviewHostTutorialEvaluateRequest
			: null
	}
	return null
}

export function parsePreviewHostCommand(value: unknown): PreviewHostCommand | null {
	if (!isRecord(value) || !hasProtocol(value))
		return null
	if (value.kind === 'tutorial.spotlight') {
		return value.target === null || typeof value.target === 'string'
			? value as unknown as PreviewHostTutorialSpotlightMessage
			: null
	}
	if (value.kind === 'presentation.update') {
		return (value.locale === 'en' || value.locale === 'zh-TW')
			&& (value.theme === 'light' || value.theme === 'dark')
			? value as unknown as PreviewHostPresentationUpdateMessage
			: null
	}
	return null
}

export function parsePreviewHostResponse(value: unknown): PreviewHostResponse | null {
	if (!isRecord(value) || !hasProtocol(value) || typeof value.requestId !== 'string' || value.requestId.length === 0)
		return null
	if (value.kind === 'mounted') {
		return isNonNegativeInteger(value.generation)
			&& isNonNegativeInteger(value.revision)
			&& typeof value.runtimeId === 'string'
			&& value.runtimeId.length > 0
			? value as unknown as PreviewHostMountedResponse
			: null
	}
	if (value.kind === 'tutorial.evaluated') {
		return isTourId(value.tourId)
			&& isNonNegativeInteger(value.stepIndex)
			&& isNonNegativeInteger(value.progress)
			? value as unknown as PreviewHostTutorialEvaluatedResponse
			: null
	}
	if (value.kind === 'error') {
		return typeof value.message === 'string'
			&& (value.runtimeTornDown === undefined || typeof value.runtimeTornDown === 'boolean')
			&& (value.discardFrame === undefined || typeof value.discardFrame === 'boolean')
			? value as unknown as PreviewHostErrorResponse
			: null
	}
	return null
}

export function parsePreviewHostEvent(value: unknown): PreviewHostEvent | null {
	if (!isRecord(value) || !hasProtocol(value))
		return null
	return value.kind === 'tutorial.observation-changed' && isTourId(value.tourId)
		? value as unknown as PreviewHostObservationChangedEvent
		: null
}
