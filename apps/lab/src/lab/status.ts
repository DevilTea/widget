/**
 * Plain-language header status: independent facts a newcomer can act on, derived from state the Lab
 * already owns. Revision numbers and the Linked/Diverged vocabulary stay available as developer details
 * (`LabRevisionStatus`), but are no longer what the primary status says.
 *
 * - Validity: is the Document the user last applied (or the last Apply attempt) free of problems? A JSON
 *   syntax error of the last Apply counts as one problem, because no Document was committed from that text.
 * - Preview: does the Preview show that Document, or the last valid version before it? A Preview frame that
 *   failed to load or lost its connection (audit U22) is `failed`, whatever revisions the Lab holds.
 * - Draft: does the JSON draft differ from the committed Document? Neither the Document nor the Preview shows
 *   such a draft, so the header says so, and a `current` Preview must not be called "up to date" while it exists.
 *   Validity and Preview stay facts about the committed Document: typing changes neither.
 */

import type { LabRevisionStatus } from './revisions'

export type ValidityStatus
	= | { readonly kind: 'valid' }
		| { readonly kind: 'problems', readonly count: number }

export type PreviewStatus = 'current' | 'stale' | 'unavailable' | 'failed'

/** `unapplied`: the JSON draft differs from the committed Document (`LabSession.isDirty`). */
export type DraftStatus = 'clean' | 'unapplied'

export interface LabStatus {
	readonly validity: ValidityStatus
	readonly preview: PreviewStatus
	readonly draft: DraftStatus
}

export interface LabStatusInput {
	readonly blueprintStatus: 'valid' | 'invalid'
	readonly diagnosticCount: number
	readonly hasParseError: boolean
	readonly revisions: Pick<LabRevisionStatus, 'previewRevision' | 'isLinked'>
	/** The Preview frame reported a failure (did not load, or closed by itself) that has not been retried successfully. */
	readonly previewFailed?: boolean
	/** The JSON draft differs from the committed Document (`LabSession.isDirty`). */
	readonly hasUnappliedDraft?: boolean
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
	const draft: DraftStatus = input.hasUnappliedDraft === true ? 'unapplied' : 'clean'
	return { validity, preview, draft }
}
