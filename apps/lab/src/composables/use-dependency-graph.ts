/**
 * Vue reactivity bridge for the Dependency Graph panel (diagnostic #13 Phase 5 "Dependency Graph semantic
 * representation" / "Graph layout is an asynchronous projection" comments).
 *
 * Projects the current Document Blueprint (compile-time facts only — works for an invalid Blueprint,
 * never waits on/depends on Runtime) through `projectSemanticGraph()`, then requests an ELK layout
 * through the generation-guarded `LayoutSession`. Only a change to the projected `SemanticGraph` itself
 * (new Blueprint snapshot, or a graph filter toggle) triggers a fresh layout request — Runtime
 * state/property/method activity never touches the Document Blueprint and therefore never
 * relayouts.
 */

import type { Ref } from 'vue'
import type { LayoutSessionState } from '../graph/layout-session'
import type { SemanticGraph } from '../graph/types'
import type { GraphFlowEdge, GraphFlowNode } from '../graph/vue-flow'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import { layoutGraph } from '../graph/layout-client'
import { createLayoutSession } from '../graph/layout-session'
import { projectSemanticGraph } from '../graph/projection'
import { toVueFlow } from '../graph/vue-flow'
import { useLabStore } from './use-lab-store'

export interface DependencyGraphView {
	/** The current projection — vertex lookup source for e.g. mapping a clicked node id back to its `nodeId`/member. */
	readonly semanticGraph: Readonly<Ref<SemanticGraph>>
	readonly layoutState: Readonly<Ref<LayoutSessionState>>
	readonly flow: Readonly<Ref<{ nodes: GraphFlowNode[], edges: GraphFlowEdge[] } | null>>
}

export function useDependencyGraph(): DependencyGraphView {
	const store = useLabStore()
	const session = createLayoutSession(layoutGraph)

	const tick = shallowRef(0)
	const unsubscribeSession = session.subscribe(() => {
		tick.value++
	})

	const semanticGraph = computed(() => {
		const inspection = inspectBlueprint(store.documentState.value.blueprint)
		return projectSemanticGraph(inspection, {
			showAbsent: store.graphShowAbsent.value,
			showIsolatedMembers: store.graphShowIsolatedMembers.value,
		})
	})

	watch(semanticGraph, (graph) => {
		session.request(graph)
	}, { immediate: true })

	const layoutState = computed(() => {
		void tick.value
		return session.getState()
	})

	const flow = computed(() => {
		const state = layoutState.value
		return state.status === 'ready' ? toVueFlow(state.graph, state.layout) : null
	})

	onUnmounted(() => {
		unsubscribeSession()
		session.dispose()
	})

	return { semanticGraph, layoutState, flow }
}
