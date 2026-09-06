import type {
	BlueprintDependencyReference,
	BlueprintNodeDiagnostic,
	BlueprintNodeDiagnosticLocation,
	RuntimeDiagnostic,
} from '@deviltea/widget-core'
import type {
	BlueprintInspection,
	BlueprintInspectionDependency,
	InspectionNodeId,
	RuntimeInspection,
	RuntimePropertyInspectionSnapshot,
	RuntimeWidgetInspection,
} from '@deviltea/widget-core/inspection'
import type {
	InspectorBlueprintSnapshot,
	InspectorDependency,
	InspectorDependencyReference,
	InspectorDiagnostic,
	InspectorDiagnosticLocation,
	InspectorRuntimeDiagnostic,
	InspectorRuntimeMemberSnapshot,
	InspectorRuntimePropertySnapshot,
	InspectorRuntimeWidgetSnapshot,
	InspectorSlot,
} from './protocol'
import { encodeInspectableValue } from './value'

function wireNodeId(nodeId: InspectionNodeId): number {
	return nodeId
}

function projectDependencyReference(reference: BlueprintDependencyReference): InspectorDependencyReference {
	return {
		target: { ...reference.target },
		operation: { ...reference.operation },
	}
}

function projectDependency(dependency: BlueprintInspectionDependency): InspectorDependency {
	const base = {
		path: [...dependency.path],
		reference: projectDependencyReference(dependency.reference),
	}
	if (dependency.status === 'resolved') {
		return {
			...base,
			status: 'resolved',
			target: {
				nodeId: wireNodeId(dependency.target.nodeId),
				member: { ...dependency.target.member },
			},
		}
	}
	if (dependency.status === 'invalid') {
		return {
			...base,
			status: 'invalid',
			...(dependency.targetNodeId === undefined ? {} : { targetNodeId: wireNodeId(dependency.targetNodeId) }),
		}
	}
	return { ...base, status: 'absent' }
}

function projectDiagnosticLocation(
	inspection: BlueprintInspection,
	location: BlueprintNodeDiagnosticLocation,
): InspectorDiagnosticLocation | null {
	const nodeId = inspection.getNodeId(location.node)
	if (nodeId === null)
		return null
	const wireId = wireNodeId(nodeId)
	switch (location.type) {
		case 'widget':
			return { type: 'widget', nodeId: wireId }
		case 'slot':
			return { type: 'slot', nodeId: wireId, slot: location.slot }
		case 'slot-child':
			return { type: 'slot-child', nodeId: wireId, slot: location.slot, index: location.index }
		case 'property':
			return { type: 'property', nodeId: wireId, name: location.name }
		case 'method':
			return { type: 'method', nodeId: wireId, name: location.name }
	}
}

function projectDiagnostic(inspection: BlueprintInspection, diagnostic: BlueprintNodeDiagnostic): InspectorDiagnostic | null {
	const location = projectDiagnosticLocation(inspection, diagnostic.location)
	if (location === null)
		return null

	const related = 'related' in diagnostic && diagnostic.related !== undefined
		? diagnostic.related
				.map(item => projectDiagnosticLocation(inspection, item))
				.filter((item): item is InspectorDiagnosticLocation => item !== null)
		: undefined

	return {
		code: diagnostic.code,
		message: diagnostic.message,
		location,
		...(related === undefined ? {} : { related }),
		...('path' in diagnostic && diagnostic.path !== undefined
			? { path: diagnostic.path.map(segment => typeof segment === 'symbol' ? segment.description ?? 'Symbol()' : segment) as (string | number)[] }
			: {}),
		...('reason' in diagnostic && typeof diagnostic.reason === 'string' ? { reason: diagnostic.reason } : {}),
		...('dependency' in diagnostic ? { dependency: projectDependencyReference(diagnostic.dependency) } : {}),
	}
}

function projectSourceSlots(sourceSlots: BlueprintInspection['nodes'][number]['sourceSlots']): readonly InspectorSlot[] {
	return sourceSlots.map(slot => ({
		name: slot.name,
		placement: slot.placement,
		children: slot.children.map(wireNodeId),
	}))
}

