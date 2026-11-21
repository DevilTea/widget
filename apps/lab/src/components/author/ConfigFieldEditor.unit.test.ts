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
	it('keeps what was chosen or typed for a new field or key until the Document holds it (an edit not reported, or refused, keeps it)', async () => {
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
		// Reported, but the Document does not hold it yet (the command may still be refused): the key stays.
		expect((keyBox.element as HTMLInputElement).value)
			.toBe('fr')
		// Applied: the Document now has the key, so the box is cleared.
		await editor.setProps({ value: { en: 'x', fr: '' } })
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

		// Reported but refused (the Document never gains `note`): the choice is kept for another try.
		await optional.setProps({ busy: false })
		await optional.findAll('button')
			.find(button => button.text() === 'Add field')!
			.trigger('click')
		expect(optional.emitted('edit'))
			.toEqual([[['note'], { op: 'add', value: '' }]])
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
	const textInputs = (editor: ReturnType<typeof mountEditor>) => editor.findAll('input[type="text"]')
		.filter(input => input.attributes('id') !== undefined)

	it('keeps the rejected text in that box only, says why it was not applied, and leaves other fields alone', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		const [title, note] = textInputs(editor)
		await title!.setValue('rejected title')
		await note!.setValue('still being typed')

		await editor.setProps({ resync: { path: 'title', tick: 1, message: 'Apply or Revert the JSON draft first.' } })

		const inputs = textInputs(editor)
		expect((inputs[0]!.element as HTMLInputElement).value)
			.toBe('rejected title')
		expect((inputs[1]!.element as HTMLInputElement).value)
			.toBe('still being typed')
		const notes = editor.findAll('[data-testid="not-applied"]')
		expect(notes)
			.toHaveLength(1)
		expect(notes[0]!.text())
			.toContain('Not applied: Apply or Revert the JSON draft first.')
	})

	it('goes back to the Document value on request, and forgets the refusal once the Document changes', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		await textInputs(editor)[0]!.setValue('rejected')
		await editor.setProps({ resync: { path: 'title', tick: 1 } })
		expect(editor.get('[data-testid="not-applied"]')
			.text())
			.toContain('The change was not applied.')

		await editor.findAll('button')
			.find(button => button.text() === 'Use the Document value')!
			.trigger('click')
		expect((textInputs(editor)[0]!.element as HTMLInputElement).value)
			.toBe('T')
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(false)

		await textInputs(editor)[0]!.setValue('again')
		await editor.setProps({ resync: { path: 'title', tick: 2 } })
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(true)
		await editor.setProps({ value: { title: 'T2', note: 'N' } })
		expect((textInputs(editor)[0]!.element as HTMLInputElement).value)
			.toBe('T2')
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(false)
	})

	it('ties the note to the box, returns focus to the box from the button, and drops the note when the Document value is typed back', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' }, schema)
		editor.element.ownerDocument.body.append(editor.element)
		const box = () => textInputs(editor)[0]!
		await box()
			.setValue('rejected')
		await editor.setProps({ resync: { path: 'title', tick: 1, message: 'why' } })
		const note = editor.get('[data-testid="not-applied"]')
		expect(box()
			.attributes('aria-describedby'))
			.toBe(note.attributes('id'))

		await editor.findAll('button')
			.find(button => button.text() === 'Use the Document value')!
			.trigger('click')
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(editor.element.ownerDocument.activeElement)
			.toBe(box().element)
		expect(box()
			.attributes('aria-describedby'))
			.toBeUndefined()

		await box()
			.setValue('rejected again')
		await editor.setProps({ resync: { path: 'title', tick: 2 } })
		await box()
			.setValue('T')
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(false)
		editor.unmount()
	})

	it('keeps a refused number too, but re-creates a switch so it shows the Document', async () => {
		const mixed: JsonSchema = { type: 'object', properties: { count: { type: 'number' }, on: { type: 'boolean' } }, additionalProperties: false }
		const editor = mountEditor({}, { count: 1, on: true }, mixed)
		await textInputs(editor)[0]!.setValue('5')
		await editor.setProps({ resync: { path: 'count', tick: 1 } })
		expect((textInputs(editor)[0]!.element as HTMLInputElement).value)
			.toBe('5')
		expect(editor.find('[data-config-path="count"] [data-testid="not-applied"]')
			.exists())
			.toBe(true)

		const switchBefore = editor.get('[data-config-path="on"] [role="switch"]').element
		await editor.setProps({ resync: { path: 'on', tick: 2 } })
		expect(editor.get('[data-config-path="on"] [role="switch"]').element)
			.not
			.toBe(switchBefore)
		expect(editor.find('[data-config-path="on"] [data-testid="not-applied"]')
			.exists())
			.toBe(false)
	})

	it('keeps a refused JSON text when the config is re-read as an equal new object, and replaces it when the content changes', async () => {
		const editor = mountEditor({ asJson: true }, { a: 1 }, null)
		const area = () => editor.get('textarea')
		await area()
			.setValue('{ "a": 2 }')
		await editor.setProps({ resync: { path: '', tick: 1 } })
		await editor.setProps({ value: { a: 1 } })
		expect((area().element as HTMLTextAreaElement).value)
			.toBe('{ "a": 2 }')
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(true)
		await editor.setProps({ value: { a: 3 } })
		expect(JSON.parse((area().element as HTMLTextAreaElement).value))
			.toEqual({ a: 3 })
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(false)
	})

	it('does nothing for a path it does not own', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		await textInputs(editor)[1]!.setValue('typed')
		await editor.setProps({ resync: { path: 'title', tick: 1 } })
		expect((textInputs(editor)[1]!.element as HTMLInputElement).value)
			.toBe('typed')
		expect(editor.findAll('[data-testid="not-applied"]'))
			.toHaveLength(1)
	})
})
