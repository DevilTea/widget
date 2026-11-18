/**
 * How the Graph keeps its arrowheads and edge text legible at any zoom without re-rendering on every wheel tick.
 *
 * An arrowhead and the text of an edge are drawn in canvas px, so Fit on a big graph (0.3 zoom) would shrink an 11px label to
 * 3px and a 12px arrowhead to 4px. The zoom is therefore cut into a few buckets; each bucket has an arrowhead length and a
 * font size chosen so that, at the lowest zoom of the bucket, the arrowhead is at least 12 screen px long and the text at least
 * 11. Only crossing a bucket boundary changes anything the edges render, so a wheel tick inside a bucket costs nothing.
 */

export interface ZoomBucket {
	/** The lowest zoom (inclusive) this bucket serves. */
	readonly min: number
	/** The length of an arrowhead in canvas px. */
	readonly arrow: number
	/** The font size of edge text in canvas px. */
	readonly font: number
	/** Whether the focus tags (long text next to an edge) are shown: below this zoom they cannot be legible. */
	readonly showTags: boolean
}

/** From the highest zoom down; the last one serves everything below it. */
export const ZOOM_BUCKETS: readonly ZoomBucket[] = [
	{ min: 1, arrow: 12, font: 11, showTags: true },
	{ min: 0.85, arrow: 15, font: 13, showTags: true },
	{ min: 0.72, arrow: 17, font: 16, showTags: true },
	{ min: 0.6, arrow: 20, font: 19, showTags: true },
	{ min: 0.5, arrow: 24, font: 22, showTags: true },
	{ min: 0.42, arrow: 29, font: 27, showTags: true },
	{ min: 0.35, arrow: 35, font: 32, showTags: true },
	{ min: 0.3, arrow: 40, font: 37, showTags: true },
	{ min: 0, arrow: 48, font: 46, showTags: false },
]

export function zoomBucket(zoom: number): ZoomBucket {
	return ZOOM_BUCKETS.find(bucket => zoom >= bucket.min) ?? ZOOM_BUCKETS.at(-1)!
}

/** Colour families of an arrowhead; the stroke it ends is styled by the same name in `GraphCanvas.vue`. */
export const ARROW_KINDS = ['muted', 'writes', 'invokes', 'danger', 'accent'] as const
export type GraphArrowKind = typeof ARROW_KINDS[number]

/** The id of the `<marker>` `GraphCanvas.vue` defines for one colour family and zoom bucket. */
export function arrowMarkerId(kind: GraphArrowKind, bucket: ZoomBucket): string {
	return `graph-arrow-${kind}-${bucket.min * 100}`
}
