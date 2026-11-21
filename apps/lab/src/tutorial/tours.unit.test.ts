import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { isPreviewHostDescriptor, parsePreviewHostRequest } from '../preview-host/protocol'
import { getShowcase } from '../showcases/registry'
import { DEFAULT_TOUR_ID, getTour, TOUR_IDS, tourForShowcase, tours } from './tours'

describe('tours', () => {
	it('has one tour per showcase that teaches, under the showcase id, with a default preset the showcase has', () => {
		expect(tours.map(tour => tour.id))
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding', 'document-repair'])
		for (const tour of tours) {
			expect(tour.script.id)
				.toBe(tour.id)
			const showcase = getShowcase(tour.id)
			expect(showcase, tour.id)
				.toBeDefined()
			expect(showcase?.defaultPreset.id, tour.id)
				.toBe(tour.defaultPresetId)
			expect(showcase?.hidden, tour.id)
				.toBeUndefined()
		}
	})

	it('picks the showcase\'s own tour, and the default tour for a showcase without one', () => {
		expect(tourForShowcase('trip-budget').id)
			.toBe('trip-budget')
		expect(tourForShowcase('quote-rules').id)
			.toBe('quote-rules')
		expect(tourForShowcase('onboarding').id)
			.toBe('onboarding')
		expect(tourForShowcase('document-repair').id)
			.toBe('document-repair')
		expect(tourForShowcase('survey').id)
			.toBe('survey')
		expect(tourForShowcase('sandbox').id)
			.toBe(DEFAULT_TOUR_ID)
		expect(DEFAULT_TOUR_ID)
			.toBe('survey')
		expect(getTour('sandbox'))
			.toBeUndefined()
	})

	it('has a zh-TW confirmation message for every tour', () => {
		for (const tour of tours) {
			expect(translatePresentationMessage('zh-TW', tour.startConfirmMessage), tour.id)
				.not
				.toBe(tour.startConfirmMessage)
		}
	})

	it('is what the host protocol accepts as a tour id', () => {
		expect(TOUR_IDS)
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding', 'document-repair'])
		const request = (tourId: string): unknown => ({ protocol: 1, kind: 'tutorial.evaluate', requestId: 'r', tourId, stepIndex: 0, progress: 0 })
		expect(parsePreviewHostRequest(request('trip-budget')))
			.not
			.toBeNull()
		expect(parsePreviewHostRequest(request('survey')))
			.not
			.toBeNull()
		expect(parsePreviewHostRequest(request('quote-rules')))
			.not
			.toBeNull()
		expect(parsePreviewHostRequest(request('onboarding')))
			.not
			.toBeNull()
		expect(parsePreviewHostRequest(request('document-repair')))
			.not
			.toBeNull()
		expect(parsePreviewHostRequest(request('sandbox')))
			.toBeNull()
		expect(parsePreviewHostRequest(request('')))
			.toBeNull()
		expect(isPreviewHostDescriptor({ showcaseId: 'trip-budget', revision: 0, sourceText: '{}' }))
			.toBe(true)
	})
})
