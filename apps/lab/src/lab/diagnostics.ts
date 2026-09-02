/**
 * Blueprint diagnostic navigation helpers (Phase 4).
 *
 * This is only a location-to-inspection bridge. Core owns the diagnostic, its location, and the
 * inspection node identity; Lab does not classify messages or infer a node from a source path.
 */

import type { BlueprintDiagnostic, BlueprintDiagnosticLocation } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'

/** Returns the current Document inspection node for a Core node location, or null for source-only data. */
export function inspectionNodeIdOfLocation(
	location: BlueprintDiagnosticLocation,
	inspection: BlueprintInspection,
): InspectionNodeId | null {
	if (location.type === 'source')
		return null
	return inspection.getNodeId(location.node)
}

/**
 * Resolves only the diagnostic's primary Core location. A source-level diagnostic deliberately stays
 * non-navigable even when its path happens to resemble a widget location.
 */
export function inspectionNodeIdOfDiagnostic(
	diagnostic: BlueprintDiagnostic,
	inspection: BlueprintInspection,
): InspectionNodeId | null {
	return inspectionNodeIdOfLocation(diagnostic.location, inspection)
}
