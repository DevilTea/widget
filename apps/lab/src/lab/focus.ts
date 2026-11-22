/**
 * Revision-scoped inspector focus across the parent Document and remote iframe Preview.
 *
 * Core's `InspectionNodeId` is explicitly snapshot-local: separately-created Blueprints have unrelated
 * node-id domains even when they represent the same authored revision. Phase B2 therefore never copies a
 * raw node id between realms. Linked focus maps only through resolved `widgetId + widgetType` identity.
 */

import type { AnyWidgetPluginTuple, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { InspectorBlueprintNode, InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
import type { LabSession } from './session'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export type InspectorFocusScope = 'document' | 'preview'

export type InspectorFocusMember
	= | { readonly type: 'state', readonly name: string }
		| { readonly type: 'property', readonly name: string }
		| { readonly type: 'method', readonly name: string }

export interface InspectorFocus {
	readonly nodeId: InspectionNodeId
	readonly member?: InspectorFocusMember
}

export interface PreviewInspectorFocus {
	readonly nodeId: number
	readonly member?: InspectorFocusMember
}

export interface DocumentScopedInspectorFocus extends InspectorFocus {
	readonly scope: 'document'
	readonly revision: number
}

export interface PreviewScopedInspectorFocus extends PreviewInspectorFocus {
	readonly scope: 'preview'
	readonly revision: number
	readonly runtimeId: string
}

export type ScopedInspectorFocus = DocumentScopedInspectorFocus | PreviewScopedInspectorFocus

export interface InspectorFocusStore {
	getFocus: () => InspectorFocus | null
	/**
	 * Whether the Document focus is a widget someone chose (a `setFocus` call, or an Inspect selection mapped to the Document),
	 * as opposed to the root the store starts at and falls back to when a commit drops the selected widget. The Explain tab
	 * reads it so that it never explains the root nobody picked (Lab UX phase 2).
	 */
	isDocumentFocusChosen: () => boolean
	getScopedFocus: {
		(scope: 'document'): DocumentScopedInspectorFocus | null
		(scope: 'preview'): PreviewScopedInspectorFocus | null
	}
	setFocus: {
		(scope: 'document', focus: InspectorFocus | null): void
		(scope: 'preview', focus: PreviewInspectorFocus | null): void
		/** @deprecated Document-scope compatibility for tutorial/consumer calls. */
		(focus: InspectorFocus | null): void
	}
	setPreviewSnapshot: (revision: number, snapshot: InspectorBlueprintSnapshot | null) => void
	subscribe: (listener: () => void) => () => void
	dispose: () => void
}

interface WidgetIdentity {
	readonly widgetId: string
	readonly widgetType: string
}

function rootFocusOf<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>): InspectorFocus {
	return { nodeId: inspectBlueprint(blueprint).rootNodeId }
}

function documentIdentity(blueprint: WidgetSystemBlueprint, nodeId: InspectionNodeId): WidgetIdentity | null {
	const node = inspectBlueprint(blueprint)
		.getNode(nodeId)
	return node !== null && node.resolved ? { widgetId: node.node.id, widgetType: node.node.type } : null
}

function documentNodeForIdentity(blueprint: WidgetSystemBlueprint, identity: WidgetIdentity): InspectionNodeId | null {
	for (const entry of inspectBlueprint(blueprint).nodes) {
		if (entry.node.resolved && entry.node.id === identity.widgetId && entry.node.type === identity.widgetType)
			return entry.nodeId
	}
	return null
}

/** The one node of `blueprint` with this identity; `null` when there is none or the identity is ambiguous (duplicate ids). */
function uniqueDocumentNodeForIdentity(blueprint: WidgetSystemBlueprint, identity: WidgetIdentity): InspectionNodeId | null {
	let found: InspectionNodeId | null = null
	for (const entry of inspectBlueprint(blueprint).nodes) {
		if (entry.node.resolved && entry.node.id === identity.widgetId && entry.node.type === identity.widgetType) {
			if (found !== null)
				return null
			found = entry.nodeId
		}
	}
	return found
}

function remoteIdentity(snapshot: InspectorBlueprintSnapshot, nodeId: number): WidgetIdentity | null {
	const node = snapshot.nodes.find(candidate => candidate.nodeId === nodeId)
	return node !== undefined && node.resolved && node.widgetId !== undefined && node.widgetType !== undefined
		? { widgetId: node.widgetId, widgetType: node.widgetType }
		: null
}

function remoteNodeForIdentity(snapshot: InspectorBlueprintSnapshot, identity: WidgetIdentity): InspectorBlueprintNode | null {
	return snapshot.nodes.find(node => node.resolved
		&& node.widgetId === identity.widgetId
		&& node.widgetType === identity.widgetType) ?? null
}

export function createInspectorFocusStore<Plugins extends AnyWidgetPluginTuple>(
	session: LabSession<Plugins>,
): InspectorFocusStore {
	const listeners = new Set<() => void>()
	let lastDocumentRevision = session.documentState.revision
	let lastDocumentBlueprint = session.documentState.blueprint
	let remoteRevision: number | null = null
	let remoteSnapshot: InspectorBlueprintSnapshot | null = null
	let documentFocus: DocumentScopedInspectorFocus | null = {
		...rootFocusOf(lastDocumentBlueprint),
		scope: 'document',
		revision: lastDocumentRevision,
	}
	let previewFocus: PreviewScopedInspectorFocus | null = null
	let documentFocusChosen = false

	function emit(): void {
		for (const listener of listeners)
			listener()
	}

	function isLinked(): boolean {
		return remoteRevision !== null && remoteRevision === lastDocumentRevision && remoteSnapshot !== null
	}

	function refreshDocumentSnapshot(): boolean {
		const document = session.documentState
		const changed = document.revision !== lastDocumentRevision || document.blueprint !== lastDocumentBlueprint
		if (!changed)
			return false
		const previousBlueprint = lastDocumentBlueprint
		const previousFocus = documentFocus
		lastDocumentRevision = document.revision
		lastDocumentBlueprint = document.blueprint
		// The selected widget survives a commit when the new Document still has it: it is found again by its id and type,
		// and an ambiguous or missing one means the root. A Structure command edits one widget's config and nothing else,
		// so the member stays selected too and several edits can follow each other. Every other commit (JSON Apply, a
		// preset, Undo) can replace the whole tree, so only the widget is kept: a member the user picked may be gone.
		// (Until Lab UX phase 1 those commits always went back to the root, which threw the user out of what they were
		// editing after every Apply.) A showcase switch builds a new store, so it starts at the root.
		const lastPatch = session.lastAppliedSourcePatch
		const fromStructure = lastPatch?.origin === 'structure' && lastPatch.revision === document.revision
		let keptNodeId: InspectionNodeId | null = null
		if (previousFocus !== null) {
			const identity = documentIdentity(previousBlueprint, previousFocus.nodeId)
			// The identity must name one widget on both sides: with a duplicate id+type in the old Document, "the same widget"
			// in the new one could be another instance than the one that was selected.
			const uniqueBefore = identity !== null && uniqueDocumentNodeForIdentity(previousBlueprint, identity) === previousFocus.nodeId
			keptNodeId = uniqueBefore ? uniqueDocumentNodeForIdentity(document.blueprint, identity) : null
		}
		if (keptNodeId === null)
			documentFocusChosen = false
		documentFocus = {
			...(keptNodeId === null
				? rootFocusOf(document.blueprint)
				: { nodeId: keptNodeId, ...(previousFocus?.member === undefined || !fromStructure ? {} : { member: previousFocus.member }) }),
			scope: 'document',
			revision: document.revision,
		}
		return true
	}

	function mapDocumentToPreview(focus: DocumentScopedInspectorFocus | null): PreviewScopedInspectorFocus | null {
		const snapshot = remoteSnapshot
		if (!isLinked() || snapshot === null || focus === null)
			return null
		const identity = documentIdentity(lastDocumentBlueprint, focus.nodeId)
		const remoteNode = identity === null ? null : remoteNodeForIdentity(snapshot, identity)
		if (remoteNode === null)
			return null
		return {
			nodeId: remoteNode.nodeId,
			...(focus.member === undefined ? {} : { member: focus.member }),
			scope: 'preview',
			revision: remoteRevision!,
			runtimeId: snapshot.runtimeId,
		}
	}

	function mapPreviewToDocument(focus: PreviewScopedInspectorFocus | null): DocumentScopedInspectorFocus | null {
		const snapshot = remoteSnapshot
		if (!isLinked() || snapshot === null || focus === null || focus.runtimeId !== snapshot.runtimeId)
			return null
		const identity = remoteIdentity(snapshot, focus.nodeId)
		const nodeId = identity === null ? null : documentNodeForIdentity(lastDocumentBlueprint, identity)
		if (nodeId === null)
			return null
		return {
			nodeId,
			...(focus.member === undefined ? {} : { member: focus.member }),
			scope: 'document',
			revision: lastDocumentRevision,
		}
	}

	const unsubscribeSession = session.subscribe(() => {
		const documentChanged = refreshDocumentSnapshot()
		if (!documentChanged)
			return
		if (isLinked())
			previewFocus = mapDocumentToPreview(documentFocus)
		emit()
	})

	function setPreviewSnapshot(revision: number, snapshot: InspectorBlueprintSnapshot | null): void {
		refreshDocumentSnapshot()
		const previousSnapshot = remoteSnapshot
		const previousFocus = previewFocus
		remoteRevision = snapshot === null ? null : revision
		remoteSnapshot = snapshot
		if (snapshot === null) {
			previewFocus = null
			emit()
			return
		}

		// A reconnect/replacement creates a fresh remote node-id domain. Preserve a prior selection only
		// through stable widget identity; otherwise start from the remote root.
		const previousIdentity = previousSnapshot === null || previousFocus === null
			? null
			: remoteIdentity(previousSnapshot, previousFocus.nodeId)
		const mapped = previousIdentity === null ? null : remoteNodeForIdentity(snapshot, previousIdentity)
		previewFocus = {
			nodeId: mapped?.nodeId ?? snapshot.rootNodeId,
			...(mapped !== null && previousFocus?.member !== undefined ? { member: previousFocus.member } : {}),
			scope: 'preview',
			revision,
			runtimeId: snapshot.runtimeId,
		}

		if (isLinked()) {
			// Document focus is the user's stable cross-surface intent when a new linked remote snapshot lands.
			const fromDocument = mapDocumentToPreview(documentFocus)
			if (fromDocument !== null)
				previewFocus = fromDocument
		}
		emit()
	}

	function setDocumentFocus(focus: InspectorFocus | null): void {
		documentFocus = focus === null
			? null
			: {
					nodeId: focus.nodeId,
					...(focus.member === undefined ? {} : { member: focus.member }),
					scope: 'document',
					revision: lastDocumentRevision,
				}
		documentFocusChosen = documentFocus !== null
		if (isLinked())
			previewFocus = mapDocumentToPreview(documentFocus)
		emit()
	}

	function setPreviewFocus(focus: PreviewInspectorFocus | null): void {
		const snapshot = remoteSnapshot
		previewFocus = focus === null || snapshot === null || remoteRevision === null
			? null
			: {
					nodeId: focus.nodeId,
					...(focus.member === undefined ? {} : { member: focus.member }),
					scope: 'preview',
					revision: remoteRevision,
					runtimeId: snapshot.runtimeId,
				}
		if (isLinked()) {
			documentFocus = mapPreviewToDocument(previewFocus)
			documentFocusChosen = documentFocus !== null
		}
		emit()
	}

	return {
		getFocus: () => documentFocus === null
			? null
			: documentFocus.member === undefined
				? { nodeId: documentFocus.nodeId }
				: { nodeId: documentFocus.nodeId, member: documentFocus.member },
		isDocumentFocusChosen: () => documentFocusChosen && documentFocus !== null,
		getScopedFocus: ((scope: InspectorFocusScope) => scope === 'document' ? documentFocus : previewFocus) as InspectorFocusStore['getScopedFocus'],
		setFocus: ((scopeOrFocus: InspectorFocusScope | InspectorFocus | null, next?: InspectorFocus | PreviewInspectorFocus | null) => {
			if (typeof scopeOrFocus !== 'string') {
				setDocumentFocus(scopeOrFocus)
				return
			}
			if (scopeOrFocus === 'document')
				setDocumentFocus(next as InspectorFocus | null)
			else
				setPreviewFocus(next as PreviewInspectorFocus | null)
		}) as InspectorFocusStore['setFocus'],
		setPreviewSnapshot,
		subscribe: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		dispose: unsubscribeSession,
	}
}
