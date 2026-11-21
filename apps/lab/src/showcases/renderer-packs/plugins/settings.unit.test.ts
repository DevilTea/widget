/**
 * The workspace settings plugins against real Core Runtimes: what the providers hold, how a field reads them through a
 * named dependency (no ancestor lookup), `confirm` invoking the Notifier's Method, the Events, the refusals and their
 * diagnostics, and the Method effects Core derives for Relations.
 */

import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultPacksPreset } from '../presets'
import { packsSystem } from '../system'
import { createPacksRuntime, failureOf, valueOf, widgetsOf } from '../test-support'

function listen(widget: { readonly events: Record<string, { readonly subscribe: (listener: (...args: any[]) => void) => () => void }> }, names: readonly string[]): { readonly heard: { readonly name: string, readonly args: readonly unknown[] }[] } {
	const heard: { name: string, args: readonly unknown[] }[] = []
	for (const name of names)
		widget.events[name]!.subscribe((...args) => heard.push({ name, args }))
	return { heard }
}

describe('appearance and the fields that read it', () => {
	it('starts comfortable and auto, and every field reads the density it names', () => {
		const { runtime } = createPacksRuntime()
		const widgets = widgetsOf(runtime)
		expect(widgets.appearance.state.density.get())
			.toBe('comfortable')
		expect(widgets.appearance.state.mode.get())
			.toBe('auto')
		for (const field of [widgets.workspaceName, widgets.tagline, widgets.weekStart, widgets.digest, widgets.beta, widgets.clearCache, widgets.archive]) {
			expect(valueOf(field.properties.density.get()))
				.toBe('comfortable')
		}
	})

	it('changes the density of every field when the Appearance changes, and the page\'s own appearance Property follows', () => {
		const { runtime } = createPacksRuntime()
		const widgets = widgetsOf(runtime)
		expect(valueOf(widgets.page.properties.appearance.get()))
			.toEqual({ mode: 'auto', density: 'comfortable' })
		widgets.appearance.state.density.set('compact')
		widgets.appearance.state.mode.set('dark')
		for (const field of [widgets.workspaceName, widgets.tagline, widgets.weekStart, widgets.digest, widgets.beta, widgets.clearCache, widgets.archive]) {
			expect(valueOf(field.properties.density.get()))
				.toBe('compact')
		}
		expect(valueOf(widgets.page.properties.appearance.get()))
			.toEqual({ mode: 'dark', density: 'compact' })
	})

	it('refuses a density or a mode it does not know (State validation)', () => {
		const { runtime } = createPacksRuntime()
		const { appearance } = widgetsOf(runtime)
		expect(appearance.state.density.set('huge' as never).ok)
			.toBe(false)
		expect(appearance.state.mode.set('sepia' as never).ok)
			.toBe(false)
		expect(appearance.state.density.get())
			.toBe('comfortable')
	})

	it('reports a second Appearance in providers: the page reads one, and nothing picks the nearest of several', () => {
		const source = JSON.parse(defaultPacksPreset.sourceText)
		source.slots.providers.push({ id: 'other-look', type: 'Appearance', config: { density: 'compact' } })
		expect(packsSystem.createBlueprint(source).diagnostics.map(diagnostic => ({ code: diagnostic.code, widget: diagnostic.location.type === 'widget' ? diagnostic.location.node.id : null, reason: 'reason' in diagnostic ? diagnostic.reason : undefined })))
			.toEqual([{ code: 'invalid-widget-structure', widget: 'other-look', reason: 'at-most-one-appearance' }])
	})
})

describe('textField', () => {
	it('stores any string and says in Property `message` when the value is too long, in both languages', () => {
		const { runtime } = createPacksRuntime()
		const { workspaceName } = widgetsOf(runtime)
		expect(valueOf(workspaceName.properties.message.get()))
			.toBeNull()
		workspaceName.state.value.set('A workspace name that is far too long')
		expect(workspaceName.state.value.get())
			.toBe('A workspace name that is far too long')
		expect(valueOf(workspaceName.properties.message.get()))
			.toEqual({ 'en': 'Too long: 37 of 24 characters allowed.', 'zh-TW': '太長了：最多 24 個字元，目前 37 個。' })
		workspaceName.state.value.set('Short')
		expect(valueOf(workspaceName.properties.message.get()))
			.toBeNull()
	})

	it('counts characters as a person does (an emoji is one)', () => {
		const { runtime } = createPacksRuntime()
		const { tagline } = widgetsOf(runtime)
		tagline.state.value.set('🌊'.repeat(40))
		expect(valueOf(tagline.properties.message.get()))
			.toBeNull()
		tagline.state.value.set('🌊'.repeat(41))
		expect(valueOf(tagline.properties.message.get())?.en)
			.toBe('Too long: 41 of 40 characters allowed.')
	})
})

