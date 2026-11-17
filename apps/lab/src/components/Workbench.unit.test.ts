// @vitest-environment happy-dom

import type { LabStore } from '../composables/use-lab-store'
import { mount } from '@vue/test-utils'
import { DockviewApi } from 'dockview-vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
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
vi.mock('./panels/RuntimePanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./panels/SelectedWidgetPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))
vi.mock('./preview/PreviewPanel.vue', async () => ({ default: (await import('vue')).defineComponent({ render: () => null }) }))

const panel = (id: string, title: string) => [id, { id, contentComponent: id, tabComponent: 'nonClosable', title }] as const

/** A layout as `DockviewApi.toJSON()` saved it, with Runtime the open tool tab. */
function savedLayoutWithRuntimeActive(): string {
	return JSON.stringify({
		version: LAYOUT_VERSION,
		layout: {
			grid: {
				root: {
					type: 'branch',
					size: 800,
					data: [
						{ type: 'leaf', data: { views: ['author', 'widget', 'blueprint', 'runtime', 'dependencies'], activeView: 'runtime', id: '1' }, size: 700 },
						{ type: 'leaf', data: { views: ['preview'], activeView: 'preview', id: '2' }, size: 740 },
					],
				},
				width: 1440,
				height: 800,
				orientation: 'HORIZONTAL',
			},
			panels: Object.fromEntries([
				panel('author', 'Author'),
				panel('widget', 'Selected widget'),
				panel('blueprint', 'Blueprint'),
				panel('runtime', 'Runtime'),
				panel('dependencies', 'Dependencies'),
				panel('preview', 'Preview'),
			]),
			activeGroup: '1',
		},
	})
}

describe('workbench layout restore', () => {
	beforeEach(() => {
		localStorage.setItem('widget-lab:layout', savedLayoutWithRuntimeActive())
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
		spy(DockviewApi.prototype, 'onDidActivePanelChange', 'get')
			.mockReturnValue(() => ({ dispose: () => {} }))
		const store = { activeTab: shallowRef('author') } as unknown as LabStore
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
		expect(store.activeTab.value)
			.toBe('runtime')
		wrapper.unmount()
	})
})
