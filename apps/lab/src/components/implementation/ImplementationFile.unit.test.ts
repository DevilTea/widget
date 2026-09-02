// @vitest-environment happy-dom
/**
 * Latest-selection-wins regression (P3 merge-gate review round 1, blocker 1): `ImplementationFile.vue`
 * is reused across selections with no `:key`, so an out-of-order async `load()` settlement must never
 * let a stale selection overwrite a newer one's `code`/`status` — for either a stale ok or a stale
 * rejection. Uses two independently-controllable deferred promises so the resolution ORDER (not the
 * selection order) is what this test actually drives, matching the exact hazard the review described:
 * select A -> select B -> B resolves first -> A resolves late.
 *
 * `ImplementationSourceView` is stubbed to a trivial `{{ code }}` template: this test is about the
 * file-load race, not Shiki's own (separately covered) async highlighting. #43 supplies an English
 * identity translator so the new presentation-only locale dependency does not alter this race contract.
 */
import type { CuratedSourceFile } from '../../implementation/types'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import ImplementationFile from './ImplementationFile.vue'

interface Deferred<T> {
	readonly promise: Promise<T>
	readonly resolve: (value: T) => void
	readonly reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function createFile(path: string, load: () => Promise<string>): CuratedSourceFile {
	return { kind: 'plugin', title: path, path, load }
}

const globalStubConfig = {
	global: {
		config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
		provide: {
			[LabI18nKey as symbol]: {
				locale: { value: 'en' },
				locales: ['en', 'zh-TW'],
				setLocale: () => {},
				t: (source: string, params?: Readonly<Record<string, string | number>>) => source.replace(/\{([\w-]+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
			},
		},
		stubs: {
			ImplementationSourceView: {
				props: ['code', 'lang'],
				template: '<div data-testid="stub-code">{{ code }}</div>',
			},
		},
	},
}

describe('implementationFile — latest-selection-wins', () => {
	it('a stale SUCCESSFUL resolution for a previous selection never overwrites the current selection', async () => {
		const deferredA = createDeferred<string>()
		const deferredB = createDeferred<string>()
		const fileA = createFile('a.ts', () => deferredA.promise)
		const fileB = createFile('b.ts', () => deferredB.promise)

		const wrapper = mount(ImplementationFile, { props: { file: fileA }, ...globalStubConfig })

		// Select B before A has resolved at all — A's in-flight `load()` is now stale.
		await wrapper.setProps({ file: fileB })

		// B resolves first (the exact hazard: the LATER selection settles FIRST).
		deferredB.resolve('B content')
		await flushPromises()

		expect(wrapper.find('[data-testid="stub-code"]')
			.exists())
			.toBe(true)
		expect(wrapper.find('[data-testid="stub-code"]')
			.text())
			.toBe('B content')

		// A resolves late — must be silently discarded, not overwrite B.
		deferredA.resolve('A content (stale)')
		await flushPromises()

		expect(wrapper.find('[data-testid="stub-code"]')
			.text())
			.toBe('B content')
		expect(wrapper.text())
			.not.toContain('Loading')
		expect(wrapper.text())
			.not.toContain('Failed to load')
	})

	it('a stale REJECTED resolution for a previous selection never flips the current selection to error', async () => {
		const deferredA = createDeferred<string>()
		const deferredB = createDeferred<string>()
		const fileA = createFile('a.ts', () => deferredA.promise)
		const fileB = createFile('b.ts', () => deferredB.promise)

		const wrapper = mount(ImplementationFile, { props: { file: fileA }, ...globalStubConfig })

		await wrapper.setProps({ file: fileB })

		deferredB.resolve('B content')
		await flushPromises()
		expect(wrapper.find('[data-testid="stub-code"]')
			.text())
			.toBe('B content')

		// A rejects late — must never flip the already-`ready` B view into the error state.
		deferredA.reject(new Error('stale load failure'))
		await flushPromises()

		expect(wrapper.find('[data-testid="stub-code"]')
			.exists())
			.toBe(true)
		expect(wrapper.find('[data-testid="stub-code"]')
			.text())
			.toBe('B content')
		expect(wrapper.text())
			.not.toContain('Failed to load')
	})
})
