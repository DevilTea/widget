import { describe, expect, it } from 'vitest'
import { getLabRevisionStatus } from './revisions'
import { deriveLabStatus } from './status'

function status(options: { blueprint: 'valid' | 'invalid', diagnostics?: number, parseError?: boolean, document: number, preview: number | null, previewFailed?: boolean }) {
	return deriveLabStatus({
		blueprintStatus: options.blueprint,
		diagnosticCount: options.diagnostics ?? 0,
		hasParseError: options.parseError ?? false,
		revisions: getLabRevisionStatus(options.document, options.preview),
		previewFailed: options.previewFailed,
	})
}

describe('deriveLabStatus', () => {
	it('is valid with an up-to-date preview for a clean, promoted Document', () => {
		expect(status({ blueprint: 'valid', document: 3, preview: 3 }))
			.toEqual({ validity: { kind: 'valid' }, preview: 'current' })
	})

	it('counts the Blueprint diagnostics as problems and reports the preview as the last valid version', () => {
		expect(status({ blueprint: 'invalid', diagnostics: 5, document: 1, preview: 0 }))
			.toEqual({ validity: { kind: 'problems', count: 5 }, preview: 'stale' })
		expect(status({ blueprint: 'invalid', diagnostics: 1, document: 2, preview: 0 }).validity)
			.toEqual({ kind: 'problems', count: 1 })
	})

	it('counts a JSON syntax error of the last Apply as one more problem, even for a valid Document', () => {
		expect(status({ blueprint: 'valid', parseError: true, document: 0, preview: 0 }))
			.toEqual({ validity: { kind: 'problems', count: 1 }, preview: 'current' })
		expect(status({ blueprint: 'invalid', diagnostics: 2, parseError: true, document: 1, preview: 0 }).validity)
			.toEqual({ kind: 'problems', count: 3 })
	})

	it('reports an unavailable preview when no valid Document was ever promoted', () => {
		expect(status({ blueprint: 'invalid', diagnostics: 2, document: 0, preview: null }))
			.toEqual({ validity: { kind: 'problems', count: 2 }, preview: 'unavailable' })
	})

	it('reports a Preview frame that failed as failed, whatever revisions the Lab holds', () => {
		expect(status({ blueprint: 'valid', document: 0, preview: 0, previewFailed: true }))
			.toEqual({ validity: { kind: 'valid' }, preview: 'failed' })
		expect(status({ blueprint: 'valid', document: 0, preview: null, previewFailed: true }).preview)
			.toBe('failed')
		expect(status({ blueprint: 'valid', document: 0, preview: 0, previewFailed: false }).preview)
			.toBe('current')
	})

	it('never reports zero problems for an invalid Blueprint', () => {
		expect(status({ blueprint: 'invalid', diagnostics: 0, document: 1, preview: 1 }).validity)
			.toEqual({ kind: 'problems', count: 1 })
	})
})
