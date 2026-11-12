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
	InspectorConfigSchema,
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
import type { InspectableValue } from './value'
import { encodeInspectableValue } from './value'

/** `authorWritable` and `valueContractId` are emitted from protocol 0.4 on. */
const MEMBER_METADATA_PROTOCOL_MINOR: number = 4

function wireNodeId(nodeId: InspectionNodeId): number {
	return nodeId
}

// Every DTO below is built by naming its fields. Spreading a Core object would let any field Core adds
// later reach the wire at whatever protocol minor is negotiated.

function projectDependencyTarget(target: BlueprintDependencyReference['target']): InspectorDependencyReference['target'] {
	switch (target.type) {
		case 'self':
			return { type: 'self' }
		case 'root':
			return { type: 'root' }
		case 'parent':
			return { type: 'parent', optional: target.optional }
		case 'widget':
			return { type: 'widget', widgetId: target.widgetId, optional: target.optional }
	}
}

function projectDependencyOperation(operation: BlueprintDependencyReference['operation']): InspectorDependencyReference['operation'] {
	switch (operation.type) {
		case 'state-get':
			return { type: 'state-get', key: operation.key }
		case 'state-set':
			return { type: 'state-set', key: operation.key }
		case 'property-get':
			return { type: 'property-get', name: operation.name }
		case 'method-invoke':
			return { type: 'method-invoke', name: operation.name }
	}
}

function projectDependencyReference(reference: BlueprintDependencyReference): InspectorDependencyReference {
	return {
		target: projectDependencyTarget(reference.target),
		operation: projectDependencyOperation(reference.operation),
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
				member: { type: dependency.target.member.type, name: dependency.target.member.name },
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

export function projectBlueprintSnapshot(
	runtimeId: string,
	inspection: BlueprintInspection,
	protocolMinor = 2,
): InspectorBlueprintSnapshot {
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
				capabilities: protocolMinor < 2
					? {
							config: node.capabilities.config,
							slots: node.capabilities.slots,
							state: node.capabilities.state,
							properties: node.capabilities.properties,
							methods: node.capabilities.methods,
						}
					: {
							config: node.capabilities.config,
							slots: node.capabilities.slots,
							state: node.capabilities.state,
							properties: node.capabilities.properties,
							methods: node.capabilities.methods,
							events: node.capabilities.events,
						},
				...(protocolMinor < 2
					? {}
					: {
							config: node.config === null
								? null
								// Core types the schema document precisely; on the wire it is plain JSON (see `InspectorConfigSchema`).
								: { description: node.config.description, schema: node.config.schema as InspectorConfigSchema | null },
							events: node.events.map(event => ({ type: 'event' as const, name: event.name, description: event.description })),
						}),
				semanticSlots: node.semanticSlots.map(slot => ({
					name: slot.name,
					children: slot.children.map(wireNodeId),
				})),
				state: node.state.map(member => ({
					type: 'state' as const,
					name: member.name,
					...(protocolMinor < MEMBER_METADATA_PROTOCOL_MINOR ? {} : { authorWritable: member.authorWritable }),
				})),
				properties: node.properties.map(member => ({
					type: 'property' as const,
					name: member.name,
					...(protocolMinor < MEMBER_METADATA_PROTOCOL_MINOR ? {} : { valueContractId: member.valueContractId }),
					dependencies: member.dependencies.map(projectDependency),
				})),
				methods: node.methods.map(member => ({
					type: 'method' as const,
					name: member.name,
					transitivelyWrites: member.transitivelyWrites,
					dependencies: member.dependencies.map(projectDependency),
				})),
			}
		}),
		invalidCycles: inspection.invalidCycles.map(cycle => ({
			members: cycle.members.map(member => ({
				nodeId: wireNodeId(member.nodeId),
				member: { type: member.member.type, name: member.member.name },
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

export function projectEventArgs(args: readonly unknown[]): readonly InspectableValue[] {
	return args.map(value => encodeInspectableValue(value))
}
