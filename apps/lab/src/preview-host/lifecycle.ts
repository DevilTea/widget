export type PreviewHostState
	= | { readonly status: 'booting', readonly generation: number, readonly lastReadyRevision: number | null }
		| { readonly status: 'ready', readonly generation: number, readonly revision: number, readonly runtimeId: string }
		| { readonly status: 'replacing', readonly generation: number, readonly revision: number, readonly previousRevision: number | null, readonly previousRuntimeId: string | null }
		| { readonly status: 'disconnected', readonly generation: number, readonly lastReadyRevision: number | null }
		| { readonly status: 'error', readonly generation: number, readonly message: string, readonly lastReadyRevision: number | null }

export type PreviewHostEvent
	= | { readonly type: 'boot', readonly generation: number }
		| { readonly type: 'ready', readonly generation: number, readonly revision: number, readonly runtimeId: string }
		| { readonly type: 'replace-started', readonly generation: number, readonly revision: number }
		| { readonly type: 'disconnected', readonly generation: number }
		| { readonly type: 'failed', readonly generation: number, readonly message: string }

function lastReadyRevision(state: PreviewHostState): number | null {
	switch (state.status) {
		case 'ready':
			return state.revision
		case 'replacing':
			return state.previousRevision
		case 'booting':
		case 'disconnected':
			return state.lastReadyRevision
		case 'error':
			return state.lastReadyRevision
	}
}

/**
 * Pure generation-aware state machine for the future remote Preview host.
 * Events from an older iframe generation are ignored so a late message from a replaced document
 * cannot roll the current host backward or make it appear ready again.
 */
export function reducePreviewHostState(state: PreviewHostState, event: PreviewHostEvent): PreviewHostState {
	if (event.type === 'boot') {
		return event.generation > state.generation
			? { status: 'booting', generation: event.generation, lastReadyRevision: lastReadyRevision(state) }
			: state
	}
	if (event.generation !== state.generation)
		return state

	switch (event.type) {
		case 'ready':
			return { status: 'ready', generation: event.generation, revision: event.revision, runtimeId: event.runtimeId }
		case 'replace-started':
			return {
				status: 'replacing',
				generation: event.generation,
				revision: event.revision,
				previousRevision: lastReadyRevision(state),
				previousRuntimeId: state.status === 'ready' ? state.runtimeId : null,
			}
		case 'disconnected':
			return { status: 'disconnected', generation: event.generation, lastReadyRevision: lastReadyRevision(state) }
		case 'failed':
			return { status: 'error', generation: event.generation, message: event.message, lastReadyRevision: lastReadyRevision(state) }
	}
}