describe('choice and Toggle', () => {
	it('start at the configured option and switch, and Choice refuses a value that is not an option', () => {
		const { runtime } = createPacksRuntime()
		const { weekStart, digest, beta } = widgetsOf(runtime)
		expect(weekStart.state.value.get())
			.toBe('monday')
		weekStart.state.value.set('sunday')
		expect(weekStart.state.value.get())
			.toBe('sunday')
		expect(weekStart.state.value.set('friday').ok)
			.toBe(false)
		expect(weekStart.state.value.get())
			.toBe('sunday')
		expect(digest.state.on.get())
			.toBe(true)
		expect(beta.state.on.get())
			.toBe(false)
		beta.state.on.set(true)
		expect(beta.state.on.get())
			.toBe(true)
	})
})

describe('notifier', () => {
	it('notify appends, emits `notified` with the notification and returns the id; the page announces the newest alert and status', () => {
		const { runtime } = createPacksRuntime()
		const { notifier } = widgetsOf(runtime)
		const { heard } = listen(notifier, ['notified'])
		expect(valueOf(notifier.methods.notify({ en: 'Saved' }, 'success')))
			.toBe(1)
		expect(valueOf(notifier.methods.notify({ en: 'Careful' }, 'danger')))
			.toBe(2)
		expect(valueOf(notifier.methods.notify({ en: 'Later' }, 'info')))
			.toBe(3)
		expect(heard)
			.toEqual([
				{ name: 'notified', args: [{ id: 1, message: { en: 'Saved' }, tone: 'success' }] },
				{ name: 'notified', args: [{ id: 2, message: { en: 'Careful' }, tone: 'danger' }] },
				{ name: 'notified', args: [{ id: 3, message: { en: 'Later' }, tone: 'info' }] },
			])
		expect(valueOf(notifier.properties.alert.get()))
			.toEqual({ id: 2, message: { en: 'Careful' }, tone: 'danger' })
		expect(valueOf(notifier.properties.status.get()))
			.toEqual({ id: 3, message: { en: 'Later' }, tone: 'info' })
		expect(valueOf(notifier.properties.count.get()))
			.toBe(3)
	})

	it('keeps only the newest `limit` notifications and never reuses an id', () => {
		const { runtime } = createPacksRuntime()
		const { notifier } = widgetsOf(runtime)
		for (let index = 1; index <= 6; index++)
			notifier.methods.notify({ en: `n${index}` }, 'info')
		expect(notifier.state.items.get()!.map(item => item.id))
			.toEqual([3, 4, 5, 6])
		notifier.methods.dismiss(6)
		expect(valueOf(notifier.methods.notify({ en: 'again' }, 'info')))
			.toBe(6)
	})

	it('refuses a malformed notification and an unknown dismissal, writes and emits nothing, and records the diagnostic', () => {
		const { runtime } = createPacksRuntime()
		const { notifier } = widgetsOf(runtime)
		const { heard } = listen(notifier, ['notified'])
		expect(notifier.methods.notify({ 'zh-TW': 'x' } as never, 'loud' as never).ok)
			.toBe(false)
		expect(failureOf(notifier.methods.notify))
			.toEqual([
				{ code: 'invalid-method-arguments', reason: 'invalid-message' },
				{ code: 'invalid-method-arguments', reason: 'unknown-tone' },
			])
		expect(notifier.methods.dismiss(99).ok)
			.toBe(false)
		expect(failureOf(notifier.methods.dismiss))
			.toEqual([{ code: 'invalid-method-result', reason: 'no-such-item' }])
		expect(notifier.state.items.get())
			.toEqual([])
		expect(heard)
			.toEqual([])
	})
})

