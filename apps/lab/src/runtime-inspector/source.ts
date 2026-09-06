/** Runtime Inspector revision metadata: the data plane itself comes from the remote Preview connection. */

import type { LabPreviewSnapshot } from '../lab/types'

export interface RuntimeInspectorSource {
	readonly previewRevision: number | null
	readonly isStale: boolean
	readonly isDiverged: boolean
}

export function getRuntimeInspectorSource(
	preview: LabPreviewSnapshot | null,
	documentRevision: number,
): RuntimeInspectorSource {
	return {
		previewRevision: preview?.revision ?? null,
		isStale: preview !== null && preview.revision < documentRevision,
		isDiverged: preview !== null && preview.revision !== documentRevision,
	}
}
