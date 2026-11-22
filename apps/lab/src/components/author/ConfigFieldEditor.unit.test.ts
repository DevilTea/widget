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

describe('configFieldEditor commits on Enter or blur, and Esc restores (Lab UX phase 3)', () => {
	const box = (editor: ReturnType<typeof mountEditor>, index = 0) => editor.findAll('input[type="text"]')
		.filter(input => input.attributes('id') !== undefined)[index]!

	it('has no "Set value" button any more', () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		expect(editor.findAll('button')
			.filter(button => button.text() === 'Set value'))
			.toHaveLength(0)
	})

	it('commits a changed text box when it loses focus, and nothing when it was not changed', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		await box(editor)
			.trigger('blur')
		expect(editor.emitted('edit'))
			.toBeUndefined()

		await box(editor)
			.setValue('New title')
		await box(editor)
			.trigger('blur')
		expect(editor.emitted('edit'))
			.toEqual([[['title'], { op: 'replace', value: 'New title' }]])
	})

	it('commits a number on blur and refuses what is not a number there too', async () => {
		const numbers: JsonSchema = { type: 'object', properties: { count: { type: 'number' } } }
		const editor = mountEditor({}, { count: 3 }, numbers)
		await box(editor)
			.setValue('abc')
		await box(editor)
			.trigger('blur')
		expect(editor.emitted('edit'))
			.toBeUndefined()
		expect(editor.get('[role="alert"]')
			.text())
			.toBe('Enter a number, such as 12 or 2.5.')

		await box(editor)
			.setValue('12')
		await box(editor)
			.trigger('blur')
		expect(editor.emitted('edit'))
			.toEqual([[['count'], { op: 'replace', value: 12 }]])
	})

	it('does not commit when focus moves to a control of the same field (its "Use the Document value" button)', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' }, schema)
		await box(editor)
			.setValue('refused')
		await editor.setProps({ resync: { path: 'title', tick: 1, message: 'nope' } })
		const useDocument = editor.findAll('button')
			.find(button => button.text() === 'Use the Document value')!
		await box(editor)
			.trigger('blur', { relatedTarget: useDocument.element })
		expect(editor.emitted('edit'))
			.toBeUndefined()
	})

	it('commits when focus moves to the field\'s own Remove button: the text is not left unsent once focus moves on', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' }, schema)
		await box(editor)
			.setValue('kept')
		const remove = editor.get('button[aria-label="Remove title"]')
		await box(editor)
			.trigger('blur', { relatedTarget: remove.element })
		expect(editor.emitted('edit'))
			.toEqual([[['title'], { op: 'replace', value: 'kept' }]])
	})

	it('esc puts the Document value back and clears the note, and leaves the key alone when there is nothing to restore', async () => {
		const editor = mountEditor({}, { title: 'T', note: 'N' })
		await box(editor)
			.setValue('typed')
		await editor.setProps({ resync: { path: 'title', tick: 1, message: 'nope' } })
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		box(editor).element.dispatchEvent(escape)
		await editor.vm.$nextTick()
		expect((box(editor).element as HTMLInputElement).value)
			.toBe('T')
		expect(editor.find('[data-testid="not-applied"]')
			.exists())
			.toBe(false)
		expect(escape.defaultPrevented)
			.toBe(true)

		const idle = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		box(editor).element.dispatchEvent(idle)
		expect(idle.defaultPrevented)
			.toBe(false)
		// Nothing was committed by Esc.
		expect(editor.emitted('edit'))
			.toBeUndefined()
	})

	it('sends nothing on blur while locked', async () => {
		const editor = mountEditor({ busy: true, locked: true }, { title: 'T', note: 'N' })
		;(box(editor).element as HTMLInputElement).value = 'x'
		await box(editor)
			.trigger('input')
		await box(editor)
			.trigger('blur')
		expect(editor.emitted('edit'))
			.toBeUndefined()
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

		await editor.setProps({ resync: { path: 'title', tick: 1, message: 'Fix or discard the JSON first.' } })

		const inputs = textInputs(editor)
		expect((inputs[0]!.element as HTMLInputElement).value)
			.toBe('rejected title')
		expect((inputs[1]!.element as HTMLInputElement).value)
			.toBe('still being typed')
		const notes = editor.findAll('[data-testid="not-applied"]')
		expect(notes)
			.toHaveLength(1)
		expect(notes[0]!.text())
			.toContain('Not applied: Fix or discard the JSON first.')
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

describe('configFieldEditor shows the selected widget\'s problems at their fields (Lab UX phase 2)', () => {
	const problem = (key: string, configPath: (string | number)[], code = 'invalid-widget-config', message = `bad ${configPath.join('.')}`) =>
		({ key, kind: 'diagnostic' as const, code, message, locationLabel: null, nodeId: null, sourcePath: null, configPath, widgetLevel: false, syntaxSourceText: null, cycle: null })

	it('puts a field\'s problem under its control, verbatim, and marks the control invalid and described by it', () => {
		const editor = mountEditor({ problems: [problem('diagnostic-0', ['title'], 'invalid-widget-config', 'must be short.')] }, { title: 'T', note: 'n' })
		const field = editor.get('[data-config-path="title"]')
		expect(field.get('[data-testid="field-problem"]')
			.text())
			.toBe('invalid-widget-config: must be short.')
		const input = field.get('input')
		expect(input.attributes('aria-invalid'))
			.toBe('true')
		const list = field.get('[data-testid="field-problems"]')
		expect(input.attributes('aria-describedby'))
			.toBe(list.attributes('id'))
		expect(list.attributes('data-problem-keys'))
			.toBe('diagnostic-0')
		// The other field is untouched.
		expect(editor.get('[data-config-path="note"]')
			.find('[data-testid="field-problem"]')
			.exists())
			.toBe(false)
		expect(editor.get('[data-config-path="note"] input')
			.attributes('aria-invalid'))
			.toBe('false')
	})

	it('shows a problem about a key the config does not hold (a missing required key) at the config itself', () => {
		const editor = mountEditor({ problems: [problem('diagnostic-1', ['note'])] }, { title: 'T' })
		const root = editor.get('[data-config-path=""]')
		expect(root.attributes('data-has-problems'))
			.toBe('true')
		expect(root.get('[role="group"]')
			.attributes('aria-describedby'))
			.toBe(root.get('[data-testid="field-problems"]')
				.attributes('id'))
		expect(editor.findAll('[data-testid="field-problem"]'))
			.toHaveLength(1)
	})

	it('describes the control by both its problems and a "not applied" note', async () => {
		const editor = mountEditor({ problems: [problem('diagnostic-0', ['title'])] }, { title: 'T' })
		await editor.setProps({ resync: { path: 'title', tick: 1, message: 'nope' } })
		const described = editor.get('[data-config-path="title"] input')
			.attributes('aria-describedby')!
			.split(' ')
		expect(described)
			.toHaveLength(2)
		expect(described[1])
			.toMatch(/-not-applied$/)
	})
})
