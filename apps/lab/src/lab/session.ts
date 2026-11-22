/**
 * `LabSession` — the Widget Lab draft + Document/remote-Preview promotion host.
 *
 * Normative source: diagnostic #13 (Widget Lab Phase 4) comment "Checkpoint — Source Apply lifecycle and
 * applied snapshot boundary". Framework-agnostic on purpose: this module never imports Vue and never
 * touches the DOM. The Vue layer supplies `LabSessionHooks` (see `types.ts`) as the seam that lets it
 * acknowledge remote Preview replacement; `LabSession` never creates or disposes a Runtime.
 *
 * Authored-state authority belongs to core's public `WidgetDocument`: parsed Lab JSON enters through
 * a root `SourcePatch` replacement, and the Lab reacts to the committed Document snapshot. Runtime
 * promotion intent remains Lab-owned while Runtime execution is owned exclusively by the iframe Preview host.
 */

import type { AnyWidgetPluginTuple, ApplyPatchFailure, JsonValue, SourcePatch, WidgetDocument, WidgetDocumentSnapshot, WidgetSystem } from '@deviltea/widget-core'
import type { ApplyOutcome, AuthorCommand, AuthorOutcome, LabAppliedSourcePatch, LabDocumentState, LabDocumentTraceEvent, LabJsonBlock, LabPatchOrigin, LabPreviewSnapshot, LabSessionHooks, LabSessionListener, RevisionConflictDemoResult, SourceParseError, UndoOutcome } from './types'
import { createWidgetDocument } from '@deviltea/widget-core'
import { createAuthorPatch } from './author'
import { sameJsonDocument } from './json-equal'

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
	replacePreview: () => {},
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
/** How many committed sources "Undo last change" can step back through. */
export const LAB_UNDO_LIMIT = 20

/**
 * Identifies one burst of JSON commits (Lab UX phase 3: one focus session of the JSON view). Consecutive JSON commits with
 * the same key share one Undo entry; `null` never coalesces.
 */
export type LabCoalesceKey = string | number | null

export interface CommitJsonOptions {
	readonly coalesceKey?: LabCoalesceKey
}

type DraftParse
	= | { readonly ok: true, readonly value: JsonValue }
		| { readonly ok: false, readonly error: SourceParseError }

function parseDraft(text: string): DraftParse {
	try {
		return { ok: true, value: JSON.parse(text) as JsonValue }
	}
	catch (error) {
		return { ok: false, error: toParseError(text, error) }
	}
}

