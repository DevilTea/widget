// @vitest-environment happy-dom

/**
 * The expandable Runtime value view (audit U10): containers open and close, long strings are shown whole, and
 * everything the Inspector snapshot left out is marked where it was left out. The Lab does not hide, fill in or
 * work around those limits.
 */

import type { InspectableValue } from '@deviltea/widget-inspector/value'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { testGlobalProperties } from '../../test-support'
import { labI18nProvide } from '../../test-support-i18n'
import { testGlobalPlugins } from '../../test-support-ui'
import InspectableValueTree from './InspectableValueTree.vue'

const num = (value: number): InspectableValue => ({ type: 'number', value })
const str = (value: string, truncated = false): InspectableValue => ({ type: 'string', value, truncated })
const arr = (items: InspectableValue[], truncated = false): InspectableValue => ({ type: 'array', id: 10, items, truncated })
function obj(entries: Record<string, InspectableValue>, truncated = false): InspectableValue {
	return {
		type: 'object',
		id: 11,
		entries: Object.entries(entries)
			.map(([key, value]) => ({ key, value })),
		truncated,
	}
}
const depthCut: InspectableValue = { type: 'truncated', reason: 'max-depth' }

function mountTree(value: InspectableValue, props: { openDepth?: number } = {}) {
	return mount(InspectableValueTree, {
		props: { value, ...props },
		global: { config: { globalProperties: testGlobalProperties }, plugins: testGlobalPlugins, provide: labI18nProvide() },
	})
}

describe('inspectableValueTree', () => {
	it('shows scalars in a readable form', () => {
		const wrapper = mountTree(obj({
			s: str('hi'),
			n: num(3),
			b: { type: 'boolean', value: true },
			z: { type: 'null' },
			u: { type: 'undefined' },
			big: { type: 'bigint', value: '12' },
			nan: { type: 'number-special', value: 'nan' },
			fn: { type: 'opaque', kind: 'function' },
		}))
		const text = wrapper.text()
		expect(text)
			.toContain('s:"hi"')
		expect(text)
			.toContain('n:3')
		expect(text)
			.toContain('b:true')
		expect(text)
			.toContain('z:null')
		expect(text)
			.toContain('u:undefined')
		expect(text)
			.toContain('big:12n')
		expect(text)
			.toContain('nan:NaN')
		expect(text)
			.toContain('fn:<function>')
	})

	it('opens the first levels by default and lets each container be collapsed and expanded again', async () => {
		const wrapper = mountTree(obj({ list: arr([num(1), num(2)]), name: str('x') }))
		const toggles = wrapper.findAll('[data-testid="value-toggle"]')
		expect(toggles.map(toggle => toggle.attributes('aria-expanded')))
			.toEqual(['true', 'true'])
		expect(wrapper.text())
			.toContain('0:1')

		const listToggle = toggles[1]!
		await listToggle.trigger('click')
		expect(listToggle.attributes('aria-expanded'))
			.toBe('false')
		const group = wrapper.find(`#${listToggle.attributes('aria-controls')}`)
		expect(group.attributes('style'))
			.toContain('display: none')

		await listToggle.trigger('click')
		expect(listToggle.attributes('aria-expanded'))
			.toBe('true')
		expect(wrapper.find(`#${listToggle.attributes('aria-controls')}`)
			.attributes('style') ?? '')
			.not
			.toContain('display: none')
	})

	it('starts closed below openDepth', () => {
		const wrapper = mountTree(obj({ inner: obj({ deeper: num(1) }) }), { openDepth: 1 })
		const toggles = wrapper.findAll('[data-testid="value-toggle"]')
		expect(toggles.map(toggle => toggle.attributes('aria-expanded')))
			.toEqual(['true', 'false'])
	})

	it('shows a long string whole, wrapped, instead of clipping it', () => {
		const long = `${'long text '.repeat(30)}end`
		const wrapper = mountTree(obj({ message: str(long) }))
		expect(wrapper.text())
			.toContain(JSON.stringify(long))
	})

	it('marks a subtree replaced at the depth limit as truncated by the Inspector snapshot', () => {
		const wrapper = mountTree(obj({ errors: arr([depthCut]) }))
		const marks = wrapper.findAll('[data-testid="value-truncated"]')
		expect(marks)
			.toHaveLength(1)
		expect(marks[0]!.text())
			.toBe('… truncated by the Inspector snapshot (nested too deeply)')
	})

	it('marks a container cut at the entry budget and a string cut at the length limit', () => {
		const wrapper = mountTree(obj({ items: arr([num(1)], true), text: str('abc', true) }))
		const marks = wrapper.findAll('[data-testid="value-truncated"]')
			.map(mark => mark.text())
		expect(marks)
			.toEqual(['… more entries were left out by the Inspector snapshot', '… cut by the Inspector snapshot'])
		expect(wrapper.text())
			.toContain('Array(1+)')
	})

	it('shows a reference to an object already shown, and says what it means', () => {
		const wrapper = mountTree(arr([{ type: 'reference', ref: 11 }]))
		expect(wrapper.text())
			.toContain('↻ #11')
		expect(wrapper.find('[title]')
			.attributes('title'))
			.toBe('The same object as one shown elsewhere in this value (#11)')
	})

	it('says so for an empty container', () => {
		expect(mountTree(arr([]))
			.text())
			.toContain('empty array')
		expect(mountTree(obj({}))
			.text())
			.toContain('empty object')
	})

	it('translates its chrome in zh-TW', () => {
		const wrapper = mount(InspectableValueTree, {
			props: { value: obj({ errors: arr([depthCut]) }) },
			global: { config: { globalProperties: testGlobalProperties }, plugins: testGlobalPlugins, provide: labI18nProvide('zh-TW') },
		})
		expect(wrapper.find('[data-testid="value-truncated"]')
			.text())
			.toBe('… 被 Inspector snapshot 截斷（巢狀太深）')
	})
})