describe('dangerAction', () => {
	it('ask opens the confirmation, cancel closes it, and each refusal is a diagnostic that changes nothing', () => {
		const { runtime } = createPacksRuntime()
		const { archive } = widgetsOf(runtime)
		expect(archive.state.confirming.get())
			.toBe(false)
		expect(archive.methods.cancel().ok)
			.toBe(false)
		expect(failureOf(archive.methods.cancel))
			.toEqual([{ code: 'invalid-method-result', reason: 'not-asking' }])
		expect(valueOf(archive.methods.ask()))
			.toBe(true)
		expect(archive.state.confirming.get())
			.toBe(true)
		expect(archive.methods.ask().ok)
			.toBe(false)
		expect(failureOf(archive.methods.ask))
			.toEqual([{ code: 'invalid-method-result', reason: 'already-asking' }])
		expect(valueOf(archive.methods.cancel()))
			.toBe(true)
		expect(archive.state.confirming.get())
			.toBe(false)
		expect(failureOf(archive.methods.cancel))
			.toEqual([])
	})

	it('confirm invokes the Notifier\'s notify through the named dependency, closes the question and emits `confirmed`', () => {
		const { runtime } = createPacksRuntime()
		const { archive, clearCache, notifier } = widgetsOf(runtime)
		const confirmed = listen(archive, ['confirmed'])
		const notified = listen(notifier, ['notified'])
		archive.methods.ask()
		expect(valueOf(archive.methods.confirm()))
			.toBe(true)
		expect(archive.state.confirming.get())
			.toBe(false)
		expect(confirmed.heard)
			.toEqual([{ name: 'confirmed', args: [{ tone: 'danger', message: { 'en': 'Workspace archived.', 'zh-TW': '工作區已封存。' } }] }])
		expect(notified.heard)
			.toEqual([{ name: 'notified', args: [{ id: 1, message: { 'en': 'Workspace archived.', 'zh-TW': '工作區已封存。' }, tone: 'danger' }] }])
		clearCache.methods.ask()
		clearCache.methods.confirm()
		expect(notifier.state.items.get()!.map(item => [item.id, item.tone]))
			.toEqual([[1, 'danger'], [2, 'success']])
		expect(valueOf(notifier.properties.alert.get())?.id)
			.toBe(1)
		expect(valueOf(notifier.properties.status.get())?.id)
			.toBe(2)
	})

	it('refuses confirm unless the question is open: nothing is notified or emitted, and the diagnostic says why', () => {
		const { runtime } = createPacksRuntime()
		const { archive, notifier } = widgetsOf(runtime)
		const confirmed = listen(archive, ['confirmed'])
		expect(archive.methods.confirm().ok)
			.toBe(false)
		expect(failureOf(archive.methods.confirm))
			.toEqual([{ code: 'invalid-method-result', reason: 'not-asking' }])
		expect(archive.methods.confirm.getDiagnostics()[0]?.message)
			.toBe('Nothing to confirm: ask() opens the confirmation first.')
		expect(notifier.state.items.get())
			.toEqual([])
		expect(confirmed.heard)
			.toEqual([])
	})

	it('names its Notifier by id: a document with two Notifiers sends each action to the one it names', () => {
		const source = JSON.parse(defaultPacksPreset.sourceText)
		source.slots.providers.push({ id: 'audit-log', type: 'Notifier', config: { limit: 2 } })
		source.slots.sections[2].slots.fields[0].config.notifier = 'audit-log'
		const { runtime } = createPacksRuntime(JSON.stringify(source))
		const clearCache = widgetsOf(runtime).clearCache
		const archive = widgetsOf(runtime).archive
		clearCache.methods.ask()
		clearCache.methods.confirm()
		archive.methods.ask()
		archive.methods.confirm()
		const audit = runtime.getWidget('audit-log')
		const notifier = widgetsOf(runtime).notifier
		expect(audit?.type === 'Notifier' ? audit.state.items.get()!.map(item => item.message.en) : null)
			.toEqual(['Local cache cleared.'])
		expect(notifier.state.items.get()!.map(item => item.message.en))
			.toEqual(['Workspace archived.'])
	})

	it('derives the effects Relations shows: ask and cancel write State, confirm writes and emits, and nothing else does', () => {
		const blueprint = packsSystem.createBlueprint(JSON.parse(defaultPacksPreset.sourceText))
		const effects = Object.fromEntries(inspectBlueprint(blueprint).nodes.flatMap(node => node.resolved && node.node.id === 'archive-workspace'
			? node.methods.map(method => [method.name, { writes: method.transitivelyWrites, emits: method.transitivelyEmits }] as const)
			: []))
		expect(effects)
			.toEqual({
				ask: { writes: true, emits: false },
				cancel: { writes: true, emits: false },
				confirm: { writes: true, emits: true },
			})
	})
})

describe('structure: widgets that name other widgets', () => {
	it('reports a field whose appearance or a DangerAction whose notifier names no widget, or the wrong type, as located structure diagnostics', () => {
		const source = JSON.parse(defaultPacksPreset.sourceText)
		source.slots.sections[0].slots.fields[0].config.appearance = 'missing'
		source.slots.sections[0].slots.fields[1].config.appearance = 'notifier'
		source.slots.sections[2].slots.fields[0].config.notifier = 'appearance'
		source.slots.sections[2].slots.fields[1].config.notifier = 'nobody'
		const found = packsSystem.createBlueprint(source).diagnostics.map(diagnostic => ({
			code: diagnostic.code,
			widget: diagnostic.location.type === 'widget' ? diagnostic.location.node.id : null,
			reason: 'reason' in diagnostic ? diagnostic.reason : undefined,
		}))
		expect(found)
			.toEqual(expect.arrayContaining([
				{ code: 'invalid-widget-structure', widget: 'workspace-name', reason: 'unknown-appearance' },
				{ code: 'invalid-widget-structure', widget: 'tagline', reason: 'not-an-appearance' },
				{ code: 'invalid-widget-structure', widget: 'clear-cache', reason: 'not-a-notifier' },
				{ code: 'invalid-widget-structure', widget: 'archive-workspace', reason: 'unknown-notifier' },
			]))
		expect(found)
			.toHaveLength(4)
	})

	it('keeps a provider out of the fields and a field out of the providers', () => {
		const source = JSON.parse(defaultPacksPreset.sourceText)
		source.slots.sections[1].slots.fields.push({ id: 'second-notifier', type: 'Notifier' })
		source.slots.providers.push({ id: 'stray-toggle', type: 'Toggle', config: { label: { en: 'x' }, appearance: 'appearance' } })
		const reasons = packsSystem.createBlueprint(source).diagnostics.map(diagnostic => 'reason' in diagnostic ? diagnostic.reason : undefined)
		expect(reasons)
			.toEqual(expect.arrayContaining(['not-a-field', 'not-a-provider', 'outside-section']))
	})
})
