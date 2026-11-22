import { describe, expect, it } from 'vitest'
import { getLabRevisionStatus } from './revisions'
import { announcementDelay, deriveLabStatus } from './status'

function status(options: { blueprint: 'valid' | 'invalid', diagnostics?: number, parseError?: boolean, document: number, preview: number | null, previewFailed?: boolean, applying?: boolean, restarted?: boolean }) {
	return deriveLabStatus({
		blueprintStatus: options.blueprint,
		diagnosticCount: options.diagnostics ?? 0,
		jsonBlock: options.parseError === true ? { kind: 'syntax', error: { message: 'x', sourceText: '{' } } : null,
		revisions: getLabRevisionStatus(options.document, options.preview),
		previewFailed: options.previewFailed,
		isApplying: options.applying,
		previewRestarted: options.restarted,
	})
}

describe('deriveLabStatus', () => {
	it('is valid and up to date for a promoted Document whose JSON parses', () => {
		expect(status({ blueprint: 'valid', document: 3, preview: 3 }))
			.toEqual({ validity: { kind: 'valid' }, preview: 'current', json: 'ok', chip: { kind: 'up-to-date' } })
	})

	it('counts the Blueprint diagnostics as problems and says the preview shows the last working version', () => {
		expect(status({ blueprint: 'invalid', diagnostics: 5, document: 1, preview: 0 }))
			.toEqual({ validity: { kind: 'problems', count: 5 }, preview: 'stale', json: 'ok', chip: { kind: 'problems', count: 5, previewShown: true } })
	})

	it('says when there is no preview to fall back to', () => {
		expect(status({ blueprint: 'invalid', diagnostics: 2, document: 0, preview: null }).chip)
			.toEqual({ kind: 'problems', count: 2, previewShown: false })
		expect(status({ blueprint: 'invalid', diagnostics: 2, document: 3, preview: 1, previewFailed: true }).chip)
			.toEqual({ kind: 'problems', count: 2, previewShown: false })
	})

	// Lab UX phase 3: a syntax error is no longer "one more problem of the last Apply"; it is the JSON text's own state, and
	// the Document's validity does not count it, since nothing was committed from that text.
	it('puts a JSON syntax error first and keeps it out of the Document validity', () => {
		expect(status({ blueprint: 'valid', parseError: true, document: 0, preview: 0 }))
			.toEqual({ validity: { kind: 'valid' }, preview: 'current', json: 'syntax-error', chip: { kind: 'json-not-applied', reason: 'syntax' } })
		expect(status({ blueprint: 'invalid', diagnostics: 2, parseError: true, document: 1, preview: 0 }).chip)
			.toEqual({ kind: 'json-not-applied', reason: 'syntax' })
		expect(status({ blueprint: 'invalid', diagnostics: 2, parseError: true, document: 1, preview: 0 }).validity)
			.toEqual({ kind: 'problems', count: 2 })
	})

	it('reports an unavailable preview when no valid Document was ever promoted, or the frame failed', () => {
		expect(status({ blueprint: 'valid', document: 0, preview: null }).chip)
			.toEqual({ kind: 'preview-unavailable' })
		expect(status({ blueprint: 'valid', document: 0, preview: 0, previewFailed: true }))
			.toEqual({ validity: { kind: 'valid' }, preview: 'failed', json: 'ok', chip: { kind: 'preview-unavailable' } })
		expect(status({ blueprint: 'valid', document: 0, preview: 0, previewFailed: false }).preview)
			.toBe('current')
	})

	it('says the preview is updating while a valid commit is promoted, and stale when nothing is running', () => {
		expect(status({ blueprint: 'valid', document: 2, preview: 1, applying: true }).chip)
			.toEqual({ kind: 'updating' })
		expect(status({ blueprint: 'valid', document: 2, preview: 1 }).chip)
			.toEqual({ kind: 'stale' })
	})

	it('says "Preview restarted" only while the store flags it and nothing else needs saying', () => {
		expect(status({ blueprint: 'valid', document: 2, preview: 2, restarted: true }).chip)
			.toEqual({ kind: 'restarted' })
		expect(status({ blueprint: 'valid', parseError: true, document: 2, preview: 2, restarted: true }).chip)
			.toEqual({ kind: 'json-not-applied', reason: 'syntax' })
		expect(status({ blueprint: 'invalid', diagnostics: 1, document: 3, preview: 2, restarted: true }).chip.kind)
			.toBe('problems')
	})

	it('never reports zero problems for an invalid Blueprint', () => {
		expect(status({ blueprint: 'invalid', diagnostics: 0, document: 1, preview: 1 }).validity)
			.toEqual({ kind: 'problems', count: 1 })
	})
	it('puts JSON that Core refused (a commit failure of the current text) first too, naming Core\'s reason', () => {
		const refused = deriveLabStatus({
			blueprintStatus: 'valid',
			diagnosticCount: 0,
			jsonBlock: { kind: 'commit', sourceText: '1e400', failure: { code: 'json-incompatible-value', operationIndex: 0, message: 'outside', path: [], reason: 'non-finite-number' } },
			revisions: getLabRevisionStatus(0, 0),
		})
		expect(refused.chip)
			.toEqual({ kind: 'json-not-applied', reason: 'commit', detail: 'non-finite-number' })
		expect(refused.json)
			.toBe('commit-refused')
	})
})

describe('announcementDelay (what the live region says, and when)', () => {
	it('says nothing for Up to date, and nothing for Preview restarted while the JSON editor has focus', () => {
		expect(announcementDelay({ kind: 'up-to-date' }, false))
			.toBeNull()
		expect(announcementDelay({ kind: 'restarted' }, true))
			.toBeNull()
		expect(announcementDelay({ kind: 'restarted' }, false))
			.toBe(1000)
	})

	it('announces JSON that cannot be applied after a typing pause while editing, at once otherwise; problems after a moment', () => {
		expect(announcementDelay({ kind: 'json-not-applied', reason: 'syntax' }, true))
			.toBe(1500)
		expect(announcementDelay({ kind: 'json-not-applied', reason: 'syntax' }, false))
			.toBe(0)
		expect(announcementDelay({ kind: 'problems', count: 2, previewShown: true }, true))
			.toBe(1000)
		expect(announcementDelay({ kind: 'preview-unavailable' }, false))
			.toBe(1000)
	})
})
