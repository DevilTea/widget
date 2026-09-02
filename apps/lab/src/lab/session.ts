/**
 * `LabSession` — the Widget Lab draft + Document/Runtime lifecycle host.
 *
 * Normative source: diagnostic #13 (Widget Lab Phase 4) comment "Checkpoint — Source Apply lifecycle and
 * applied snapshot boundary". Framework-agnostic on purpose: this module never imports Vue and never
 * touches the DOM. The Vue layer supplies `LabSessionHooks` (see `types.ts`) as the seam that lets it
 * guarantee Preview unmount-before-dispose ordering; `LabSession` only sequences those hooks.
 *
 * Authored-state authority belongs to core's public `WidgetDocument`: parsed Lab JSON enters through
 * a root `SourcePatch` replacement, and the Lab reacts to the committed Document snapshot. Runtime
 * promotion remains Lab-owned because a Runtime is permanently associated with one valid Blueprint.
 */

import type { AnyWidgetPluginTuple, JsonValue, SourcePatch, WidgetDocument, WidgetDocumentSnapshot, WidgetSystem } from '@deviltea/widget-core'
import type { ApplyOutcome, AuthorCommand, AuthorOutcome, LabActiveSnapshot, LabAppliedSourcePatch, LabDocumentState, LabDocumentTraceEvent, LabPatchOrigin, LabPreviewSnapshot, LabSessionHooks, LabSessionListener, RevisionConflictDemoResult, SourceParseError } from './types'
import { createWidgetDocument } from '@deviltea/widget-core'
import { createAuthorPatch } from './author'

export interface LabSessionOptions<Plugins extends AnyWidgetPluginTuple> {
	readonly system: WidgetSystem<Plugins>
	/**
	 * Must be syntactically valid JSON — this seeds the initial `active` snapshot synchronously
	 * (there is no prior Preview to unmount, so the replacement-ordering hooks do not apply at
	 * construction time). A malformed initial preset is a Lab fixture bug, not a `SourceParseError`.
	 */
	readonly initialSourceText: string
	readonly hooks?: LabSessionHooks
}

const noopHooks: LabSessionHooks = {
	detachPreview: () => {},
	mountPreview: () => {},
}

function toParseError(sourceText: string, error: unknown): SourceParseError {
	return {
		message: error instanceof Error ? error.message : String(error),
		sourceText,
	}
}

function snapshotPatch(patch: SourcePatch): SourcePatch {
	return Object.freeze(patch.map(operation => Object.freeze({ ...operation })))
}

export const LAB_DOCUMENT_TRACE_LIMIT = 20

