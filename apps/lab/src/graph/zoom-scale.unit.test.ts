/**
 * The zoom buckets that keep arrowheads and edge text legible: at the lowest zoom of each bucket an arrowhead is at least 12 screen
 * px long and edge text at least 11 screen px, and only a bucket boundary changes what is rendered.
 */

import { describe, expect, it } from 'vitest'
import { ARROW_KINDS, arrowMarkerId, ZOOM_BUCKETS, zoomBucket } from './zoom-scale'

describe('zoomBucket', () => {
	it('keeps an arrowhead at least 12 screen px long and the text at least 11 at any zoom the buckets serve', () => {
		for (let zoom = 0.25; zoom <= 3; zoom += 0.01) {
			const bucket = zoomBucket(zoom)
			expect(bucket.arrow * zoom, `arrowhead at zoom ${zoom.toFixed(2)}`)
				.toBeGreaterThanOrEqual(11.9)
			if (bucket.showTags) {
				expect(bucket.font * zoom, `text at zoom ${zoom.toFixed(2)}`)
					.toBeGreaterThanOrEqual(10.9)
			}
		}
	})

	it('returns the same bucket object for every zoom inside it, so a wheel tick inside one renders nothing new', () => {
		expect(zoomBucket(0.86))
			.toBe(zoomBucket(0.99))
		expect(zoomBucket(0.73))
			.toBe(zoomBucket(0.84))
		expect(zoomBucket(0.8))
			.not
			.toBe(zoomBucket(0.9))
	})

	it('serves the zooms Fit settles on: 0.95 and 0.8 (Survey), 0.37 (Trip budget) and 0.25 (expanded Survey)', () => {
		expect([0.95, 0.8, 0.37, 0.25].map(zoom => zoomBucket(zoom).arrow))
			.toEqual([15, 17, 35, 48])
		// Below 0.3 the tags (long text beside an edge) cannot be legible and are not shown; the dimming and colour remain.
		expect(zoomBucket(0.25).showTags)
			.toBe(false)
		expect(zoomBucket(0.4).showTags)
			.toBe(true)
	})

	it('has one marker id per colour family and bucket, all different', () => {
		const ids = ZOOM_BUCKETS.flatMap(bucket => ARROW_KINDS.map(kind => arrowMarkerId(kind, bucket)))
		expect(new Set(ids).size)
			.toBe(ZOOM_BUCKETS.length * ARROW_KINDS.length)
		expect(ids.every(id => /^[\w-]+$/.test(id)))
			.toBe(true)
	})
})
