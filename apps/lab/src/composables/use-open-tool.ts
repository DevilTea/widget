/**
 * Opens an expert view of the Tools tab (Lab UX phase 3B) in the Tools group beside the Preview, or focuses its tab when it is
 * already open. One entry point for every caller (the Tools menu, Inspect, "View implementation", the tutorial): Implementation
 * and Document Tools keep their own request stores, which carry what they need (the explorer's mode), and the other views go
 * through `LabStore.openTool()`. `Workbench.vue` owns the Dockview side for all of them.
 */
import type { ToolId } from '../lab/tools'
import type { DocumentToolsStore } from './use-document-tools'
import type { ImplementationExplorerStore } from './use-implementation-explorer'
import type { LabStore } from './use-lab-store'
import { useDocumentTools } from './use-document-tools'
import { useImplementationExplorer } from './use-implementation-explorer'
import { useLabStore } from './use-lab-store'

export type OpenTool = (tool: ToolId) => void

/** For code that holds the stores itself (`App.vue` hands it to the tutorial store, which is created where they are provided). */
export function createToolOpener(store: LabStore, implementationExplorer: ImplementationExplorerStore, documentTools: DocumentToolsStore): OpenTool {
	return (tool) => {
		if (tool === 'implementation')
			implementationExplorer.open()
		else if (tool === 'document-tools')
			documentTools.open()
		else
			store.openTool(tool)
	}
}

export function useOpenTool(): OpenTool {
	return createToolOpener(useLabStore(), useImplementationExplorer(), useDocumentTools())
}
