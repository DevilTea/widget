import type { BlueprintInspectionNode, ResolvedBlueprintInspectionNode } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultVuetifyTaskPreset, vuetifyTaskPresets } from './presets'
import { vuetifyTaskSystem } from './system'
import { createVuetifyTaskRuntime, widgetOfType } from './test-support'

function compileDefault() {
	const blueprint = vuetifyTaskSystem.createBlueprint(JSON.parse(defaultVuetifyTaskPreset.sourceText))
	if (blueprint.status !== 'valid')
		throw new Error(`Expected valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)
	return blueprint
}

function resolvedNode(blueprint: ReturnType<typeof compileDefault>, id: string): ResolvedBlueprintInspectionNode {
	const inspection = inspectBlueprint(blueprint)
	const node = inspection.nodes.find((candidate: BlueprintInspectionNode) => candidate.resolved && candidate.node.id === id)
	if (node === undefined || !node.resolved)
		throw new Error(`Expected resolved node for widget "${id}".`)
	return node
}

function targetOf(
	blueprint: ReturnType<typeof compileDefault>,
	widgetId: string,
	capability: 'properties' | 'methods',
	memberName: string,
	dependencyIndex = 0,
) {
	const node = resolvedNode(blueprint, widgetId)
	const member = node[capability].find(candidate => candidate.name === memberName)
	if (member === undefined)
		throw new Error(`Expected ${widgetId}.${memberName}.`)
	const dependency = member.dependencies[dependencyIndex]
	if (dependency === undefined || dependency.status !== 'resolved')
		throw new Error(`Expected resolved dependency ${dependencyIndex} on ${widgetId}.${memberName}.`)
	return dependency.target
}

describe('vuetify task-workspace presets', () => {
	it.each(vuetifyTaskPresets)('$id compiles to a valid Blueprint without diagnostics', (preset) => {
		const blueprint = vuetifyTaskSystem.createBlueprint(JSON.parse(preset.sourceText))
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('exposes the canonical default first', () => {
		expect(vuetifyTaskPresets[0])
			.toBe(defaultVuetifyTaskPreset)
	})
})

describe('explicit capability-widget dependency topology', () => {
	it('taskAppShell reads i18n messages from the stable task-i18n widget id', () => {
		const blueprint = compileDefault()
		expect(targetOf(blueprint, 'task-app', 'properties', 'messages'))
			.toEqual({
				nodeId: resolvedNode(blueprint, 'task-i18n').nodeId,
				member: { type: 'property', name: 'messages' },
			})
	})

	it('themeControl reads and invokes the stable task-theme capability widget', () => {
		const blueprint = compileDefault()
		const themeNodeId = resolvedNode(blueprint, 'task-theme').nodeId
		expect(targetOf(blueprint, 'task-theme-control', 'properties', 'mode'))
			.toEqual({
				nodeId: themeNodeId,
				member: { type: 'state', name: 'mode' },
			})
		expect(targetOf(blueprint, 'task-theme-control', 'methods', 'cycle'))
			.toEqual({
				nodeId: themeNodeId,
				member: { type: 'method', name: 'cycleMode' },
			})
	})

	it('taskList visibleTasks depends explicitly on store + search + filter widgets', () => {
		const blueprint = compileDefault()
		const property = resolvedNode(blueprint, 'task-list').properties.find(candidate => candidate.name === 'visibleTasks')!
		const targets = property.dependencies.map((dependency) => {
			if (dependency.status !== 'resolved')
				throw new Error('Expected resolved TaskList.visibleTasks dependency.')
			return dependency.target
		})
		expect(targets)
			.toEqual(expect.arrayContaining([
				{ nodeId: resolvedNode(blueprint, 'task-store').nodeId, member: { type: 'state', name: 'tasks' } },
				{ nodeId: resolvedNode(blueprint, 'task-search').nodeId, member: { type: 'state', name: 'value' } },
				{ nodeId: resolvedNode(blueprint, 'task-filter').nodeId, member: { type: 'state', name: 'value' } },
			]))
	})

	it('taskList.toggle reaches store, i18n and notification widgets through Core dependency edges', () => {
		const blueprint = compileDefault()
		const method = resolvedNode(blueprint, 'task-list').methods.find(candidate => candidate.name === 'toggle')!
		const targets = method.dependencies.map((dependency) => {
			if (dependency.status !== 'resolved')
				throw new Error('Expected resolved TaskList.toggle dependency.')
			return dependency.target
		})
		expect(targets)
			.toEqual(expect.arrayContaining([
				{ nodeId: resolvedNode(blueprint, 'task-store').nodeId, member: { type: 'method', name: 'toggleTask' } },
				{ nodeId: resolvedNode(blueprint, 'task-i18n').nodeId, member: { type: 'property', name: 'messages' } },
				{ nodeId: resolvedNode(blueprint, 'task-notifications').nodeId, member: { type: 'method', name: 'success' } },
			]))
	})
})

describe('coordinated semantic task workflow', () => {
	it('filters, creates, edits, toggles, deletes and updates capability state without renderer-local semantics', () => {
		const { runtime } = createVuetifyTaskRuntime()
		const search = widgetOfType(runtime, 'task-search', 'TaskSearch')
		const filter = widgetOfType(runtime, 'task-filter', 'TaskStatusFilter')
		const list = widgetOfType(runtime, 'task-list', 'TaskList')
		const store = widgetOfType(runtime, 'task-store', 'TaskStore')
		const editor = widgetOfType(runtime, 'task-editor', 'TaskEditor')
		const i18n = widgetOfType(runtime, 'task-i18n', 'I18nCapability')
		const theme = widgetOfType(runtime, 'task-theme', 'ThemeCapability')
		const notification = widgetOfType(runtime, 'task-notifications', 'NotificationCapability')

		expect(list.properties.count.get())
			.toEqual({ ok: true, value: 4 })

		filter.state.value.set('open')
		expect(list.properties.count.get())
			.toEqual({ ok: true, value: 3 })
		search.state.value.set('dialog')
		const searched = list.properties.visibleTasks.get()
		expect(searched.ok && searched.value.map(task => task.id))
			.toEqual(['task-3'])
		search.state.value.set('')
		filter.state.value.set('all')

		expect(editor.methods.openNew().ok)
			.toBe(true)
		expect(editor.state.open.get())
			.toBe(true)
		editor.state.title.set('Write the browser contract')
		const created = editor.methods.save()
		expect(created.ok && created.value.title)
			.toBe('Write the browser contract')
		expect(store.state.tasks.get())
			.toHaveLength(5)
		expect(notification.state.open.get())
			.toBe(true)
		expect(notification.state.message.get())
			.toBe('Task created')

		expect(editor.methods.openEdit('task-2').ok)
			.toBe(true)
		expect(editor.state.title.get())
			.toBe('Inspect cross-widget dependencies')
		editor.state.title.set('Inspect explicit provider dependencies')
		const updated = editor.methods.save()
		expect(updated.ok && updated.value.title)
			.toBe('Inspect explicit provider dependencies')

		const toggled = list.methods.toggle('task-2')
		expect(toggled.ok && toggled.value.done)
			.toBe(true)
		expect(notification.state.message.get())
			.toBe('Task completed')

		expect(list.methods.delete('task-3').ok)
			.toBe(true)
		const remaining = store.state.tasks.get()
		expect(remaining.some(task => task.id === 'task-3'))
			.toBe(false)

		expect(i18n.methods.toggleLocale().ok)
			.toBe(true)
		expect(i18n.state.locale.get())
			.toBe('zh-TW')
		expect(list.properties.messages.get())
			.toMatchObject({
				ok: true,
				value: { taskCreated: '任務已建立' },
			})

		expect(theme.state.mode.get())
			.toBe('system')
		expect(theme.methods.cycleMode().ok)
			.toBe(true)
		expect(theme.state.mode.get())
			.toBe('light')
	})
})
