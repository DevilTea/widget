/**
 * Plain-language header status: two independent facts a newcomer can act on, derived from state the Lab
 * already owns. Revision numbers and the Linked/Diverged vocabulary stay available as developer details
 * (`LabRevisionStatus`), but are no longer what the primary status says.
 *
 * - Validity: is the Document the user last applied (or the last Apply attempt) free of problems? A JSON
 *   syntax error of the last Apply counts as one problem, because no Document was committed from that text.
 * - Preview: does the Preview show that Document, or the last valid version before it? A Preview frame that
 *   failed to load or lost its connection (audit U22) is `failed`, whatever revisions the Lab holds.
 */

import type { LabRevisionStatus } from './revisions'

export type ValidityStatus
	= | { readonly kind: 'valid' }
		| { readonly kind: 'problems', readonly count: number }

export type PreviewStatus = 'current' | 'stale' | 'unavailable' | 'failed'

export interface LabStatus {
	readonly validity: ValidityStatus
	readonly preview: PreviewStatus
}

export interface LabStatusInput {
	readonly blueprintStatus: 'valid' | 'invalid'
	readonly diagnosticCount: number
	readonly hasParseError: boolean
	readonly revisions: Pick<LabRevisionStatus, 'previewRevision' | 'isLinked'>
	/** The Preview frame reported a failure (did not load, or closed by itself) that has not been retried successfully. */
	readonly previewFailed?: boolean
}

export function deriveLabStatus(input: LabStatusInput): LabStatus {
	const count = input.diagnosticCount + (input.hasParseError ? 1 : 0)
	const validity: ValidityStatus = input.blueprintStatus === 'valid' && !input.hasParseError
		? { kind: 'valid' }
		// An invalid Blueprint always has at least one diagnostic; `max` keeps the chip honest if that ever changed.
		: { kind: 'problems', count: Math.max(1, count) }
	const preview: PreviewStatus = input.previewFailed === true
		? 'failed'
		: input.revisions.previewRevision === null
			? 'unavailable'
			: input.revisions.isLinked ? 'current' : 'stale'
	return { validity, preview }
}
