import type { ComputedRef, InjectionKey } from 'vue'
import type { TagPlacement } from '../../graph/tag-placement'

/**
 * The focus tags that fit, by edge id: `GraphCanvas.vue` places them all together (so they do not overlap each other or a card)
 * and `GraphDependencyEdge.vue` draws the one of its edge, if it has one.
 */
export const GraphTagsKey: InjectionKey<ComputedRef<ReadonlyMap<string, TagPlacement>>> = Symbol('graph-tags')
