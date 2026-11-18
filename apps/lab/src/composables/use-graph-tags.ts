/**
 * The focus tags of the Graph ("Depends on #sessions", "Used by #phone") for the current edges, cards and zoom, as a computed.
 *
 * Vue Flow replaces `viewport` on every wheel tick and every pan step, so the zoom is first reduced to its bucket
 * (`graph/zoom-scale.ts`): the placement depends on that object, which stays the same inside a bucket, and is only run again
 * when the graph, the focus, the cards or the bucket change. Below the zoom where text cannot be legible no tag is placed. Tags
 * stay inside the content bounds (cards and curves), which is all that Fit shows.
 */

import type { ComputedRef } from 'vue'
import type { TagInput, TagPlacement, TagRect } from '../graph/tag-placement'
import type { GraphFlowEdge } from '../graph/vue-flow'
import { computed } from 'vue'
import { contentBounds, placeTags } from '../graph/tag-placement'
import { zoomBucket } from '../graph/zoom-scale'

export interface GraphTagsOptions {
	readonly edges: () => readonly GraphFlowEdge[]
	/** The cards a tag must not cover, by their top-left corner in canvas px. */
	readonly cards: () => readonly TagRect[]
	readonly zoom: () => number
	/** The words of one tag, translated: what the edge is to the focus and the name of the other end. */
	readonly text: (relation: 'depends-on' | 'used-by', otherEnd: string) => string
	/** The placement itself; only a test replaces it, to count how often it runs. */
	readonly place?: typeof placeTags
}

export function useGraphTags(options: GraphTagsOptions): ComputedRef<ReadonlyMap<string, TagPlacement>> {
	const place = options.place ?? placeTags
	const bucket = computed(() => zoomBucket(options.zoom()))
	return computed(() => {
		const { font, arrow, showTags } = bucket.value
		const tags: TagInput[] = options.edges()
			.filter(edge => edge.data?.relation !== undefined && edge.data.route !== undefined)
			.map(edge => ({
				id: edge.id,
				route: edge.data!.route!,
				relation: edge.data!.relation!,
				text: options.text(edge.data!.relation!, edge.data!.otherEnd ?? ''),
			}))
		if (!showTags || tags.length === 0)
			return new Map<string, TagPlacement>()
		const cards = options.cards()
		const all = options.edges()
			.filter(edge => edge.data?.route !== undefined)
		return place(tags, cards, { font, arrow }, {
			// What Fit shows: a tag outside it would be cut off by the pane.
			bounds: contentBounds(cards, all.map(edge => edge.data!.route!)),
			// The arrowheads of the dimmed edges stay uncovered too.
			otherRoutes: all.filter(edge => edge.data!.relation === undefined)
				.map(edge => edge.data!.route!),
		})
	})
}
