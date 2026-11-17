// @vitest-environment happy-dom

import type { InspectorRuntimeDiagnostic, InspectorRuntimeMethodSnapshot } from '@deviltea/widget-inspector/protocol'
import type { VueWrapper } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPreview, disposePreviews } from '../../events/test-support'
import { labI18nProvide } from '../../test-support-i18n'
import { testGlobalPlugins } from '../../test-support-ui'
import MethodDiagnosticList from './MethodDiagnosticList.vue'
import RuntimeMethodRow from './RuntimeMethodRow.vue'

/**
 * Issue #230, audit U08: a Method row shows the Method's latest diagnostics, live, from a real Core Runtime behind a real
 * Inspector Agent (protocol 0.5 Method member subscription).
 */
const mounted: VueWrapper[] = []
afterEach(() => {
	for (const wrapper of mounted.splice(0))
		wrapper.unmount()
	disposePreviews()
})

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++)
		await Promise.resolve()
	await nextTick()
}

async function mountRow(options: { withSnapshot?: boolean, locale?: 'en' | 'zh-TW' } = {}) {
	const preview = await createPreview(1)
	const client = preview.connection.inspectorClient
	const widgetRef = { runtimeId: preview.connection.runtimeId, nodeId: preview.connection.blueprint.nodes.find(node => node.widgetId === 'notifier')!.nodeId }
	const snapshot = await client.request('runtime.getWidgetSnapshot', { ref: widgetRef })
	const initial = snapshot.members.find((member): member is InspectorRuntimeMethodSnapshot => member.type === 'method' && member.name === 'check')!
	const wrapper = mount(RuntimeMethodRow, {
		props: {
			name: 'check',
			transitivelyWrites: false,
			selected: false,
			client,
			widgetRef,
			...(options.withSnapshot === false ? {} : { initial }),
		},
		global: { plugins: testGlobalPlugins, provide: labI18nProvide(options.locale ?? 'en') },
	})
	mounted.push(wrapper)
	await settle()
	return { wrapper, preview }
}

function status(wrapper: VueWrapper) {
	return wrapper.get('[data-testid="method-status"]')
		.text()
}

describe('runtimeMethodRow failure status', () => {
	it('says no failure was recorded for a Method that holds no diagnostics, never "succeeded"', async () => {
		const { wrapper } = await mountRow()
		expect(status(wrapper))
			.toBe('No failure recorded')
		expect(wrapper.find('[data-testid="method-failure-toggle"]')
			.exists())
			.toBe(false)
		expect(wrapper.text())
			.not
			.toMatch(/succe|never called/i)
	})

	it('shows the failure of the latest call live, with Core\'s code, reason and message verbatim, and clears it on the next success', async () => {
		const { wrapper, preview } = await mountRow()
		preview.check(false)
		await settle()
		expect(status(wrapper))
			.toBe('Last call failed')
		expect(wrapper.attributes('data-failed'))
			.toBe('true')
		const detail = wrapper.get('[data-testid="method-failure-detail"]')
		expect(detail.get('[data-testid="method-diagnostic-code"]')
			.text())
			.toBe('invalid-method-result')
		expect(detail.get('[data-testid="method-diagnostic-message"]')
			.text())
			.toBe('The check failed.')
		expect(detail.get('[data-testid="method-diagnostic-reason"]')
			.text())
			.toBe('not-ok')
		expect(detail.get('[data-testid="method-diagnostic-result"]')
			.text())
			.toContain('false')

		preview.check(true)
		await settle()
		expect(status(wrapper))
			.toBe('No failure recorded')
		expect(wrapper.find('[data-testid="method-failure-detail"]')
			.exists())
			.toBe(false)
	})

	it('shows a failure the Method already held when the row appeared', async () => {
		const preview = await createPreview(1)
		preview.check(false)
		const client = preview.connection.inspectorClient
		const widgetRef = { runtimeId: preview.connection.runtimeId, nodeId: preview.connection.blueprint.nodes.find(node => node.widgetId === 'notifier')!.nodeId }
		const snapshot = await client.request('runtime.getWidgetSnapshot', { ref: widgetRef })
		const initial = snapshot.members.find((member): member is InspectorRuntimeMethodSnapshot => member.type === 'method' && member.name === 'check')!
		const wrapper = mount(RuntimeMethodRow, {
			props: { name: 'check', transitivelyWrites: false, selected: false, client, widgetRef, initial },
			global: { plugins: testGlobalPlugins, provide: labI18nProvide('en') },
		})
		mounted.push(wrapper)
		await settle()
		expect(status(wrapper))
			.toBe('Last call failed')
	})

	it('collapses and reopens the failure details with an accessible toggle', async () => {
		const { wrapper, preview } = await mountRow()
		preview.check(false)
		await settle()
		const toggle = wrapper.get('[data-testid="method-failure-toggle"]')
		expect(toggle.attributes('aria-expanded'))
			.toBe('true')
		expect(toggle.attributes('aria-label'))
			.toBe('Failure details of check')
		await toggle.trigger('click')
		expect(wrapper.find('[data-testid="method-failure-detail"]')
			.exists())
			.toBe(false)
		expect(toggle.attributes('aria-expanded'))
			.toBe('false')
		expect(status(wrapper))
			.toBe('Last call failed')
	})

	it('shows no status and subscribes to nothing when the peer reports no Method snapshot', async () => {
		const { wrapper, preview } = await mountRow({ withSnapshot: false })
		expect(wrapper.find('[data-testid="method-status"]')
			.exists())
			.toBe(false)
		preview.check(false)
		await settle()
		expect(wrapper.find('[data-testid="method-status"]')
			.exists())
			.toBe(false)
		expect(preview.activeMembers.size)
			.toBe(0)
	})

	it('releases its subscription when it goes away', async () => {
		const { wrapper, preview } = await mountRow()
		expect(preview.activeMembers.size)
			.toBe(1)
		wrapper.unmount()
		await settle()
		expect(preview.activeMembers.size)
			.toBe(0)
	})

	it('never invokes the Method: it offers no control other than selecting and disclosing', async () => {
		const { wrapper, preview } = await mountRow()
		preview.check(false)
		await settle()
		expect(wrapper.findAll('button')
			.map(button => button.attributes('data-testid')))
			.toEqual(['method-failure-toggle', 'method-select'])
		expect(preview.requests.filter(method => !['runtime.getWidgetSnapshot', 'runtime.subscribeMember', 'runtime.unsubscribeMember'].includes(method)))
			.toEqual([])
	})

	it('is translated in a zh-TW Lab while the Core text stays verbatim', async () => {
		const { wrapper, preview } = await mountRow({ locale: 'zh-TW' })
		expect(status(wrapper))
			.toBe('沒有失敗紀錄')
		preview.check(false)
		await settle()
		expect(status(wrapper))
			.toBe('上次呼叫失敗')
		expect(wrapper.get('[data-testid="method-diagnostic-message"]')
			.text())
			.toBe('The check failed.')
	})
})

