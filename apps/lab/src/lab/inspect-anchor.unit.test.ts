// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { resolveInspectAnchor } from './inspect-anchor'

/** Builds a small nested-anchor DOM fixture mirroring a CRM toolbar containing a Button, both stamped. */
function buildNestedFixture(): { outer: HTMLElement, inner: HTMLElement, innerChild: HTMLElement, plain: HTMLElement } {
	const outer = document.createElement('div')
	outer.setAttribute('data-widget-id', 'toolbar-1')
	outer.setAttribute('data-widget-type', 'Toolbar')

	const inner = document.createElement('div')
	inner.setAttribute('data-widget-id', 'button-1')
	inner.setAttribute('data-widget-type', 'Button')

	const innerChild = document.createElement('button')
	inner.appendChild(innerChild)
	outer.appendChild(inner)

	const plain = document.createElement('span')
	outer.appendChild(plain)

	document.body.appendChild(outer)
	return { outer, inner, innerChild, plain }
}

describe('resolveInspectAnchor', () => {
	it('resolves the innermost anchor when the target is deeply nested inside it', () => {
		const { innerChild } = buildNestedFixture()

		const anchor = resolveInspectAnchor(innerChild)

		expect(anchor).not.toBeNull()
		expect(anchor!.widgetId)
			.toBe('button-1')
		expect(anchor!.widgetType)
			.toBe('Button')
	})

	it('resolves the outer anchor when the target has no closer/inner anchor ancestor', () => {
		const { plain } = buildNestedFixture()

		const anchor = resolveInspectAnchor(plain)

		expect(anchor).not.toBeNull()
		expect(anchor!.widgetId)
			.toBe('toolbar-1')
		expect(anchor!.widgetType)
			.toBe('Toolbar')
	})

	it('resolves an anchor element itself (target === anchor) to itself', () => {
		const { inner } = buildNestedFixture()

		const anchor = resolveInspectAnchor(inner)

		expect(anchor!.element)
			.toBe(inner)
		expect(anchor!.widgetId)
			.toBe('button-1')
	})

	it('returns null when no enclosing anchor exists at all', () => {
		const orphan = document.createElement('div')
		document.body.appendChild(orphan)

		expect(resolveInspectAnchor(orphan))
			.toBeNull()
	})

	it('returns null for a non-Element target (e.g. a text node)', () => {
		const text = document.createTextNode('hello')
		document.body.appendChild(text)

		expect(resolveInspectAnchor(text))
			.toBeNull()
	})

	it('returns null for a null/undefined target', () => {
		expect(resolveInspectAnchor(null))
			.toBeNull()
		expect(resolveInspectAnchor(undefined))
			.toBeNull()
	})

	it('returns null for an element missing one of the two required attributes', () => {
		const partial = document.createElement('div')
		partial.setAttribute('data-widget-id', 'orphan-1')
		document.body.appendChild(partial)

		expect(resolveInspectAnchor(partial))
			.toBeNull()
	})
})