export function projectBlueprintSnapshot(runtimeId: string, inspection: BlueprintInspection): InspectorBlueprintSnapshot {
	return {
		runtimeId,
		rootNodeId: wireNodeId(inspection.rootNodeId),
		nodes: inspection.nodes.map((node) => {
			const diagnostics = node.node.diagnostics
				.map(diagnostic => projectDiagnostic(inspection, diagnostic))
				.filter((diagnostic): diagnostic is InspectorDiagnostic => diagnostic !== null)
			const base = {
				nodeId: wireNodeId(node.nodeId),
				resolved: node.resolved,
				sourceSlots: projectSourceSlots(node.sourceSlots),
				diagnostics,
			}
			if (!node.resolved)
				return base

			return {
				...base,
				widgetId: node.node.id,
				widgetType: node.node.type,
				capabilities: { ...node.capabilities },
				semanticSlots: node.semanticSlots.map(slot => ({
					name: slot.name,
					children: slot.children.map(wireNodeId),
				})),
				state: node.state.map(member => ({ ...member })),
				properties: node.properties.map(member => ({
					...member,
					dependencies: member.dependencies.map(projectDependency),
				})),
				methods: node.methods.map(member => ({
					...member,
					dependencies: member.dependencies.map(projectDependency),
				})),
			}
		}),
		invalidCycles: inspection.invalidCycles.map(cycle => ({
			members: cycle.members.map(member => ({
				nodeId: wireNodeId(member.nodeId),
				member: { ...member.member },
			})),
		})),
	}
}

function projectRuntimeDiagnosticLocation(location: RuntimeDiagnostic['location']): InspectorRuntimeDiagnostic['location'] {
	return {
		type: location.type,
		widgetId: location.widgetId,
		name: location.type === 'state' ? location.key : location.name,
	}
}

function projectRuntimeDiagnostic(diagnostic: RuntimeDiagnostic): InspectorRuntimeDiagnostic {
	return {
		code: diagnostic.code,
		message: diagnostic.message,
		location: projectRuntimeDiagnosticLocation(diagnostic.location),
		...('path' in diagnostic && diagnostic.path !== undefined
			? { path: diagnostic.path.map(segment => typeof segment === 'symbol' ? segment.description ?? 'Symbol()' : segment) as (string | number)[] }
			: {}),
		...('reason' in diagnostic && typeof diagnostic.reason === 'string' ? { reason: diagnostic.reason } : {}),
		...('dependency' in diagnostic ? { dependency: projectDependencyReference(diagnostic.dependency) } : {}),
		...('candidate' in diagnostic ? { candidate: encodeInspectableValue(diagnostic.candidate) } : {}),
		...('received' in diagnostic ? { received: encodeInspectableValue(diagnostic.received) } : {}),
		...('result' in diagnostic ? { result: encodeInspectableValue(diagnostic.result) } : {}),
		...('args' in diagnostic ? { args: diagnostic.args.map(value => encodeInspectableValue(value)) } : {}),
		...('related' in diagnostic ? { related: diagnostic.related.map(projectRuntimeDiagnosticLocation) } : {}),
		...('cause' in diagnostic ? { cause: projectRuntimeDiagnostic(diagnostic.cause) } : {}),
	}
}

function projectPropertySnapshot(name: string, snapshot: RuntimePropertyInspectionSnapshot<unknown>): InspectorRuntimePropertySnapshot {
	if (snapshot.status === 'never-evaluated')
		return { type: 'property', name, snapshot: { status: 'never-evaluated' } }

	return {
		type: 'property',
		name,
		snapshot: {
			status: 'completed',
			result: snapshot.result.ok
				? { ok: true, value: encodeInspectableValue(snapshot.result.value) }
				: { ok: false, diagnostics: snapshot.result.failure.diagnostics.map(projectRuntimeDiagnostic) },
		},
	}
}

export function projectRuntimeMemberSnapshot(
	widget: RuntimeWidgetInspection,
	member: { readonly type: 'state' | 'property', readonly name: string },
): InspectorRuntimeMemberSnapshot | null {
	if (member.type === 'state') {
		const inspection = widget.getState(member.name)
		if (inspection === null)
			return null
		return {
			type: 'state',
			name: member.name,
			value: encodeInspectableValue(inspection.getSnapshot().value),
		}
	}

	const inspection = widget.getProperty(member.name)
	return inspection === null ? null : projectPropertySnapshot(member.name, inspection.getSnapshot())
}

export function projectRuntimeWidgetSnapshot(
	runtimeId: string,
	runtimeInspection: RuntimeInspection,
	nodeId: InspectionNodeId,
): InspectorRuntimeWidgetSnapshot | null {
	const widget = runtimeInspection.getWidget(nodeId)
	if (widget === null || !widget.blueprintNode.resolved)
		return null

	const members: InspectorRuntimeMemberSnapshot[] = []
	for (const state of widget.blueprintNode.state) {
		const projected = projectRuntimeMemberSnapshot(widget, state)
		if (projected !== null)
			members.push(projected)
	}
	for (const property of widget.blueprintNode.properties) {
		const projected = projectRuntimeMemberSnapshot(widget, property)
		if (projected !== null)
			members.push(projected)
	}

	return {
		ref: { runtimeId, nodeId: wireNodeId(nodeId) },
		widgetId: widget.blueprintNode.node.id,
		widgetType: widget.blueprintNode.node.type,
		members,
	}
}