const location = { type: 'method' as const, widgetId: 'root', name: 'submit' }
function text(diagnostics: readonly InspectorRuntimeDiagnostic[]) {
	return mount(MethodDiagnosticList, {
		props: { diagnostics },
		global: { plugins: testGlobalPlugins, provide: labI18nProvide('en') },
	})
}

describe('methodDiagnosticList', () => {
	it('shows the rejected arguments of invalid-method-arguments', () => {
		const wrapper = text([{
			code: 'invalid-method-arguments',
			message: 'The method arguments failed validation.',
			location,
			path: [0, 'name'],
			args: [{ type: 'string', value: 'x', truncated: false }, { type: 'number', value: 2 }],
		}])
		expect(wrapper.findAll('[data-testid="method-diagnostic-args"]'))
			.toHaveLength(2)
		expect(wrapper.text())
			.toContain('"x"')
		expect(wrapper.text())
			.toContain('path[0].name')
	})

	it('shows the dependency, the related location and the diagnostic a dependency failure was caused by', () => {
		const wrapper = text([{
			code: 'dependency-target-failed',
			message: 'A dependency failed.',
			location,
			dependency: { target: { type: 'self' }, operation: { type: 'method-invoke', name: 'validate' } },
			related: [{ type: 'method', widgetId: 'root', name: 'validate' }],
			cause: { code: 'invalid-method-result', message: 'Inner failure', reason: 'inner', location: { ...location, name: 'validate' }, result: { type: 'boolean', value: false } },
		}])
		expect(wrapper.text())
			.toContain('self -> methods.invoke("validate")')
		expect(wrapper.text())
			.toContain('method root.validate')
		const cause = wrapper.get('[data-testid="method-diagnostic-cause"]')
		expect(cause.text())
			.toContain('Caused by')
		expect(cause.get('[data-testid="method-diagnostic-message"]')
			.text())
			.toBe('Inner failure')
		expect(cause.get('[data-testid="method-diagnostic-reason"]')
			.text())
			.toBe('inner')
	})

	it('shows the received value of a rejected dependency value', () => {
		const wrapper = text([{
			code: 'dependency-value-rejected',
			message: 'A dependency value was rejected.',
			location,
			dependency: { target: { type: 'self' }, operation: { type: 'state-get', key: 'count' } },
			related: [{ type: 'state', widgetId: 'root', name: 'count' }],
			received: { type: 'number', value: 7 },
		}])
		expect(wrapper.get('[data-testid="method-diagnostic-received"]')
			.text())
			.toContain('7')
	})

	it('marks what the Inspector snapshot cut and shows the message verbatim, whitespace kept', () => {
		const wrapper = text([{
			code: 'invalid-method-result',
			message: 'Line one\nLine <b>two</b>',
			location,
			result: { type: 'string', value: 'abcde', truncated: true },
		}])
		expect(wrapper.get('[data-testid="value-snapshot-note"]')
			.text())
			.toContain('left out by the Inspector snapshot')
		const message = wrapper.get('[data-testid="method-diagnostic-message"]')
		expect(message.text())
			.toBe('Line one\nLine <b>two</b>')
		expect(message.find('b')
			.exists())
			.toBe(false)
	})

	it('shows only the fields a diagnostic has', () => {
		const wrapper = text([{ code: 'invalid-method-result', message: 'Plain', location }])
		expect(wrapper.find('dl')
			.exists())
			.toBe(false)
		expect(wrapper.find('[data-testid="method-diagnostic-result"]')
			.exists())
			.toBe(false)
	})
})
