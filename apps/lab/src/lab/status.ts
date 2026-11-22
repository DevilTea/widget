/**
 * Plain-language header status: independent facts a newcomer can act on, derived from state the Lab
 * already owns, and the one status chip the header shows for them (Lab UX phase 3). Revision numbers and the
 * Linked/Diverged vocabulary stay available as developer details (`LabRevisionStatus`), but are not what the
 * primary status says.
 *
 * - Validity: is the committed Document free of problems? Core's diagnostics, counted.
 * - Preview: does the Preview show that Document, or the last valid version before it? A Preview frame that
 *   failed to load or lost its connection (audit U22) is `failed`, whatever revisions the Lab holds.
 * - JSON: can the JSON view's text be applied? Not while it does not parse (`syntax-error`) or while Core refused a commit of
 *   exactly this text (`commit-refused`, e.g. `1e400`; `LabJsonBlock`). A text that can be applied is committed shortly after
 *   typing stops, so there is no other "draft" state.
 *
 * `chip` is what the header says, one state at a time, the first that holds:
 * 1. `json-not-applied`: the JSON text cannot be applied (a syntax error, or a commit Core refused, with its reason), so the
 *    user's latest edit is not in the Document at all;
 * 2. `problems`: the Document has problems, so the Preview shows the last working version (or none);
 * 3. `preview-unavailable`: the frame failed, or no valid version was ever promoted;
 * 4. `updating`: a valid Document is being promoted (a commit is running);
 * 5. `stale`: a valid Document the Preview has not caught up with, and nothing running (a promotion that failed while the
 *    old Runtime survived);
 * 6. `restarted`: shortly after a commit replaced the Runtime (`previewRestarted`, timed by the store);
 * 7. `up-to-date`.
 */

import type { LabRevisionStatus } from './revisions'
import type { LabJsonBlock } from './types'

export type ValidityStatus
	= | { readonly kind: 'valid' }
		| { readonly kind: 'problems', readonly count: number }

export type PreviewStatus = 'current' | 'stale' | 'unavailable' | 'failed'

/** Whether the JSON view's text can be applied (`LabSession.jsonBlock`): it does not parse, or Core refused this text. */
export type JsonTextStatus = 'ok' | 'syntax-error' | 'commit-refused'

export type StatusChip
	= | { readonly kind: 'json-not-applied', readonly reason: 'syntax' }
		| { readonly kind: 'json-not-applied', readonly reason: 'commit', readonly detail: string }
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
	/** Why the JSON view's text cannot be applied, or `null` (`LabSession.jsonBlock`). */
	readonly jsonBlock: LabJsonBlock | null
	readonly revisions: Pick<LabRevisionStatus, 'previewRevision' | 'isLinked'>
	/** The Preview frame reported a failure (did not load, or closed by itself) that has not been retried successfully. */
	readonly previewFailed?: boolean
	/** A lifecycle command (a commit, Undo, a retry) is running. */
	readonly isApplying?: boolean
	/** A commit replaced the Runtime a moment ago. */
	readonly previewRestarted?: boolean
}

function deriveChip(input: LabStatusInput, validity: ValidityStatus, preview: PreviewStatus): StatusChip {
	const block = input.jsonBlock
	if (block !== null) {
		// The reason is Core's own token for it (`non-finite-number`, `max-depth-exceeded`), else its failure code: verbatim.
		return block.kind === 'syntax'
			? { kind: 'json-not-applied', reason: 'syntax' }
			: { kind: 'json-not-applied', reason: 'commit', detail: ('reason' in block.failure && block.failure.reason !== undefined) ? String(block.failure.reason) : block.failure.code }
	}
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
	const json: JsonTextStatus = input.jsonBlock === null ? 'ok' : input.jsonBlock.kind === 'syntax' ? 'syntax-error' : 'commit-refused'
	return { validity, preview, json, chip: deriveChip(input, validity, preview) }
}

/** How long a chip state must hold before the live region announces it, by default. */
export const ANNOUNCE_AFTER_MS = 1000
/** While the JSON editor has focus, a JSON that cannot be applied is announced only once typing has paused this long (or at blur). */
export const ANNOUNCE_JSON_ERROR_AFTER_TYPING_MS = 1500

/**
 * When the header's polite live region announces the status chip (Lab UX phase 3 review): `null` means say nothing (and clear
 * what was said); otherwise announce after `delayMs`, restarted by every change of the chip or of the JSON text.
 * - "Up to date" is the quiet state: nothing.
 * - "Preview restarted" while the user types in the JSON editor would follow every typing pause: nothing then.
 * - JSON that cannot be applied flips with nearly every keystroke: announced once typing has paused, or at once on blur.
 * - Problems, an unavailable or lagging Preview: announced once the state has held for a moment.
 */
export function announcementDelay(chip: StatusChip, jsonEditorFocused: boolean): number | null {
	switch (chip.kind) {
		case 'up-to-date': return null
		case 'restarted': return jsonEditorFocused ? null : ANNOUNCE_AFTER_MS
		case 'json-not-applied': return jsonEditorFocused ? ANNOUNCE_JSON_ERROR_AFTER_TYPING_MS : 0
		default: return ANNOUNCE_AFTER_MS
	}
}
