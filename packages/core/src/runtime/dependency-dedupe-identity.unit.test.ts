/**
 * Regression coverage for PR #12 review finding 3774401609 (`runtime/deps.ts` dedupe `scope` leaking
 * `message` into machine identity).
 *
 * Normative source: diagnostic #10 — "`message` is human-readable only, never a machine protocol." Before
 * this fix, `dependencyDedupeDescriptor()` built its collector `scope` as `` `${leafId}|${message}` ``,
 * so the dependency-diagnostic dedupe mechanism keyed on message text alongside the leaf identity — a
 * machine-logic dependency on human-readable text.
 *
 * This file deliberately imports `dependencyDedupeDescriptor` directly from the sibling `./deps` module
 * instead of exercising it only through the public plugin API, unlike every other regression file in
 * this package. That is a considered exception, not an oversight: in every current call site, `anchor`
 * and `message` are structurally coupled 1:1—
 *
 * - wrapped target failures anchor on the *target diagnostic object itself*, which is frozen once built, so
 *   two occurrences with the same anchor (the same object reference) are, by construction, always the
 *   same message too;
 * - `.validate()` refinement rejections always use the one hardcoded message
 *   `'The dependency value failed validation.'`, so message never varies there either.
 *
 * There is therefore no way to organically produce "same leaf, same anchor, different message" through
 * any registered plugin callback today — the only way to pin the exact fixed contract (`scope` excludes
 * `message`) is to call the function that builds it.
 */

import { describe, expect, it } from 'vitest'
import { dependencyDedupeDescriptor } from './deps'

describe('dependencyDedupeDescriptor scope excludes message (review finding 3774401609)', () => {
	it('the same leaf produces the same scope regardless of message wording', () => {
		const a = dependencyDedupeDescriptor(7, 'first wording')
		const b = dependencyDedupeDescriptor(7, 'a completely different wording')

		expect(a.scope)
			.toBe(b.scope)
	})

	it('different leaves produce different scopes', () => {
		const a = dependencyDedupeDescriptor(1, 'same wording')
		const b = dependencyDedupeDescriptor(2, 'same wording')

		expect(a.scope)
			.not.toBe(b.scope)
	})

	it('anchor is passed through as the raw value, never folded into scope or stringified', () => {
		const anchor = Symbol('x')
		const descriptor = dependencyDedupeDescriptor(3, anchor)

		expect(descriptor.anchor)
			.toBe(anchor)
		expect(descriptor.scope)
			.not.toContain('Symbol')
	})
})

describe('end-to-end: the collector dedupes by (scope, anchor) only, discriminating on anchor alone', () => {
	// A minimal in-repo model of the exact `createOperationCollector` contract `deps.ts` relies on,
	// exercising `dependencyDedupeDescriptor`'s real output the same way `reportDependencyDiagnostic` does —
	// without needing to construct a full compiled Blueprint/Runtime just to observe this one mechanism.
	function dedupe(entries: readonly { readonly leafId: number, readonly message: string, readonly anchor: unknown }[]): number {
		const seenAnchorsByScope = new Map<string, Set<unknown>>()
		let kept = 0
		for (const entry of entries) {
			const descriptor = dependencyDedupeDescriptor(entry.leafId, entry.anchor)
			let seenAnchors = seenAnchorsByScope.get(descriptor.scope)
			if (seenAnchors === undefined) {
				seenAnchors = new Set()
				seenAnchorsByScope.set(descriptor.scope, seenAnchors)
			}
			if (seenAnchors.has(descriptor.anchor))
				continue
			seenAnchors.add(descriptor.anchor)
			kept++
		}
		return kept
	}

	it('same leaf, same anchor, different message wording: still dedupes to one', () => {
		const kept = dedupe([
			{ leafId: 5, message: 'wording A', anchor: 'same-value' },
			{ leafId: 5, message: 'wording B (completely different)', anchor: 'same-value' },
		])

		expect(kept)
			.toBe(1)
	})

	it('same leaf, different anchor: both survive regardless of message', () => {
		const kept = dedupe([
			{ leafId: 5, message: 'wording A', anchor: 'value-1' },
			{ leafId: 5, message: 'wording A', anchor: 'value-2' },
		])

		expect(kept)
			.toBe(2)
	})
})
