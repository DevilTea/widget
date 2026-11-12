/**
 * Shared structured-diagnostic formatting helpers (diagnostic #13 Phase 4 Checkpoint H "structured-source
 * rendering" convention, reused by Phase 5's Runtime Inspector property-diagnostic rendering): every field
 * shown beyond the human `message` is read from an diagnostic's machine-readable structure — `message` is
 * never parsed to infer taxonomy or ownership.
 */

import type { BlueprintDependencyOperation, BlueprintDependencyReference, BlueprintDependencyTarget, DiagnosticPath, SeparatedSourceLocation } from '@deviltea/widget-core'

/** `[a, 0, 'b']` -> `a[0].b`. `DiagnosticPath` segments stay verbatim (never dot-joined into a lossy string). */
export function formatDiagnosticPath(path: DiagnosticPath | undefined): string | null {
	if (path === undefined || path.length === 0)
		return null
	return path
		.map(segment => typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`)
		.join('')
		.replace(/^\./, '')
}

export function formatDependencyTarget(target: BlueprintDependencyTarget): string {
	switch (target.type) {
		case 'self':
			return 'self'
		case 'root':
			return 'root'
		case 'parent':
			return target.optional ? 'parent (optional)' : 'parent'
		case 'widget':
			return `widget("${target.widgetId}")${target.optional ? ' (optional)' : ''}`
	}
}

export function formatDependencyOperation(operation: BlueprintDependencyOperation): string {
	switch (operation.type) {
		case 'state-get':
			return `state.get("${operation.key}")`
		case 'state-set':
			return `state.set("${operation.key}")`
		case 'property-get':
			return `properties.get("${operation.name}")`
		case 'method-invoke':
			return `methods.invoke("${operation.name}")`
	}
}

export function formatDependencyReference(reference: BlueprintDependencyReference): string {
	return `${formatDependencyTarget(reference.target)} -> ${formatDependencyOperation(reference.operation)}`
}

/** `{ area: 'widgets', index: 2, path: ['id'] }` -> `widgets[2].id`; a whole-`widgets` fact is just `widgets`. */
export function formatSeparatedSourceLocation(location: SeparatedSourceLocation): string {
	const segments = (path: readonly PropertyKey[] | undefined): string => path === undefined
		? ''
		: path.map(segment => typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`)
				.join('')
	if (location.area === 'widgets')
		return `widgets${location.index === undefined ? '' : `[${location.index}]`}${segments(location.path)}`
	return `${location.area}${segments(location.path)}`
}
