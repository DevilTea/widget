/** Runtime Inspector source selection: it is always the Lab's Preview snapshot, never the current draft/Document. */

import type { LabPreviewSnapshot } from '../lab/types'

export interface RuntimeInspectorSource {
	readonly blueprint: LabPreviewSnapshot['blueprint'] | null
	readonly runtime: LabPreviewSnapshot['runtime'] | null
	readonly previewRevision: number | null
	readonly isStale: boolean
	readonly isDiverged: boolean
}

export function getRuntimeInspectorSource(
	preview: LabPreviewSnapshot | null,
	documentRevision: number,
): RuntimeInspectorSource {
	return {
		blueprint: preview?.blueprint ?? null,
		runtime: preview?.runtime ?? null,
		previewRevision: preview?.revision ?? null,
		isStale: preview !== null && preview.revision < documentRevision,
		isDiverged: preview !== null && preview.revision !== documentRevision,
	}
}
