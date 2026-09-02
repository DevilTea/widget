/**
 * Revision-scoped inspector focus (Blueprint / Graph / Runtime / Preview).
 *
 * `InspectionNodeId` is snapshot-local. The Lab therefore keeps a Document focus and a Preview focus
 * separately, each tagged with the revision whose Blueprint produced the id. The two focuses are copied
 * only while the Document and Preview revisions are equal; a diverged Preview never receives a raw nodeId
 * from the current Document, and vice versa.
 */

import type { AnyWidgetPluginTuple, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { LabSession } from './session'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export type InspectorFocusScope = 'document' | 'preview'

export type InspectorFocusMember
	= | { readonly type: 'state', readonly name: string }
		| { readonly type: 'property', readonly name: string }
		| { readonly type: 'method', readonly name: string }

/** Snapshot-local node/member payload. The scope and revision live in `ScopedInspectorFocus`. */
export interface InspectorFocus {
	readonly nodeId: InspectionNodeId
	readonly member?: InspectorFocusMember
}

/** A focus payload that is safe to pass only to the matching Blueprint/Runtime snapshot. */
export interface ScopedInspectorFocus extends InspectorFocus {
	readonly scope: InspectorFocusScope
	readonly revision: number
}

export interface InspectorFocusStore {
	getFocus: (scope?: InspectorFocusScope) => InspectorFocus | null
	getScopedFocus: (scope: InspectorFocusScope) => ScopedInspectorFocus | null
	/** Explicit diagnostic-navigation commands and panel row selection call this overload. */
	setFocus: {
		(scope: InspectorFocusScope, focus: InspectorFocus | null): void
		/** @deprecated Document scope compatibility for existing tutorial/consumer calls. */
		(focus: InspectorFocus | null): void
	}
	subscribe: (listener: () => void) => () => void
	/** Stops listening to the underlying `LabSession`. Call when the store itself is torn down. */
	dispose: () => void
}

function rootFocusOf<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>): InspectorFocus {
	return { nodeId: inspectBlueprint(blueprint).rootNodeId }
}

function scopedFocusOf(scope: InspectorFocusScope, revision: number, focus: InspectorFocus): ScopedInspectorFocus {
	return { ...focus, scope, revision }
}

/**
 * Keeps each focus attached to its own snapshot. A changed Document always gets a new Document root;
 * a replaced Preview gets a new Preview root. An invalid Document commit changes only the Document
 * scope, so the previous Preview focus remains valid for the still-running Runtime.
 */
export function createInspectorFocusStore<Plugins extends AnyWidgetPluginTuple>(
	session: LabSession<Plugins>,
): InspectorFocusStore {
	const listeners = new Set<() => void>()
	let lastDocumentRevision = session.documentState.revision
	let lastDocumentBlueprint = session.documentState.blueprint
	let lastPreviewRevision = session.preview?.revision ?? null
	let lastPreviewBlueprint = session.preview?.blueprint ?? null
	let documentFocus: ScopedInspectorFocus | null = scopedFocusOf(
		'document',
		lastDocumentRevision,
		rootFocusOf(lastDocumentBlueprint),
	)
	let previewFocus: ScopedInspectorFocus | null = session.preview === null
		? null
		: scopedFocusOf('preview', lastPreviewRevision!, rootFocusOf(lastPreviewBlueprint!))

	function emit(): void {
		for (const listener of listeners) listener()
	}

	function isLinked(): boolean {
		return lastPreviewRevision !== null && lastPreviewRevision === lastDocumentRevision
	}

	const unsubscribeSession = session.subscribe(() => {
		const document = session.documentState
		const preview = session.preview
		const documentChanged = document.revision !== lastDocumentRevision || document.blueprint !== lastDocumentBlueprint
		const previewRevision = preview?.revision ?? null
		const previewChanged = previewRevision !== lastPreviewRevision || preview?.blueprint !== lastPreviewBlueprint

		if (!documentChanged && !previewChanged)
			return

		lastDocumentRevision = document.revision
		lastDocumentBlueprint = document.blueprint
		lastPreviewRevision = previewRevision
		lastPreviewBlueprint = preview?.blueprint ?? null

		if (documentChanged) {
			documentFocus = scopedFocusOf('document', document.revision, rootFocusOf(document.blueprint))
		}
		if (previewChanged) {
			previewFocus = preview === null
				? null
				: scopedFocusOf('preview', preview.revision, rootFocusOf(preview.blueprint))
		}

		// Equality is the only safe implicit mapping boundary: both scopes use the same committed Blueprint
		// revision and therefore the same InspectionNodeId domain.
		if (isLinked() && previewChanged) {
			documentFocus = previewFocus === null
				? null
				: scopedFocusOf('document', lastDocumentRevision, previewFocus)
		}

		emit()
	})

	function getScopedFocus(scope: InspectorFocusScope): ScopedInspectorFocus | null {
		return scope === 'document' ? documentFocus : previewFocus
	}

	function setFocus(scopeOrFocus: InspectorFocusScope | InspectorFocus | null, next?: InspectorFocus | null): void {
		const scope: InspectorFocusScope = typeof scopeOrFocus === 'string' ? scopeOrFocus : 'document'
		const focus = typeof scopeOrFocus === 'string' ? next ?? null : scopeOrFocus
		const revision = scope === 'document' ? lastDocumentRevision : lastPreviewRevision
		const scoped = focus === null || revision === null ? null : scopedFocusOf(scope, revision, focus)

		if (scope === 'document')
			documentFocus = scoped
		else
			previewFocus = scoped

		// Null is synchronized too: linked surfaces represent one selection, including clearing it.
		if (isLinked()) {
			if (scope === 'document')
				previewFocus = scoped === null ? null : scopedFocusOf('preview', lastPreviewRevision!, scoped)
			else
				documentFocus = scoped === null ? null : scopedFocusOf('document', lastDocumentRevision, scoped)
		}
		emit()
	}

	return {
		getFocus: (scope = 'document') => {
			const scoped = getScopedFocus(scope)
			if (scoped === null)
				return null
			return scoped.member === undefined
				? { nodeId: scoped.nodeId }
				: { nodeId: scoped.nodeId, member: scoped.member }
		},
		getScopedFocus,
		setFocus,
		subscribe: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		dispose: unsubscribeSession,
	}
}
