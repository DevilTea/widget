// @vitest-environment happy-dom
import type { JsonSchema } from '../../lab/config-schema'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { testGlobalPlugins } from '../../test-support-ui'
import ConfigFieldEditor from './ConfigFieldEditor.vue'

const global = {
	plugins: testGlobalPlugins,
	provide: {
		[LabI18nKey as symbol]: {
			locale: { value: 'en' },
			locales: ['en', 'zh-TW'],
			setLocale: () => {},
			t: (source: string, params?: Record<string, string | number>) => source.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
		},
	},
}

const schema: JsonSchema = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		note: { type: 'string' },
	},
	additionalProperties: false,
}

function mountEditor(props: Record<string, unknown>, value: unknown = { title: 'T' }, root: JsonSchema | null = schema) {
	return mount(ConfigFieldEditor, {
		props: { root, schema: root, value, path: [], label: 'config', bare: true, busy: false, ...props },
		global,
	})
}

describe('configFieldEditor while a command runs', () => {
	it('keeps what was chosen or typed for a new field or key when the edit is not reported, and clears it once it is', async () => {
		const free: JsonSchema = { type: 'object', additionalProperties: { type: 'string' } }
		const editor = mountEditor({ busy: true }, { en: 'x' }, free)
		const keyBox = editor.get('input[type="text"][placeholder="New key"]')
		await keyBox.setValue('fr')
		const addKey = editor.findAll('button')
			.find(button => button.text() === 'Add key')!
		await addKey.trigger('click')
		expect(editor.emitted('edit'))
			.toBeUndefined()
		expect((keyBox.element as HTMLInputElement).value)
			.toBe('fr')

		await editor.setProps({ busy: false })
		await addKey.trigger('click')
		expect(editor.emitted('edit'))
			.toEqual([[['fr'], { op: 'add', value: '' }]])
		expect((keyBox.element as HTMLInputElement).value)
			.toBe('')

		const optional = mountEditor({ busy: true })
		const select = optional.get('select[aria-label="Optional field to add to config"]')
		await select.setValue('note')
		await optional.findAll('button')
			.find(button => button.text() === 'Add field')!
			.trigger('click')
		expect(optional.emitted('edit'))
			.toBeUndefined()
		expect((select.element as HTMLSelectElement).value)
			.toBe('note')
	})

	it('has no disabled control, so keyboard focus is never handed to the page by a commit', () => {
		const editor = mountEditor({ busy: true })
		expect(editor.findAll('[disabled]'))
			.toHaveLength(0)
		expect(editor.findAll('[aria-disabled="true"]').length)
			.toBeGreaterThan(0)
	})
})

describe('configFieldEditor after a refused commit', () => {
	it('shows the Document\'s value again in the control at that path only; other fields keep their uncommitted text', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		const [title, note] = editor.findAll('input[type="text"]')
			.filter(input => input.attributes('id') !== undefined)
		await title!.setValue('rejected title')
		await note!.setValue('still being typed')

		await editor.setProps({ resync: { path: 'title', tick: 1 } })

		const inputs = editor.findAll('input[type="text"]')
			.filter(input => input.attributes('id') !== undefined)
		expect((inputs[0]!.element as HTMLInputElement).value)
			.toBe('T')
		expect((inputs[1]!.element as HTMLInputElement).value)
			.toBe('still being typed')
	})

	it('does nothing for a path it does not own, and acts again for a repeated request', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		const inputs = () => editor.findAll('input[type="text"]')
			.filter(input => input.attributes('id') !== undefined)
		await inputs()[1]!.setValue('typed')
		await editor.setProps({ resync: { path: 'title', tick: 1 } })
		expect((inputs()[1]!.element as HTMLInputElement).value)
			.toBe('typed')

		await inputs()[0]!.setValue('again')
		await editor.setProps({ resync: { path: 'title', tick: 2 } })
		expect((inputs()[0]!.element as HTMLInputElement).value)
			.toBe('T')
	})
})