export class LabSession<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	private readonly document: WidgetDocument<Plugins>
	private readonly hooks: LabSessionHooks
	private readonly listeners = new Set<LabSessionListener>()

	private draftText: string
	private parseErrorValue: SourceParseError | null = null
	private documentStateValue: LabDocumentState<Plugins>
	private previewSnapshotValue: LabPreviewSnapshot<Plugins> | null
	private activeSnapshot: LabActiveSnapshot<Plugins>
	private lastAppliedSourcePatchValue: LabAppliedSourcePatch | null = null
	private readonly documentTraceValue: LabDocumentTraceEvent[] = []
	private applying = false

	constructor(options: LabSessionOptions<Plugins>) {
		this.hooks = options.hooks ?? noopHooks

		const definition = JSON.parse(options.initialSourceText) as JsonValue
		this.document = createWidgetDocument({ system: options.system, source: definition })
		const { revision, blueprint } = this.document.getSnapshot()
		this.documentStateValue = {
			sourceText: options.initialSourceText,
			definition,
			revision,
			blueprint,
		}
		this.previewSnapshotValue = blueprint.status === 'valid'
			? { revision, blueprint, runtime: blueprint.createRuntime() }
			: null
		this.activeSnapshot = {
			...this.documentStateValue,
			runtime: this.previewSnapshotValue?.runtime ?? null,
		}
		this.draftText = options.initialSourceText
	}

	get draftSourceText(): string {
		return this.draftText
	}

	get system(): WidgetSystem<Plugins> {
		return this.documentStateValue.blueprint.system
	}

	get parseError(): SourceParseError | null {
		return this.parseErrorValue
	}

	/** Current Lab-owned representation of the authoritative Document revision. */
	get documentState(): LabDocumentState<Plugins> {
		return this.documentStateValue
	}

	/** Last valid Runtime promoted into Preview, or null when this session has never had one. */
	get preview(): LabPreviewSnapshot<Plugins> | null {
		return this.previewSnapshotValue
	}

	/** @deprecated Phase-2 compatibility only. Prefer `documentState` + `preview`. */
	get active(): LabActiveSnapshot<Plugins> {
		return this.activeSnapshot
	}

	/** Core-authored committed state, independent of Runtime promotion timing. */
	get documentSnapshot(): WidgetDocumentSnapshot<Plugins> {
		return this.document.getSnapshot()
	}

	get isApplying(): boolean {
		return this.applying
	}

	get isDirty(): boolean {
		return this.draftText !== this.documentStateValue.sourceText
	}

	/** Latest successfully accepted SourcePatch, retained as Lab session telemetry only. */
	get lastAppliedSourcePatch(): LabAppliedSourcePatch | null {
		return this.lastAppliedSourcePatchValue
	}

	/** Finite session-local observation list; it has no replay or restore semantics. */
	get documentTrace(): readonly LabDocumentTraceEvent[] {
		return Object.freeze([...this.documentTraceValue])
	}

	subscribe(listener: LabSessionListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/** Readonly bridge to the authoritative Document commit stream; never exposes mutation. */
	subscribeDocument(listener: (snapshot: WidgetDocumentSnapshot<Plugins>) => void): () => void {
		return this.document.subscribe(listener)
	}

	/**
	 * Ordinary editing never recompiles. Clears a stale Apply-time parse error, since it no longer
	 * describes the current draft.
	 */
	setDraftSourceText(text: string): void {
		this.draftText = text
		this.parseErrorValue = null
		this.emit()
	}

	/**
	 * Draft-only. Never applies, compiles, or disposes anything. A draft that fails to parse is left
	 * untouched — Format has no diagnostic surface of its own.
	 */
	format(): void {
		let parsed: unknown
		try {
			parsed = JSON.parse(this.draftText)
		}
		catch {
			return
		}
		this.setDraftSourceText(JSON.stringify(parsed, null, 2))
	}

	/**
	 * Restores `draftSourceText = documentState.sourceText` and clears the Lab parse error. Never touches
	 * the committed Document revision or the independently owned Preview Runtime.
	 */
	revert(): void {
		this.setDraftSourceText(this.documentStateValue.sourceText)
	}

	/**
	 * The deterministic Apply command (diagnostic #13 Phase 4 Apply-lifecycle comment):
	 *
	 * - captures the draft at command start; concurrent edits stay in the draft and are not applied;
	 * - concurrent Apply is disabled — a call while one is already running is a no-op;
	 * - a `JSON.parse` failure sets a Lab-only `SourceParseError` and leaves `active` untouched;
	 * - parsed JSON is submitted to the authoritative `WidgetDocument` as one root replacement;
	 * - a structural no-op (`changed:false`) accepts the Lab-local text representation without
	 *   inventing a Document revision or replacing the existing Runtime/Preview;
	 * - a changed invalid Document advances authored state but retains the exact last-valid Preview;
	 * - a changed valid Document commits/compiles first, then the Lab Runtime Host detaches/disposes the
	 *   old Preview Runtime, creates a fresh Runtime from the committed valid Blueprint, and mounts it;
	 * - no Runtime state is migrated between valid revisions.
	 */
	async apply(): Promise<ApplyOutcome> {
		if (this.applying)
			return { status: 'skipped-concurrent' }

		const capturedText = this.draftText
		this.applying = true
		this.emit()

		try {
			let definition: JsonValue
			try {
				definition = JSON.parse(capturedText) as JsonValue
			}
			catch (error) {
				this.parseErrorValue = toParseError(capturedText, error)
				this.recordDocumentTrace({ kind: 'parse-error', revision: this.documentStateValue.revision })
				return { status: 'parse-error', error: this.parseErrorValue }
			}

			this.parseErrorValue = null
			return await this.commitPatch(
				[{ op: 'replace', path: '', value: definition }],
				capturedText,
				definition,
				'json',
			)
		}
		finally {
			this.applying = false
			this.emit()
		}
	}

	/**
	 * Applies a high-level Author command against the current committed Document. Structure commands are
	 * intentionally unavailable while JSON has an unapplied draft, so a semantic action can never discard
	 * expert edits silently. The command's patch then enters the same commit/promotion path as JSON Apply.
	 */
	async author(command: AuthorCommand): Promise<AuthorOutcome> {
		if (this.applying)
			return { status: 'skipped-concurrent' }
		if (this.isDirty)
			return { status: 'draft-dirty' }
		const capturedDraftText = this.draftText

		const prepared = createAuthorPatch(this.documentStateValue.blueprint, command, this.documentStateValue.revision)
		if (!prepared.ok)
			return { status: 'unsupported', reason: prepared.reason }

		this.applying = true
		this.emit()
		try {
			const outcome = await this.commitPatch(prepared.patch, null, null, 'structure')
			// Structure owns a deterministic JSON representation. Only synchronize the draft if Monaco (or
			// another caller) has not changed it while Runtime promotion was awaiting the Preview seam.
			if (outcome.status === 'applied' && this.draftText === capturedDraftText) {
				this.draftText = this.documentStateValue.sourceText
				this.parseErrorValue = null
				this.emit()
			}
			if (outcome.status === 'patch-error')
				return outcome
			if (outcome.status === 'applied')
				return outcome
			return { status: 'skipped-concurrent' }
		}
		finally {
			this.applying = false
			this.emit()
		}
	}

	/** Shared Document commit + Preview promotion lifecycle for JSON and Structure authoring. */
	private async commitPatch(
		patch: Parameters<WidgetDocument<Plugins>['applyPatch']>[0],
		sourceText: string | null,
		definition: JsonValue | null,
		origin: LabPatchOrigin,
	): Promise<ApplyOutcome> {
		const previousDocument = this.documentStateValue
		const previousPreview = this.previewSnapshotValue
		const patchResult = this.document.applyPatch(patch, { expectedRevision: previousDocument.revision })

		if (!patchResult.ok) {
			this.recordDocumentTrace({ kind: 'patch-error', revision: previousDocument.revision, code: patchResult.failure.code })
			return { status: 'patch-error', failure: patchResult.failure }
		}

		const documentSnapshot = this.document.getSnapshot()
		this.lastAppliedSourcePatchValue = Object.freeze({
			origin,
			revision: documentSnapshot.revision,
			patch: snapshotPatch(patch),
		})
		this.recordDocumentTrace({ kind: 'commit', origin, revision: documentSnapshot.revision, changed: patchResult.changed })
		const nextBlueprint = documentSnapshot.blueprint
		const nextSource = nextBlueprint.source as JsonValue
		const nextDefinition = definition ?? nextSource
		const nextSourceText = sourceText ?? JSON.stringify(nextSource, null, 2)

		if (!patchResult.changed) {
			this.documentStateValue = {
				...previousDocument,
				sourceText: nextSourceText,
				definition: nextDefinition,
			}
			this.activeSnapshot = {
				...this.documentStateValue,
				runtime: previousPreview?.runtime ?? null,
			}
			await Promise.resolve()
			return { status: 'applied', blueprintStatus: previousDocument.blueprint.status }
		}

		this.documentStateValue = {
			sourceText: nextSourceText,
			definition: nextDefinition,
			revision: documentSnapshot.revision,
			blueprint: nextBlueprint,
		}

		if (nextBlueprint.status === 'invalid') {
			// #60 decision 2: authored state advances, but the Runtime Host keeps the exact last-valid
			// Preview snapshot alive. No detach/dispose/mount side effects occur for invalid commits.
			this.activeSnapshot = {
				...this.documentStateValue,
				runtime: previousPreview?.runtime ?? null,
			}
			return { status: 'applied', blueprintStatus: 'invalid' }
		}

		if (previousPreview !== null) {
			await this.hooks.detachPreview()
			previousPreview.runtime.dispose()
		}

		const runtime = nextBlueprint.createRuntime()
		this.previewSnapshotValue = {
			revision: documentSnapshot.revision,
			blueprint: nextBlueprint,
			runtime,
		}
		this.activeSnapshot = {
			...this.documentStateValue,
			runtime,
		}

		await this.hooks.mountPreview()
		return { status: 'applied', blueprintStatus: 'valid' }
	}

	/**
	 * Demonstrates Core's optimistic-concurrency failure without changing the Document. The stale
	 * revision and result are both supplied by `WidgetDocument.applyPatch()`; this method only captures
	 * before/after observations for the developer panel.
	 */
	demonstrateRevisionConflict(): RevisionConflictDemoResult {
		const beforeDocument = this.document.getSnapshot()
		const beforePreviewRevision = this.previewSnapshotValue?.revision ?? null
		const expectedRevision = beforeDocument.revision - 1
		const result = this.document.applyPatch(
			[{ op: 'test', path: '', value: null }],
			{ expectedRevision },
		)
		const afterDocument = this.document.getSnapshot()
		const afterPreviewRevision = this.previewSnapshotValue?.revision ?? null
		this.recordDocumentTrace({
			kind: 'conflict-demo',
			expectedRevision,
			actualRevision: afterDocument.revision,
			failureCode: result.ok ? null : result.failure.code,
		})
		this.emit()
		return {
			expectedRevision,
			beforeDocumentRevision: beforeDocument.revision,
			afterDocumentRevision: afterDocument.revision,
			beforePreviewRevision,
			afterPreviewRevision,
			result,
		}
	}

	private recordDocumentTrace(event: LabDocumentTraceEvent): void {
		this.documentTraceValue.push(Object.freeze(event))
		if (this.documentTraceValue.length > LAB_DOCUMENT_TRACE_LIMIT)
			this.documentTraceValue.splice(0, this.documentTraceValue.length - LAB_DOCUMENT_TRACE_LIMIT)
	}

	/**
	 * Presets are source text through the same Apply pipeline: no bypass of `JSON.parse` or the
	 * authoritative Document mutation boundary.
	 */
	async applyPreset(sourceText: string): Promise<ApplyOutcome> {
		this.setDraftSourceText(sourceText)
		return this.apply()
	}

	private emit(): void {
		for (const listener of this.listeners) listener()
	}
}
