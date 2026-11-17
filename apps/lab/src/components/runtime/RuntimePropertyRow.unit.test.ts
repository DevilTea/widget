// @vitest-environment happy-dom

/**
 * The Runtime panel's failed-Property display: a completed Property whose result is a failure shows
 * "Failed (N diagnostics)" and a toggle that reveals the Core diagnostics verbatim. No showcase produces a
 * failed Property in normal use any more (the survey keeps answer errors as values), so this contract is
 * pinned here against a fake Inspector client rather than through a Lab preset.
 */

import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorRuntimeDiagnostic, InspectorRuntimePropertySnapshot, WidgetRef } from '@deviltea/widget-inspector/protocol'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { translatePresentationMessage } from '../../i18n/presentation-messages'
import RuntimePropertyRow from './RuntimePropertyRow.vue'

const widgetRef: WidgetRef = { runtimeId: 'runtime-1', nodeId: 3 }

const invalidResult: InspectorRuntimeDiagnostic = {
	code: 'invalid-property-result',
	message: 'Property "value" returned a value its contract rejects.',
	location: { type: 'property', widgetId: 'guests', name: 'value' },
	path: ['totals', 0],
	result: { type: 'string', value: 'many', truncated: false },
}

const rejectedDependency: InspectorRuntimeDiagnostic = {
	code: 'dependency-value-rejected',
	message: 'Dependency value rejected.',
	location: { type: 'property', widgetId: 'guests', name: 'value' },
	dependency: {
		target: { type: 'widget', widgetId: 'mode', optional: false },
		operation: { type: 'property-get', name: 'value' },
	},
	received: { type: 'number', value: 7 },
}

function property(snapshot: InspectorRuntimePropertySnapshot['snapshot']): InspectorRuntimePropertySnapshot {
	return { type: 'property', name: 'value', snapshot }
}

function failed(...diagnostics: InspectorRuntimeDiagnostic[]): InspectorRuntimePropertySnapshot {
	return property({ status: 'completed', result: { ok: false, diagnostics } })
}

function createClient(initial: InspectorRuntimePropertySnapshot): InspectorClient {
	return {
		on: () => () => {},
		request: vi.fn(async () => ({ subscriptionId: 'subscription-1', member: initial })),
	} as unknown as InspectorClient
}

async function mountRow(initial: InspectorRuntimePropertySnapshot) {
	const wrapper = mount(RuntimePropertyRow, {
		props: { name: 'value', client: createClient(initial), widgetRef, initial, selected: false },
		global: {
			provide: {
				[LabI18nKey as symbol]: {
					locale: shallowRef('en'),
					locales: ['en', 'zh-TW'],
					setLocale: () => {},
					t: (source: string, params?: Readonly<Record<string, string | number>>) => translatePresentationMessage('en', source)
						.replace(/\{(\w+)\}/g, (match, key: string) => params?.[key] === undefined ? match : String(params[key])),
				},
			},
		},
	})
	await flushPromises()
	return wrapper
}

const rowButton = (wrapper: Awaited<ReturnType<typeof mountRow>>) => wrapper.findAll('button')[0]!

describe('runtimePropertyRow failed Property display', () => {
	it('summarizes a failed result with its diagnostic count (plural)', async () => {
		const wrapper = await mountRow(failed(invalidResult, rejectedDependency))

		expect(rowButton(wrapper)
			.text())
			.toBe('valueFailed (2 diagnostics)')
	})

	it('uses the singular word for one diagnostic', async () => {
		const wrapper = await mountRow(failed(invalidResult))

		expect(rowButton(wrapper)
			.text())
			.toContain('Failed (1 diagnostic)')
	})

	it('keeps the diagnostics hidden until "show diagnostics" is pressed, then shows and hides them', async () => {
		const wrapper = await mountRow(failed(invalidResult, rejectedDependency))

		expect(wrapper.find('ul')
			.exists())
			.toBe(false)

		const toggle = wrapper.findAll('button')[1]!
		expect(toggle.text())
			.toBe('show diagnostics')
		await toggle.trigger('click')

		const items = wrapper.findAll('li')
		expect(items)
			.toHaveLength(2)
		expect(items[0]!.text())
			.toContain('invalid-property-result')
		expect(items[0]!.text())
			.toContain('Property "value" returned a value its contract rejects.')
		expect(items[0]!.text())
			.toContain('path: totals[0]')
		expect(items[0]!.text())
			.toContain('result: "many"')
		expect(items[1]!.text())
			.toContain('dependency-value-rejected')
		expect(items[1]!.text())
			.toContain('dependency: widget("mode") -> properties.get("value")')
		expect(items[1]!.text())
			.toContain('received: 7')

		expect(wrapper.findAll('button')[1]!.text())
			.toBe('hide diagnostics')
		await wrapper.findAll('button')[1]!.trigger('click')
		expect(wrapper.find('ul')
			.exists())
			.toBe(false)
	})

	it('shows a successful value, with no diagnostics toggle', async () => {
		const wrapper = await mountRow(property({ status: 'completed', result: { ok: true, value: { type: 'number', value: 3 } } }))

		expect(rowButton(wrapper)
			.text())
			.toBe('value3')
		expect(wrapper.findAll('button'))
			.toHaveLength(1)
	})

	it('shows "Never evaluated" until the Preview has produced a result', async () => {
		const wrapper = await mountRow(property({ status: 'never-evaluated' }))

		expect(rowButton(wrapper)
			.text())
			.toBe('valueNever evaluated')
		expect(wrapper.findAll('button'))
			.toHaveLength(1)
	})
})

describe('runtimePropertyRow value disclosure (audit U10)', () => {
	const objectValue = {
		type: 'object' as const,
		id: 1,
		truncated: false,
		entries: [{ key: 'errors', value: { type: 'array' as const, id: 2, truncated: false, items: [{ type: 'truncated' as const, reason: 'max-depth' as const }] } }],
	}

	it('keeps the one-line summary unclipped and opens the whole value on request', async () => {
		const wrapper = await mountRow(property({ status: 'completed', result: { ok: true, value: objectValue } }))

		expect(wrapper.get('[data-testid="value-summary"]')
			.text())
			.toBe('{ "errors": [<truncated>] }')
		expect(wrapper.find('[data-testid="value-detail"]')
			.exists())
			.toBe(false)

		await wrapper.get('[data-testid="value-expand"]')
			.trigger('click')
		expect(wrapper.get('[data-testid="value-detail"]')
			.text())
			.toContain('truncated by the Inspector snapshot')
	})

	it('offers no value disclosure for a failed Property, only its diagnostics', async () => {
		const wrapper = await mountRow(failed(invalidResult))

		expect(wrapper.find('[data-testid="value-expand"]')
			.exists())
			.toBe(false)
	})
})
