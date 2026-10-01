// @vitest-environment happy-dom
/**
 * `ImplementationSourceView` keeps source bytes/text outside both presentation preferences: Shiki
 * escapes arbitrary markup, #44 themes presentation only, #43 localizes viewer chrome only, and #46
 * keeps literal U+0009 tabs on the four-column rendering/copy contract.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { LabThemeKey } from '../../composables/use-lab-theme'
import * as shikiHighlighter from '../../implementation/shiki-highlighter'
import { testGlobalProperties } from '../../test-support'
import ImplementationSourceView from './ImplementationSourceView.vue'

const theme = shallowRef<'light' | 'dark'>('dark')
const globalStubConfig = {
	global: {
		config: { globalProperties: testGlobalProperties },
		provide: {
			[LabI18nKey as symbol]: {
				locale: { value: 'en' },
				locales: ['en', 'zh-TW'],
				setLocale: () => {},
				t: (source: string) => source,
			},
			[LabThemeKey as symbol]: {
				theme,
				themes: ['light', 'dark'],
				setTheme: (next: 'light' | 'dark') => { theme.value = next },
			},
		},
	},
}

afterEach(() => {
	vi.restoreAllMocks()
})

async function waitForCode(wrapper: ReturnType<typeof mount>): Promise<void> {
	await vi.waitFor(async () => {
		await flushPromises()
		expect(wrapper.find('[data-testid="implementation-code"]')
			.exists())
			.toBe(true)
	})
}

interface Deferred<T> {
	readonly promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

async function settle<T>(deferred: Deferred<T>): Promise<void> {
	await deferred.promise.catch(() => undefined)
	await nextTick()
}

function expectReadyWithLatestHighlight(wrapper: ReturnType<typeof mount>, marker: string): void {
	expect(wrapper.find('[data-testid="implementation-code"]')
		.exists())
		.toBe(true)
	expect(wrapper.get('[data-testid="implementation-code"]')
		.text())
		.toBe(marker)
	expect(wrapper.text())
		.not.toContain('Loading…')
	expect(wrapper.text())
		.not.toContain('Failed to render this source.')
}

describe('implementationSourceView', () => {
	it('renders arbitrary source as escaped text, never injected live markup', async () => {
		const payload = '<img src=x onerror="window.__pwned = true">'
		const wrapper = mount(ImplementationSourceView, {
			props: { code: payload, lang: 'typescript' },
			...globalStubConfig,
		})

		await waitForCode(wrapper)

		const codeBlock = wrapper.find('[data-testid="implementation-code"]')
		expect(codeBlock.findAll('img').length)
			.toBe(0)
		expect(codeBlock.text())
			.toContain(payload)
	})

	it('renders a literal tab at four columns and copies the original tab-containing source unchanged', async () => {
		const payload = 'const value = {\n\tanswer: 42,\n}'
		const writeText = vi.fn<(text: string) => Promise<void>>()
			.mockResolvedValue(undefined)
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		})

		const wrapper = mount(ImplementationSourceView, {
			props: { code: payload, lang: 'typescript' },
			...globalStubConfig,
		})

		await waitForCode(wrapper)

		const codeBlock = wrapper.find('[data-testid="implementation-code"]')
		expect((codeBlock.element as HTMLElement).style.tabSize)
			.toBe('4')
		expect(codeBlock.text())
			.toContain('\tanswer: 42,')

		await wrapper.get('button')
			.trigger('click')
		await flushPromises()
		expect(writeText)
			.toHaveBeenCalledWith(payload)
	})

	it('keeps the newest highlight when an older successful highlight settles later', async () => {
		const older = createDeferred<string>()
		const newer = createDeferred<string>()
		const highlight = vi.spyOn(shikiHighlighter, 'highlightSource')
			.mockImplementation(code => code === 'older source' ? older.promise : newer.promise)
		const wrapper = mount(ImplementationSourceView, {
			props: { code: 'older source', lang: 'typescript' },
			...globalStubConfig,
		})

		expect(highlight)
			.toHaveBeenCalledTimes(1)
		expect(wrapper.text())
			.toContain('Loading…')

		await wrapper.setProps({ code: 'newer source' })
		expect(highlight)
			.toHaveBeenCalledTimes(2)
		expect(wrapper.text())
			.toContain('Loading…')

		newer.resolve('<span>newer highlighted result</span>')
		await settle(newer)
		expectReadyWithLatestHighlight(wrapper, 'newer highlighted result')

		older.resolve('<span>stale older highlighted result</span>')
		await settle(older)
		expectReadyWithLatestHighlight(wrapper, 'newer highlighted result')
		expect(wrapper.get('[data-testid="implementation-code"]')
			.html())
			.not.toContain('stale older highlighted result')

		wrapper.unmount()
	})

	it('keeps the newest highlight when an older rejection settles later', async () => {
		const older = createDeferred<string>()
		const newer = createDeferred<string>()
		const highlight = vi.spyOn(shikiHighlighter, 'highlightSource')
			.mockImplementation(code => code === 'older source' ? older.promise : newer.promise)
		const wrapper = mount(ImplementationSourceView, {
			props: { code: 'older source', lang: 'typescript' },
			...globalStubConfig,
		})

		expect(highlight)
			.toHaveBeenCalledTimes(1)

		await wrapper.setProps({ code: 'newer source' })
		expect(highlight)
			.toHaveBeenCalledTimes(2)

		newer.resolve('<span>newer highlighted result</span>')
		await settle(newer)
		expectReadyWithLatestHighlight(wrapper, 'newer highlighted result')

		older.reject(new Error('stale older highlight failure'))
		await settle(older)
		expectReadyWithLatestHighlight(wrapper, 'newer highlighted result')

		wrapper.unmount()
	})
})
