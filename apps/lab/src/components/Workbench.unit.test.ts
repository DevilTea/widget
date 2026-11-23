// @vitest-environment happy-dom

import type { DockviewApi } from 'dockview-vue'
import type { LabStore, ToolOpenRequest } from '../composables/use-lab-store'
import type { ToolId } from '../lab/tools'
import { mount } from '@vue/test-utils'
import { DockviewApi as DockviewApiClass } from 'dockview-vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { createDocumentToolsStore, DocumentToolsKey } from '../composables/use-document-tools'
import { createImplementationExplorerStore, ImplementationExplorerKey } from '../composables/use-implementation-explorer'
import { createLabI18nStore, LabI18nKey } from '../composables/use-lab-i18n'
import { LabStoreKey } from '../composables/use-lab-store'
import { createWorkbenchLayoutStore, WorkbenchLayoutKey } from '../composables/use-workbench-layout'
import { LAYOUT_VERSION } from '../lab/layout-storage'
import Workbench from './Workbench.vue'

// The panels are not what this checks: stand-ins keep the real Dockview (and the Workbench's own restore code) in play.
vi.mock('./panels/AuthorPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/BlueprintPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/DependenciesPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/EventsPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/ExplainPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/RuntimePanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/SelectedWidgetPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/ToolsPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./preview/PreviewPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))

const panel = (id: string, title: string) => [id, { id, contentComponent: id, tabComponent: 'nonClosable', title }] as const

/** A layout as `DockviewApi.toJSON()` saved it, with Explain the open tab of the tool group. */
function savedLayoutWithExplainActive(): string {
	return JSON.stringify({
		version: LAYOUT_VERSION,
		layout: {
			grid: {
				root: {
					type: 'branch',
					size: 800,
					data: [
						{ type: 'leaf', data: { views: ['edit', 'explain', 'tools'], activeView: 'explain', id: '1' }, size: 700 },
						{ type: 'leaf', data: { views: ['preview'], activeView: 'preview', id: '2' }, size: 740 },
					],
				},
				width: 1440,
				height: 800,
				orientation: 'HORIZONTAL',
			},
			panels: Object.fromEntries([
				panel('edit', 'Edit'),
				panel('explain', 'Explain'),
				panel('tools', 'Tools'),
				panel('preview', 'Preview'),
			]),
			activeGroup: '1',
		},
	})
}

function fakeStore(): LabStore {
	const toolOpenRequest = shallowRef<ToolOpenRequest | null>(null)
	return {
		activeTab: shallowRef('edit'),
		toolGroupTab: shallowRef(null),
		toolOpenRequest,
		openTool: (tool: ToolId) => {
			toolOpenRequest.value = { tool, tick: (toolOpenRequest.value?.tick ?? 0) + 1 }
		},
		openTools: shallowRef(new Set()),
		// What the Tools tab's Events count reads (`useEventLogTabState`): no Preview connection here.
		previewHost: { connection: shallowRef(null), error: shallowRef(null) },
		preview: shallowRef({ revision: 0 }),
		showcaseId: shallowRef('survey'),
	} as unknown as LabStore
}

function mountWorkbench(store: LabStore) {
	const wrapper = mount(Workbench, {
		attachTo: document.body,
		global: {
			provide: {
				[LabStoreKey as symbol]: store,
				[LabI18nKey as symbol]: createLabI18nStore(),
				[ImplementationExplorerKey as symbol]: createImplementationExplorerStore(),
				[DocumentToolsKey as symbol]: createDocumentToolsStore(),
				[WorkbenchLayoutKey as symbol]: createWorkbenchLayoutStore(),
			},
		},
	})
	return { wrapper }
}

describe('workbench layout restore', () => {
	beforeEach(() => {
		localStorage.setItem('widget-lab:layout', savedLayoutWithExplainActive())
	})
	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	it('tells the store which tab the restored layout shows, without waiting for Dockview to report it', () => {
		// Dockview-vue reports the restored active panel through `onDidActivePanelChange` on its own a moment later, which
		// would hide a store that never heard about the restore. Here that event never comes: only the Workbench's own write
		// after `fromJSON` can tell the store.
		// (An event is a getter on the prototype; its declared type is a plain property, hence the casts.)
		const spy = vi.spyOn as unknown as (target: object, key: string, access: 'get') => { mockReturnValue: (value: unknown) => void }
		spy(DockviewApiClass.prototype, 'onDidActivePanelChange', 'get')
			.mockReturnValue(() => ({ dispose: () => {} }))
		const store = fakeStore()
		const { wrapper } = mountWorkbench(store)
		expect(store.activeTab.value)
			.toBe('explain')
		// The tool group's own tab (Lab UX phase 2: what a tour gives back) is read from Dockview at setup too.
		expect(store.toolGroupTab.value)
			.toBe('explain')
		wrapper.unmount()
	})
})

describe('workbench expert views (Lab UX phase 3B)', () => {
	afterEach(() => {
		localStorage.clear()
	})

	it('opens an expert view in a Tools group of its own, never in the tool group, and focuses the open one when asked again', async () => {
		const added: { id: string, groupPanels: string[] }[] = []
		const original = DockviewApiClass.prototype.addPanel
		const addPanel = vi.spyOn(DockviewApiClass.prototype, 'addPanel')
			.mockImplementation(function (this: DockviewApi, options) {
				const created = original.call(this, options)
				added.push({ id: created.id, groupPanels: created.group.panels.map(member => member.id) })
				return created
			})
		const store = fakeStore()
		const { wrapper } = mountWorkbench(store)
		expect([...store.openTools.value])
			.toEqual([])
		added.length = 0

		store.openTool('runtime')
		await nextTick()
		store.openTool('events')
		await nextTick()
		store.openTool('runtime')
		await nextTick()

		// Runtime got a group of its own; Events joined it; the second Runtime request added nothing.
		expect(added)
			.toEqual([
				{ id: 'runtime', groupPanels: ['runtime'] },
				{ id: 'events', groupPanels: ['runtime', 'events'] },
			])
		expect([...store.openTools.value].sort())
			.toEqual(['events', 'runtime'])
		// Opening a view never changes the tool group's tab: what the user was reading stays.
		expect(store.toolGroupTab.value)
			.toBe('edit')
		addPanel.mockRestore()
		wrapper.unmount()
	})
})
