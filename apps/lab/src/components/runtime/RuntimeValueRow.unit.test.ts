// @vitest-environment happy-dom

import type { InspectableValue } from '@deviltea/widget-inspector/value'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { testGlobalProperties } from '../../test-support'
import { labI18nProvide } from '../../test-support-i18n'
import { testGlobalPlugins } from '../../test-support-ui'
import RuntimeValueRow from './RuntimeValueRow.vue'

function obj(entries: Record<string, InspectableValue>): InspectableValue {
	return {
		type: 'object',
		id: 1,
		entries: Object.entries(entries)
			.map(([key, value]) => ({ key, value })),
		truncated: false,
	}
}

function mountRow(props: { summary: string, value: InspectableValue | null, selected?: boolean, danger?: boolean }) {
	return mount(RuntimeValueRow, {
		props: { name: 'response', selected: false, ...props },
		global: { config: { globalProperties: testGlobalProperties }, plugins: testGlobalPlugins, provide: labI18nProvide() },
	})
}

describe('runtimeValueRow', () => {
	it('opens and closes the full value with its own named, labelled disclosure', async () => {
		const wrapper = mountRow({ summary: '{ "a": … }', value: obj({ a: { type: 'number', value: 7 } }) })
		const expand = wrapper.get('[data-testid="value-expand"]')
		expect(expand.attributes('aria-expanded'))
			.toBe('false')
		expect(expand.attributes('aria-label'))
			.toBe('Value of response')
		// Nothing to control while it is closed: `aria-controls` must not name an element that does not exist.
		expect(expand.attributes('aria-controls'))
			.toBeUndefined()
		expect(wrapper.find('[data-testid="value-detail"]')
			.exists())
			.toBe(false)

		await expand.trigger('click')
		expect(expand.attributes('aria-expanded'))
			.toBe('true')
		// The name is stable; the state is `aria-expanded`'s alone, and the controlled region exists.
		expect(expand.attributes('aria-label'))
			.toBe('Value of response')
		expect(wrapper.find(`#${expand.attributes('aria-controls')}`)
			.exists())
			.toBe(true)
		expect(wrapper.get('[data-testid="value-detail"]')
			.text())
			.toContain('a:7')

		await expand.trigger('click')
		expect(wrapper.find('[data-testid="value-detail"]')
			.exists())
			.toBe(false)
	})

	it('keeps selecting a member separate from opening its value', async () => {
		const wrapper = mountRow({ summary: '…', value: obj({}) })
		await wrapper.get('[data-testid="value-select"]')
			.trigger('click')
		expect(wrapper.emitted('select'))
			.toHaveLength(1)
		expect(wrapper.find('[data-testid="value-detail"]')
			.exists())
			.toBe(false)
		await wrapper.get('[data-testid="value-expand"]')
			.trigger('click')
		expect(wrapper.emitted('select'))
			.toHaveLength(1)
	})

	it('gives a short scalar, an unevaluated and a failed row no disclosure', () => {
		expect(mountRow({ summary: '3', value: { type: 'number', value: 3 } })
			.find('[data-testid="value-expand"]')
			.exists())
			.toBe(false)
		expect(mountRow({ summary: 'Never evaluated', value: null })
			.find('[data-testid="value-expand"]')
			.exists())
			.toBe(false)
	})

	it('opens a long string whole', async () => {
		const long = 'abcdefghij '.repeat(12)
		const wrapper = mountRow({ summary: JSON.stringify(long), value: { type: 'string', value: long, truncated: false } })
		await wrapper.get('[data-testid="value-expand"]')
			.trigger('click')
		expect(wrapper.get('[data-testid="value-detail"]')
			.text())
			.toContain(JSON.stringify(long))
	})

	it('keeps the whole summary available as the tooltip instead of clipping it at a fixed width', () => {
		const summary = '{ "answers": { "guests": { "errors": [<truncated>] } } }'
		const wrapper = mountRow({ summary, value: null })
		expect(wrapper.get('[data-testid="value-select"]')
			.attributes('title'))
			.toBe(summary)
		expect(wrapper.get('[data-testid="value-summary"]')
			.text())
			.toBe(summary)
		expect(wrapper.html())
			.not
			.toContain('160px')
	})

	it('notes once, under a value the Inspector cut, that the snapshot limits what the Lab can show', async () => {
		const cut = obj({ errors: { type: 'array', id: 2, items: [{ type: 'truncated', reason: 'max-depth' }], truncated: false } })
		const wrapper = mountRow({ summary: '…', value: cut })
		await wrapper.get('[data-testid="value-expand"]')
			.trigger('click')
		expect(wrapper.findAll('[data-testid="value-snapshot-note"]'))
			.toHaveLength(1)
		expect(wrapper.get('[data-testid="value-snapshot-note"]')
			.text())
			.toContain('left out by the Inspector snapshot')

		const complete = mountRow({ summary: '…', value: obj({ a: { type: 'number', value: 1 } }) })
		await complete.get('[data-testid="value-expand"]')
			.trigger('click')
		expect(complete.find('[data-testid="value-snapshot-note"]')
			.exists())
			.toBe(false)
	})
})
