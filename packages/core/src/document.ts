import type { WidgetSystemBlueprint } from './internal/contract'
import type { AnyWidgetPluginTuple } from './plugin'
import type { SourcePatch, SourcePatchOperationFailure } from './source-patch'
import type { WidgetSystem } from './system'
import { invokeListenerIsolated } from './runtime/adapter'
import { applySourcePatch } from './source-patch'

export interface WidgetDocumentSnapshot<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly revision: number
	readonly blueprint: WidgetSystemBlueprint<Plugins>
}

export interface ApplyPatchOptions {
	readonly expectedRevision: number
}

export interface ReentrantApplyFailure {
	readonly code: 'reentrant-apply'
	readonly message: string
}

export interface DocumentRevisionConflictFailure {
	readonly code: 'document-revision-conflict'
	readonly expectedRevision: number
	readonly actualRevision: number
	readonly message: string
}

export type ApplyPatchFailure = SourcePatchOperationFailure | ReentrantApplyFailure | DocumentRevisionConflictFailure

type Result<Success extends object, Failure>
	= | ({ readonly ok: true } & Success)
		| { readonly ok: false, readonly failure: Failure }

export type ApplyPatchResult = Result<{ readonly changed: boolean }, ApplyPatchFailure>

export interface WidgetDocument<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	getSnapshot: () => WidgetDocumentSnapshot<Plugins>
	applyPatch: (patch: SourcePatch, options?: ApplyPatchOptions) => ApplyPatchResult
	subscribe: (listener: (snapshot: WidgetDocumentSnapshot<Plugins>) => void) => () => void
}

interface Subscriber<Plugins extends AnyWidgetPluginTuple> {
	readonly listener: (snapshot: WidgetDocumentSnapshot<Plugins>) => void
}

export interface CreateWidgetDocumentOptions<Plugins extends AnyWidgetPluginTuple> {
	readonly system: WidgetSystem<Plugins>
	readonly source: unknown
}

export function createWidgetDocument<const Plugins extends AnyWidgetPluginTuple>(
	options: CreateWidgetDocumentOptions<Plugins>,
): WidgetDocument<Plugins> {
	let blueprint = options.system.createBlueprint(options.source)
	let snapshot: WidgetDocumentSnapshot<Plugins> = Object.freeze({ revision: 0, blueprint })
	let phase: 'idle' | 'applying' | 'notifying' = 'idle'
	const subscribers: Subscriber<Plugins>[] = []

	function getSnapshot(): WidgetDocumentSnapshot<Plugins> {
		return snapshot
	}

	function applyPatch(patch: SourcePatch, applyOptions?: ApplyPatchOptions): ApplyPatchResult {
		if (phase !== 'idle') {
			return {
				ok: false,
				failure: Object.freeze({
					code: 'reentrant-apply',
					message: 'WidgetDocument.applyPatch() cannot be called while the Document is applying or notifying.',
				}),
			}
		}

		if (applyOptions !== undefined && applyOptions.expectedRevision !== snapshot.revision) {
			return {
				ok: false,
				failure: Object.freeze({
					code: 'document-revision-conflict',
					expectedRevision: applyOptions.expectedRevision,
					actualRevision: snapshot.revision,
					message: 'WidgetDocument revision does not match expectedRevision.',
				}),
			}
		}

		phase = 'applying'
		try {
			const result = applySourcePatch(blueprint.source, patch)
			if (!result.ok)
				return { ok: false, failure: result.failure }
			if (!result.value.changed)
				return { ok: true, changed: false }

			// Compilation is deliberately inside the atomic boundary but happens only once after all
			// mechanical operations have succeeded. A callback contract violation throws and leaves the old
			// snapshot committed because the assignment below has not happened yet.
			const nextBlueprint = options.system.createBlueprint(result.value.source)
			blueprint = nextBlueprint
			snapshot = Object.freeze({ revision: snapshot.revision + 1, blueprint: nextBlueprint })

			phase = 'notifying'
			const audience = subscribers.slice()
			for (const subscriber of audience)
				invokeListenerIsolated(subscriber.listener, snapshot)

			return { ok: true, changed: true }
		}
		finally {
			phase = 'idle'
		}
	}

	function subscribe(listener: (snapshot: WidgetDocumentSnapshot<Plugins>) => void): () => void {
		const subscriber: Subscriber<Plugins> = { listener }
		subscribers.push(subscriber)
		let active = true
		return () => {
			if (!active)
				return
			active = false
			const index = subscribers.indexOf(subscriber)
			if (index >= 0)
				subscribers.splice(index, 1)
		}
	}

	return Object.freeze({ getSnapshot, applyPatch, subscribe })
}
