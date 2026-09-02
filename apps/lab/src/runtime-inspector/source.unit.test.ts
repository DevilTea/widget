import { describe, expect, it } from 'vitest'
import { LabSession } from '../lab/session'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { getRuntimeInspectorSource } from './source'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText

describe('getRuntimeInspectorSource', () => {
	it('returns the Preview Blueprint and Runtime revision, not the current Document revision', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		await session.applyPreset(invalidSource)

		const source = getRuntimeInspectorSource(session.preview, session.documentState.revision)
		expect(source.blueprint)
			.toBe(session.preview!.blueprint)
		expect(source.runtime)
			.toBe(session.preview!.runtime)
		expect(source.previewRevision)
			.toBe(0)
		expect(source.isStale)
			.toBe(true)
		expect(source.isDiverged)
			.toBe(true)
		expect(source.blueprint)
			.not.toBe(session.documentState.blueprint)
	})

	it('returns no Runtime source when there has never been a valid Preview', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: invalidSource })
		const source = getRuntimeInspectorSource(session.preview, session.documentState.revision)

		expect(source)
			.toEqual({ blueprint: null, runtime: null, previewRevision: null, isStale: false, isDiverged: false })
	})
})