export class LabSession<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	private readonly document: WidgetDocument<Plugins>
	private readonly hooks: LabSessionHooks
	private readonly listeners = new Set<LabSessionListener>()

	private draftText: string
	/** The current JSON text, parsed once (Lab UX phase 3: the syntax state is live, and the commit reuses this value). */
	private draftParse: DraftParse
	/** The last JSON commit that failed mechanically, with the text it tried; it blocks only while the text is that one. */
	private commitFailureValue: { readonly sourceText: string, readonly failure: ApplyPatchFailure } | null = null
	private documentStateValue: LabDocumentState<Plugins>
	private previewSnapshotValue: LabPreviewSnapshot<Plugins> | null
	private lastAppliedSourcePatchValue: LabAppliedSourcePatch | null = null
	private readonly documentTraceValue: LabDocumentTraceEvent[] = []
	/**
	 * Source texts the Document held before each of its last `LAB_UNDO_LIMIT` revision-advancing commits,
	 * oldest first. It is a convenience for "Undo last change" only: restoring one goes back through the
	 * ordinary `WidgetDocument` commit path as a new revision, so this is never an authoritative history.
	 */
	private readonly undoStack: string[] = []
	/** The coalesce key of the JSON commit that pushed the top Undo entry; `null` when another kind of commit did, or after Undo. */
	private topUndoKey: LabCoalesceKey = null
	/** Entries the top entry's push evicted (`LAB_UNDO_LIMIT`), kept while its burst may still drop that entry (`recordUndo()`). */
	private evictedByTop: string[] = []
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
			? { revision, sourceText: options.initialSourceText, blueprint }
			: null
		this.draftText = options.initialSourceText
		this.draftParse = { ok: true, value: definition }
	}

	get draftSourceText(): string {
		return this.draftText
	}

	get system(): WidgetSystem<Plugins> {
		return this.documentStateValue.blueprint.system
	}

	/**
	 * The syntax error of the current JSON text, or `null` when it parses (Lab UX phase 3: live, no longer "of the last
	 * Apply"). Lab-only: never a Core diagnostic, and nothing is committed from such a text.
	 */
	get parseError(): SourceParseError | null {
		return this.draftParse.ok ? null : this.draftParse.error
	}

	/**
	 * Why the current JSON text cannot be applied, or `null` when it can (or equals the Document): a syntax error, or a commit of
	 * exactly this text that Core refused (`LabJsonBlock`). Nothing is committed from a blocked text until it changes.
	 */
	get jsonBlock(): LabJsonBlock | null {
		const failed = this.commitFailureValue !== null && this.commitFailureValue.sourceText === this.draftText && this.isDirty
			? this.commitFailureValue
			: null
		const cache = this.jsonBlockCache
		// The same object while nothing it depends on changed, so reactive readers (the Problems list) do not recompute.
		if (cache !== null && cache.parse === this.draftParse && cache.failed === failed)
			return cache.block
		let block: LabJsonBlock | null = null
		if (!this.draftParse.ok)
			block = { kind: 'syntax', error: this.draftParse.error }
		else if (failed !== null)
			block = { kind: 'commit', sourceText: failed.sourceText, failure: failed.failure }
		this.jsonBlockCache = { parse: this.draftParse, failed, block }
		return block
	}

	private jsonBlockCache: { readonly parse: DraftParse, readonly failed: unknown, readonly block: LabJsonBlock | null } | null = null

	/** Current Lab-owned representation of the authoritative Document revision. */
	get documentState(): LabDocumentState<Plugins> {
		return this.documentStateValue
	}

	/** Last valid Runtime promoted into Preview, or null when this session has never had one. */
	get preview(): LabPreviewSnapshot<Plugins> | null {
		return this.previewSnapshotValue
	}

	/** Core-authored committed state, independent of Runtime promotion timing. */
	get documentSnapshot(): WidgetDocumentSnapshot<Plugins> {
		return this.document.getSnapshot()
	}

	get isApplying(): boolean {
		return this.applying
	}

	/** The JSON text differs from the committed Document's source text: a commit is pending, or the text does not parse. */
	get isDirty(): boolean {
		return this.draftText !== this.documentStateValue.sourceText
	}

	/** How many committed sources "Undo last change" can still restore. */
	get undoDepth(): number {
		return this.undoStack.length
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
	 * Editing the JSON text never recompiles; it only parses the text (once, and the commit reuses the value), so the syntax
	 * state (`parseError`) always describes the current text. Committing is the caller's decision (`commitJson()`). A new
	 * text also clears a commit failure of the old one (`jsonBlock`): the new text gets its own try.
	 */
	setDraftSourceText(text: string): void {
		if (text !== this.draftText) {
			this.draftText = text
			this.commitFailureValue = null
			this.draftParse = text === this.documentStateValue.sourceText
				? { ok: true, value: this.documentStateValue.definition as JsonValue }
				: parseDraft(text)
		}
		this.emit()
	}

	/**
	 * Rewrites the JSON text as pretty JSON. Never commits, compiles, or disposes anything. A text that fails to parse is
	 * left untouched — Format has no diagnostic surface of its own.
	 */
	format(): void {
		if (!this.draftParse.ok)
			return
		this.setDraftSourceText(JSON.stringify(this.draftParse.value, null, 2))
	}

	/**
	 * Discards the JSON text: `draftSourceText = documentState.sourceText` (the header's "Discard JSON changes" while the text
	 * does not parse). Never touches the committed Document revision or the independently owned remote Preview.
	 */
	revert(): void {
		this.setDraftSourceText(this.documentStateValue.sourceText)
	}

	/**
	 * Commits the JSON text (diagnostic #13 Phase 4 Apply-lifecycle comment; since Lab UX phase 3 the store calls it when the
	 * text parses, after a pause in typing and on blur, instead of from an Apply button):
	 *
	 * - captures the text at command start; concurrent edits stay in the text and are not committed;
	 * - a concurrent commit is disabled — a call while one is already running is a no-op;
	 * - a `JSON.parse` failure leaves committed state/Preview untouched (`parse-error`, the Lab-only `SourceParseError`);
	 * - consecutive commits with the same non-null `coalesceKey` share one Undo entry (`recordUndo()`);
	 * - parsed JSON is submitted to the authoritative `WidgetDocument` as one root replacement;
	 * - a structural no-op (`changed:false`) accepts the Lab-local text representation without
	 *   inventing a Document revision or replacing the existing Runtime/Preview;
	 * - a changed invalid Document advances authored state but retains the exact last-valid Preview;
	 * - a changed valid Document commits/compiles first, then awaits one remote Preview replacement hook;
	 * - no Runtime exists in this parent session, and no Runtime state is migrated between revisions.
	 */
	async commitJson(options: CommitJsonOptions = {}): Promise<ApplyOutcome> {
		if (this.applying)
			return { status: 'skipped-concurrent' }

		const capturedText = this.draftText
		const parsed = this.draftParse
		this.applying = true
		this.emit()

		try {
			if (!parsed.ok) {
				this.recordDocumentTrace({ kind: 'parse-error', revision: this.documentStateValue.revision })
				return { status: 'parse-error', error: parsed.error }
			}

			const outcome = await this.commitPatch(
				[{ op: 'replace', path: '', value: parsed.value }],
				capturedText,
				parsed.value,
				'json',
				options.coalesceKey ?? null,
			)
			// Core refused this exact text (a number outside the JSON domain, nesting too deep): it stays blocked, visibly, until
			// it changes, instead of looking like a commit that is merely pending (`jsonBlock`).
			this.commitFailureValue = outcome.status === 'patch-error' ? { sourceText: capturedText, failure: outcome.failure } : null
			return outcome
		}
		finally {
			this.applying = false
			this.emit()
		}
	}

	/**
	 * Applies a high-level Author command against the current committed Document. Structure commands are
	 * intentionally unavailable while the JSON text differs from the Document (`draft-dirty`), so a semantic action can
	 * never discard expert edits silently. The command's patch then enters the same commit/promotion path as a JSON commit.
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
			if (outcome.status === 'applied' && this.draftText === capturedDraftText)
				this.setDraftSourceText(this.documentStateValue.sourceText)
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

	/**
	 * Restores the source the Document held before its last revision-advancing commit, as a NEW Document
	 * revision through the same root-replacement commit and Preview promotion path as a JSON commit (never by
	 * rewinding Core's Document). Distinct from `revert()`, which only discards the JSON text:
	 *
	 * - unavailable while the JSON text differs from the Document (`draft-dirty`; the store commits a pending text first and
	 *   refuses while the text does not parse, so Undo never discards typing silently) and while another command runs;
	 * - the restored source becomes the JSON text too, unless the user typed during the commit;
	 * - Undo itself pushes no history, so repeated Undo walks back through the stack one step at a time.
	 */
	async undo(): Promise<UndoOutcome> {
		if (this.applying)
			return { status: 'skipped-concurrent' }
		if (this.isDirty)
			return { status: 'draft-dirty' }
		const previousText = this.undoStack.at(-1)
		if (previousText === undefined)
			return { status: 'nothing-to-undo' }

		const capturedDraftText = this.draftText
		this.applying = true
		this.emit()
		try {
			// Every stacked text was parsed by an earlier commit (or is the constructor's valid initial text).
			const definition = JSON.parse(previousText) as JsonValue
			const outcome = await this.commitPatch([{ op: 'replace', path: '', value: definition }], previousText, definition, 'undo')
			if (outcome.status === 'patch-error')
				return outcome
			if (outcome.status !== 'applied')
				return { status: 'skipped-concurrent' }
			this.undoStack.pop()
			this.topUndoKey = null
			this.evictedByTop = []
			if (this.draftText === capturedDraftText)
				this.setDraftSourceText(this.documentStateValue.sourceText)
			return { status: 'undone', blueprintStatus: outcome.blueprintStatus }
		}
		finally {
			this.applying = false
			this.emit()
		}
	}

	/**
	 * Mounts the Preview again after a failure to mount it (audit U22): the newest valid Document if it is ahead of the
	 * Preview (a promotion that failed leaves the Document committed and the Preview on the older revision), else the
	 * Preview as it is. On success the Preview is that snapshot, so the revision status agrees with what the frame shows.
	 * Unavailable while another command runs; a failing mount rejects again, and the Preview stays as it was.
	 */
	async retryPreview(): Promise<void> {
		if (this.applying)
			return
		const document = this.documentStateValue
		const target: LabPreviewSnapshot<Plugins> | null = document.blueprint.status === 'valid'
			? { revision: document.revision, sourceText: document.sourceText, blueprint: document.blueprint }
			: this.previewSnapshotValue
		if (target === null)
			return
		this.applying = true
		this.emit()
		try {
			await this.hooks.replacePreview(target)
			this.previewSnapshotValue = target
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
		coalesceKey: LabCoalesceKey = null,
	): Promise<ApplyOutcome> {
		const previousDocument = this.documentStateValue
		const patchResult = this.document.applyPatch(patch, { expectedRevision: previousDocument.revision })

		if (!patchResult.ok) {
			const failure = patchResult.failure
			this.recordDocumentTrace({
				kind: 'patch-error',
				revision: previousDocument.revision,
				code: failure.code,
				...('path' in failure && failure.path !== undefined ? { path: failure.path } : {}),
				...('reason' in failure && failure.reason !== undefined ? { reason: failure.reason } : {}),
			})
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
			await Promise.resolve()
			return { status: 'applied', blueprintStatus: previousDocument.blueprint.status }
		}

		if (origin !== 'undo')
			this.recordUndo(previousDocument.sourceText, nextSourceText, coalesceKey)
		this.documentStateValue = {
			sourceText: nextSourceText,
			definition: nextDefinition,
			revision: documentSnapshot.revision,
			blueprint: nextBlueprint,
		}

		if (nextBlueprint.status === 'invalid') {
			// #60 decision 2: authored state advances, but the Runtime Host keeps the exact last-valid
			// Preview snapshot alive. No detach/dispose/mount side effects occur for invalid commits.
			return { status: 'applied', blueprintStatus: 'invalid' }
		}

		const nextPreview: LabPreviewSnapshot<Plugins> = {
			revision: documentSnapshot.revision,
			sourceText: nextSourceText,
			blueprint: nextBlueprint,
		}
		await this.hooks.replacePreview(nextPreview)
		this.previewSnapshotValue = nextPreview
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

	/**
	 * Pushes the source a revision-advancing commit replaced. A JSON commit whose coalesce key is the one that pushed the top
	 * entry pushes nothing: that entry already holds the source from before the burst (Lab UX phase 3), so one Undo takes the
	 * whole burst back. If such a commit lands back on that source, the entry has nothing left to undo and is dropped.
	 *
	 * `LAB_UNDO_LIMIT`: the entry a burst pushes may evict the oldest one. While the burst goes on, that evicted entry is kept
	 * aside (`evictedByTop`); if the burst drops its entry, the evicted one comes back at the bottom, so a burst that changed
	 * nothing costs no history. Once anything else happens (another push, Undo) the eviction is final.
	 */
	private recordUndo(previousSourceText: string, nextSourceText: string, coalesceKey: LabCoalesceKey): void {
		if (coalesceKey !== null && coalesceKey === this.topUndoKey && this.undoStack.length > 0) {
			if (sameJsonDocument(this.undoStack.at(-1)!, nextSourceText)) {
				this.undoStack.pop()
				this.undoStack.unshift(...this.evictedByTop)
				this.evictedByTop = []
				this.topUndoKey = null
			}
			return
		}
		this.undoStack.push(previousSourceText)
		const evicted = this.undoStack.length > LAB_UNDO_LIMIT ? this.undoStack.splice(0, this.undoStack.length - LAB_UNDO_LIMIT) : []
		this.evictedByTop = coalesceKey === null ? [] : evicted
		this.topUndoKey = coalesceKey
	}

	private recordDocumentTrace(event: LabDocumentTraceEvent): void {
		this.documentTraceValue.push(Object.freeze(event))
		if (this.documentTraceValue.length > LAB_DOCUMENT_TRACE_LIMIT)
			this.documentTraceValue.splice(0, this.documentTraceValue.length - LAB_DOCUMENT_TRACE_LIMIT)
	}

	/**
	 * Presets are source text through the same JSON commit pipeline: no bypass of `JSON.parse` or the
	 * authoritative Document mutation boundary. A preset load never coalesces.
	 */
	async applyPreset(sourceText: string): Promise<ApplyOutcome> {
		this.setDraftSourceText(sourceText)
		return this.commitJson()
	}

	private emit(): void {
		for (const listener of this.listeners) listener()
	}
}
