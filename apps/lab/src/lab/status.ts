/**
 * Plain-language header status: independent facts a newcomer can act on, derived from state the Lab
 * already owns, and the one status chip the header shows for them (Lab UX phase 3). Revision numbers and the
 * Linked/Diverged vocabulary stay available as developer details (`LabRevisionStatus`), but are not what the
 * primary status says.
 *
 * - Validity: is the committed Document free of problems? Core's diagnostics, counted.
 * - Preview: does the Preview show that Document, or the last valid version before it? A Preview frame that
 *   failed to load or lost its connection (audit U22) is `failed`, whatever revisions the Lab holds.
 * - JSON: does the JSON view's text parse? While it does not, nothing is committed from it (`syntax-error`).
 *   A text that parses is committed shortly after typing stops, so there is no other "draft" state.
 *
 * `chip` is what the header says, one state at a time, the first that holds:
 * 1. `syntax-error`: the JSON text does not parse, so the user's latest edit is not in the Document at all;
 * 2. `problems`: the Document has problems, so the Preview shows the last working version (or none);
 * 3. `preview-unavailable`: the frame failed, or no valid version was ever promoted;
 * 4. `updating`: a valid Document is being promoted (a commit is running);
 * 5. `stale`: a valid Document the Preview has not caught up with, and nothing running (a promotion that failed while the
 *    old Runtime survived);
 * 6. `restarted`: shortly after a commit replaced the Runtime (`previewRestarted`, timed by the store);
 * 7. `up-to-date`.
 */

import type { LabRevisionStatus } from './revisions'

export type ValidityStatus
	= | { readonly kind: 'valid' }
		| { readonly kind: 'problems', readonly count: number }

export type PreviewStatus = 'current' | 'stale' | 'unavailable' | 'failed'

/** `syntax-error`: the JSON view's text does not parse (`LabSession.parseError`). */
export type JsonTextStatus = 'parses' | 'syntax-error'

export type StatusChip
	= | { readonly kind: 'syntax-error' }
		| { readonly kind: 'problems', readonly count: number, readonly previewShown: boolean }
		| { readonly kind: 'preview-unavailable' }
		| { readonly kind: 'updating' }
		| { readonly kind: 'stale' }
		| { readonly kind: 'restarted' }
		| { readonly kind: 'up-to-date' }

export interface LabStatus {
	readonly validity: ValidityStatus
	readonly preview: PreviewStatus
	readonly json: JsonTextStatus
	readonly chip: StatusChip
}

export interface LabStatusInput {
	readonly blueprintStatus: 'valid' | 'invalid'
	readonly diagnosticCount: number
	/** The JSON view's text does not parse. */
	readonly hasParseError: boolean
	readonly revisions: Pick<LabRevisionStatus, 'previewRevision' | 'isLinked'>
	/** The Preview frame reported a failure (did not load, or closed by itself) that has not been retried successfully. */
	readonly previewFailed?: boolean
	/** A lifecycle command (a commit, Undo, a retry) is running. */
	readonly isApplying?: boolean
	/** A commit replaced the Runtime a moment ago. */
	readonly previewRestarted?: boolean
}

function deriveChip(input: LabStatusInput, validity: ValidityStatus, preview: PreviewStatus): StatusChip {
	if (input.hasParseError)
		return { kind: 'syntax-error' }
	if (validity.kind === 'problems')
		return { kind: 'problems', count: validity.count, previewShown: preview === 'stale' || preview === 'current' }
	if (preview === 'failed' || preview === 'unavailable')
		return { kind: 'preview-unavailable' }
	if (preview === 'stale')
		return input.isApplying === true ? { kind: 'updating' } : { kind: 'stale' }
	return input.previewRestarted === true ? { kind: 'restarted' } : { kind: 'up-to-date' }
}

export function deriveLabStatus(input: LabStatusInput): LabStatus {
	const validity: ValidityStatus = input.blueprintStatus === 'valid'
		? { kind: 'valid' }
		// An invalid Blueprint always has at least one diagnostic; `max` keeps the chip honest if that ever changed.
		: { kind: 'problems', count: Math.max(1, input.diagnosticCount) }
	const preview: PreviewStatus = input.previewFailed === true
		? 'failed'
		: input.revisions.previewRevision === null
			? 'unavailable'
			: input.revisions.isLinked ? 'current' : 'stale'
	const json: JsonTextStatus = input.hasParseError ? 'syntax-error' : 'parses'
	return { validity, preview, json, chip: deriveChip(input, validity, preview) }
}
