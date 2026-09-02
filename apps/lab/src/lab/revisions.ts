/**
 * Pure status calculation for the authored Document revision and the Runtime-backed Preview revision.
 * A missing Preview is intentionally `unlinked`, while an older valid Preview is `diverged`: both are
 * visible states, but only equal revisions are allowed to share snapshot-local focus.
 */

export type LabRevisionLinkState = 'linked' | 'diverged' | 'unlinked'

export interface LabRevisionStatus {
	readonly documentRevision: number
	readonly previewRevision: number | null
	readonly state: LabRevisionLinkState
	readonly isLinked: boolean
	readonly isDiverged: boolean
	readonly isPreviewStale: boolean
}

export function getLabRevisionStatus(
	documentRevision: number,
	previewRevision: number | null,
): LabRevisionStatus {
	const isLinked = previewRevision !== null && previewRevision === documentRevision
	const isPreviewStale = previewRevision !== null && previewRevision < documentRevision
	const state: LabRevisionLinkState = isLinked
		? 'linked'
		: previewRevision === null ? 'unlinked' : 'diverged'

	return {
		documentRevision,
		previewRevision,
		state,
		isLinked,
		isDiverged: state === 'diverged',
		isPreviewStale,
	}
}
