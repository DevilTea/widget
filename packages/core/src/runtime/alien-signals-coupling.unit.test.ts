/**
 * Upgrade guard for the alien-signals internals the Property primitive relies on (`property.ts`, ALIEN-SIGNALS
 * COUPLING). Not a test of Core: each case pins one behaviour of the pinned alien-signals@3.2.1 that is not part
 * of its public API, so that an upgrade that changes it fails here, by name, instead of silently breaking how
 * Core bounds and completes deep Property evaluations.
 */

import { computed, effect, setActiveSub, signal } from 'alien-signals'
import { describe, expect, it } from 'vitest'

interface Link { readonly dep: object, readonly nextDep: Link | undefined }
interface ComputedNode { deps: Link | undefined, depsTail: Link | undefined, flags: number }

/** alien-signals@3.2.1 `ReactiveFlags.Dirty`. */
const DIRTY = 16

function lastLink(node: ComputedNode): Link | undefined {
	let link = node.depsTail ?? node.deps
	while (link?.nextDep !== undefined)
		link = link.nextDep
	return link
}

function linkCount(node: ComputedNode): number {
	let count = 0
	for (let link = node.deps; link !== undefined; link = link.nextDep)
		count++
	return count
}

describe('alien-signals internals Core relies on (ALIEN-SIGNALS COUPLING in property.ts)', () => {
	it('1: calls a computed\'s getter as a method of the computed\'s node', () => {
		const nodes: unknown[] = []
		const a = signal(1)
		const c = computed(function (this: unknown) {
			nodes.push(this)
			return a()
		})
		c()
		a(2)
		c()

		expect(nodes)
			.toHaveLength(2)
		expect(nodes[0])
			.toBe(nodes[1])
		expect(typeof nodes[0])
			.toBe('object')
	})

	it('2: keeps every dependency link when the getter sets `depsTail` to the last link, drops them all when it resets it', () => {
		const a = signal(1)
		const b = signal(1)
		let mode: 'read both' | 'keep' | 'drop' = 'read both'
		let runs = 0
		const holder: { node: ComputedNode | null } = { node: null }
		const c = computed(function (this: ComputedNode) {
			holder.node = this
			runs++
			const sum = a()
			if (mode === 'read both')
				return sum + b()
			if (mode === 'keep')
				this.depsTail = lastLink(this)
			else
				this.depsTail = undefined
			return sum + 100 + runs
		})
		c()
		expect(linkCount(holder.node!))
			.toBe(2)

		mode = 'keep'
		a(2)
		c()
		expect(linkCount(holder.node!))
			.toBe(2)
		// Still linked to `b`, which this run did not read: writing it makes the computed evaluate again.
		mode = 'read both'
		const runsBefore = runs
		b(2)
		c()
		expect(runs)
			.toBe(runsBefore + 1)

		mode = 'drop'
		a(3)
		c()
		expect(holder.node!.deps)
			.toBeUndefined()
		const runsAfterDrop = runs
		a(4)
		b(3)
		c()
		expect(runs)
			.toBe(runsAfterDrop)
	})

	it('3: leaves a computed dirty when its getter sets `Dirty`, so the next read evaluates it again', () => {
		const a = signal(1)
		let runs = 0
		let dirty = true
		const c = computed(function (this: ComputedNode) {
			runs++
			const value = a()
			if (dirty)
				this.flags |= DIRTY
			return value
		})
		c()
		c()
		expect(runs)
			.toBe(2)
		dirty = false
		c()
		c()
		expect(runs)
			.toBe(3)
	})

	it('4: empties the dependency list of a computed it tears down', () => {
		const a = signal(1)
		const holder: { node: ComputedNode | null } = { node: null }
		const c = computed(function (this: ComputedNode) {
			holder.node = this
			return a()
		})
		const dispose = effect(() => {
			c()
		})
		expect(holder.node!.deps)
			.toBeDefined()

		dispose()

		expect(holder.node!.deps)
			.toBeUndefined()
	})

	it('5: links nothing when a computed is read with no active subscriber, and links the reader only once the read returns', () => {
		const a = signal(1)
		const readerHolder: { node: ComputedNode | null } = { node: null }
		let readerLinksWhileTrackedReadRuns = -1
		const untracked = computed(() => a())
		const tracked = computed(() => {
			readerLinksWhileTrackedReadRuns = linkCount(readerHolder.node!)
			return a()
		})
		const reader = computed(function (this: ComputedNode) {
			readerHolder.node = this
			const previous = setActiveSub(undefined)
			try {
				untracked()
			}
			finally {
				setActiveSub(previous)
			}
			return tracked()
		})
		reader()

		expect(readerLinksWhileTrackedReadRuns)
			.toBe(0)
		// `untracked` was read with no active subscriber: the reader depends on `tracked` only.
		expect(linkCount(readerHolder.node!))
			.toBe(1)
		expect(readerHolder.node!.deps!.dep)
			.not
			.toBe(undefined)
	})
})
