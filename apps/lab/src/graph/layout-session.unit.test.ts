/**
 * `createLayoutSession()` tests using a fake/stub `LayoutGraphFn` — the real Worker-backed
 * implementation (`layout-client.ts`) and the Worker itself (`layout.worker.ts`) are excluded by design
 * (diagnostic #13 Phase 5 "worker itself excluded — keep it thin"). These tests cover the generation-guard
 * contract: a result for a superseded `request()` call is discarded (diagnostic #13 Phase 5 "Graph layout is
 * an asynchronous projection").
 */

import type { LayoutedGraph, LayoutGraphFn } from './layout'
import type { SemanticGraph } from './types'
import { describe, expect, it, vi } from 'vitest'
import { createLayoutSession } from './layout-session'

function fakeGraph(tag: string): SemanticGraph {
	return {
		clusters: [],
		vertices: [],
		edges: [],
		stubs: [],
		invalidCycleVertexIds: new Set([tag]),
	}
}

function fakeLayout(): LayoutedGraph {
	return { clusters: new Map(), vertices: new Map(), stubs: new Map() }
}

interface Deferred<T> {
	readonly promise: Promise<T>
	resolve: (value: T) => void
	reject: (error: unknown) => void
}

function defer<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe('createLayoutSession', () => {
	it('starts idle and transitions to loading then ready on a successful layout', async () => {
		const deferred = defer<LayoutedGraph>()
		const layoutFn: LayoutGraphFn = vi.fn(() => deferred.promise)
		const session = createLayoutSession(layoutFn)

		expect(session.getState())
			.toEqual({ status: 'idle' })

		const graph = fakeGraph('a')
		session.request(graph)
		expect(session.getState().status)
			.toBe('loading')
		expect(layoutFn)
			.toHaveBeenCalledWith(graph)

		const layout = fakeLayout()
		deferred.resolve(layout)
		await Promise.resolve()
		await Promise.resolve()

		expect(session.getState())
			.toEqual({ status: 'ready', graph, layout })
	})

	it('discards a stale (superseded) request result once a newer request has been made', async () => {
		const first = defer<LayoutedGraph>()
		const second = defer<LayoutedGraph>()
		const calls: SemanticGraph[] = []
		const layoutFn: LayoutGraphFn = vi.fn((graph) => {
			calls.push(graph)
			return calls.length === 1 ? first.promise : second.promise
		})
		const session = createLayoutSession(layoutFn)

		const graphA = fakeGraph('a')
		const graphB = fakeGraph('b')
		session.request(graphA)
		session.request(graphB)

		const layoutB = fakeLayout()
		second.resolve(layoutB)
		await Promise.resolve()
		await Promise.resolve()
		expect(session.getState())
			.toEqual({ status: 'ready', graph: graphB, layout: layoutB })

		// The older request resolves after the newer one already landed — must not clobber state.
		first.resolve(fakeLayout())
		await Promise.resolve()
		await Promise.resolve()
		expect(session.getState())
			.toEqual({ status: 'ready', graph: graphB, layout: layoutB })
	})

	it('discards a stale rejection the same way it discards a stale resolution', async () => {
		const first = defer<LayoutedGraph>()
		const second = defer<LayoutedGraph>()
		let call = 0
		const layoutFn: LayoutGraphFn = vi.fn(() => (++call === 1 ? first.promise : second.promise))
		const session = createLayoutSession(layoutFn)

		session.request(fakeGraph('a'))
		const graphB = fakeGraph('b')
		session.request(graphB)

		first.reject(new Error('stale failure'))
		await Promise.resolve()
		await Promise.resolve()
		// The stale rejection must not surface as an 'error' state once superseded.
		expect(session.getState().status)
			.toBe('loading')

		const layoutB = fakeLayout()
		second.resolve(layoutB)
		await Promise.resolve()
		await Promise.resolve()
		expect(session.getState())
			.toEqual({ status: 'ready', graph: graphB, layout: layoutB })
	})

	it('surfaces a current (non-stale) rejection as an error state', async () => {
		const deferred = defer<LayoutedGraph>()
		const layoutFn: LayoutGraphFn = vi.fn(() => deferred.promise)
		const session = createLayoutSession(layoutFn)

		const graph = fakeGraph('a')
		session.request(graph)
		const error = new Error('layout failed')
		deferred.reject(error)
		await Promise.resolve()
		await Promise.resolve()

		expect(session.getState())
			.toEqual({ status: 'error', graph, error })
	})

	it('notifies subscribers on every state transition and stops after unsubscribe', async () => {
		const deferred = defer<LayoutedGraph>()
		const layoutFn: LayoutGraphFn = () => deferred.promise
		const session = createLayoutSession(layoutFn)

		const listener = vi.fn()
		const unsubscribe = session.subscribe(listener)

		session.request(fakeGraph('a'))
		expect(listener)
			.toHaveBeenCalledTimes(1)

		unsubscribe()
		deferred.resolve(fakeLayout())
		await Promise.resolve()
		await Promise.resolve()
		expect(listener)
			.toHaveBeenCalledTimes(1)
	})

	it('dispose() stops accepting new requests and discards any in-flight one', async () => {
		const deferred = defer<LayoutedGraph>()
		const layoutFn: LayoutGraphFn = () => deferred.promise
		const session = createLayoutSession(layoutFn)

		session.request(fakeGraph('a'))
		session.dispose()
		deferred.resolve(fakeLayout())
		await Promise.resolve()
		await Promise.resolve()
		expect(session.getState().status)
			.toBe('loading')

		const listener = vi.fn()
		session.subscribe(listener)
		session.request(fakeGraph('b'))
		expect(listener).not.toHaveBeenCalled()
		expect(session.getState().status)
			.toBe('loading')
	})
})
