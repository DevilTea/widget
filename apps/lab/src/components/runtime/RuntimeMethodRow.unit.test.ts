// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import RuntimeMethodRow from './RuntimeMethodRow.vue'

const EMITS_TOOLTIP = 'Emits an Event directly or through the Methods it invokes'

function mountRow(props: { transitivelyWrites: boolean, transitivelyEmits?: boolean }, locale: 'en' | 'zh-TW' = 'en') {
	return mount(RuntimeMethodRow, {
		props: { name: 'ping', selected: false, ...props },
		global: {
			// `pika()` is replaced by the PikaCSS build transform, which the unit test pipeline does not run.
			mocks: { pika: () => '' },
			provide: {
				[LabI18nKey as symbol]: {
					locale: shallowRef(locale),
					locales: ['en', 'zh-TW'],
					setLocale: () => {},
					t: (source: string) => locale === 'zh-TW' && source === EMITS_TOOLTIP ? '直接或透過它所呼叫的 Methods 發出 Event' : source,
				},
			},
		},
	})
}

describe('runtimeMethodRow effect markers', () => {
	it('shows neither marker for a Method that neither writes nor emits', () => {
		const text = mountRow({ transitivelyWrites: false, transitivelyEmits: false })
			.text()
		expect(text)
			.not
			.toContain('writes')
		expect(text)
			.not
			.toContain('emits')
	})

	it('shows only the emits marker, with its tooltip, for a Method that emits', () => {
		const wrapper = mountRow({ transitivelyWrites: false, transitivelyEmits: true })
		expect(wrapper.text())
			.toContain('emits')
		expect(wrapper.text())
			.not
			.toContain('writes')
		expect(wrapper.find('[title]')
			.attributes('title'))
			.toBe(EMITS_TOOLTIP)
	})

	it('shows only the writes marker for a Method that writes', () => {
		const text = mountRow({ transitivelyWrites: true, transitivelyEmits: false })
			.text()
		expect(text)
			.toContain('writes')
		expect(text)
			.not
			.toContain('emits')
	})

	it('shows both markers for a Method that writes and emits', () => {
		const text = mountRow({ transitivelyWrites: true, transitivelyEmits: true })
			.text()
		expect(text)
			.toContain('writes')
		expect(text)
			.toContain('emits')
	})

	it('treats an absent transitivelyEmits (Inspector below protocol 0.4) as unknown: no marker', () => {
		const text = mountRow({ transitivelyWrites: false })
			.text()
		expect(text)
			.not
			.toContain('emits')
		expect(text)
			.not
			.toContain('writes')
	})

	it('localizes the tooltip through the Lab i18n store', () => {
		expect(mountRow({ transitivelyWrites: false, transitivelyEmits: true }, 'zh-TW')
			.find('[title]')
			.attributes('title'))
			.toBe('直接或透過它所呼叫的 Methods 發出 Event')
	})
})
