/**
 * The host of one repair desk Runtime: everything that belongs to whoever owns the drafts and that `useWidget()`
 * deliberately does not hand a renderer. `DocumentRepairRenderer` (`./index.ts`) creates one host per Runtime and provides it to
 * the renderers below it.
 *
 * **The host plays the notice-board application.** For each draft it can open an editing session:
 * - **Open in the app**: `createWidgetDocument({ system: boardSystem, source: structuredClone(stored) })`. Core retains the
 *   source it is given by reference and never mutates it, but patches share untouched subtrees with the input, so the host
 *   hands over a copy: the stored draft (the `SavedDraft` config) is untouched by everything below, and the session says so
 *   by comparing it with the text it had when the session opened.
 * - **The plan** is `planRepair(snapshot.blueprint.source, savedWith)` (`../domain.ts`), computed from the snapshot the app
 *   last read (`appRevision`). It is the application's policy; Core knows nothing of versions or migrations.
 * - **Apply next step**: `document.applyPatch(step.patch, { expectedRevision: appRevision })`. The host reports `{ ok, changed }`
 *   or the failure (`code`, `operationIndex`; for a stale revision `expectedRevision` and `actualRevision`). A commit makes the
 *   app read the new snapshot and plan again.
 * - **Another editor saves**: a second writer applies a small valid edit to the same document without telling the app. The app's
 *   `appRevision` is then stale, so its next step is refused with `document-revision-conflict` and nothing is applied. "Re-read
 *   and re-plan" reads the current snapshot and plans from it.
 * - **A document listener** logs every committed patch `(snapshot, { previous, patch })`, whoever applied it.
 * - **Preview** creates a Runtime of the notice board system from a VALID Blueprint only; an invalid document has no Runtime to
 *   create, however the app would like it (all-or-nothing validity, nothing is quarantined). **Export** shows the repaired JSON.
 *
 * The host mirrors the session into the draft's State (`revision`, `appRevision`, `repaired`) so the Lab's panels (and the
 * tour) can observe it. It keeps no module state and persists nothing. `dispose()` (and `close()`/`resetAll()`) unsubscribes
 * from the documents and disposes every preview Runtime.
 */

import type { ApplyPatchFailure, SourcePatch, WidgetDocument } from '@deviltea/widget-core'
import type { InjectionKey, Ref } from 'vue'
import type { BoardPlugins } from '../board/plugins'
import type { BoardRuntime } from '../board/system'
import type { Findings, RepairStep, SavedWith } from '../domain'
import type { RepairRuntime } from '../system'
import { createWidgetDocument } from '@deviltea/widget-core'
import { shallowRef } from 'vue'
import { boardSystem } from '../board/system'
import { isRecord, planRepair } from '../domain'
import { findingsOfBlueprint } from '../plugins/findings'

/** Who applied a patch to the document. */
export type Writer = 'app' | 'other-editor'

export type Outcome
	= | { readonly kind: 'applied', readonly by: Writer, readonly stepId: string | null, readonly changed: boolean, readonly from: number, readonly to: number, readonly operations: number }
		| { readonly kind: 'failed', readonly by: Writer, readonly stepId: string | null, readonly code: string, readonly message: string, readonly operationIndex?: number, readonly expectedRevision?: number, readonly actualRevision?: number }

/** One entry of the document listener's log: `(snapshot, { previous, patch })`, kept as plain numbers. */
export interface LogEntry {
	/** 1, 2, 3...: the order the listener heard them in, a stable list key. */
	readonly sequence: number
	readonly by: Writer
	readonly from: number
	readonly to: number
	readonly operations: number
}

export interface SessionView {
	readonly draftId: string
	readonly savedWith: SavedWith
	/** The document's own revision, now. */
	readonly revision: number
	readonly status: 'valid' | 'invalid'
	/** What Core says about the document's current snapshot. */
	readonly findings: Findings
	/** The revision the app last read, and the plan it made from that snapshot. */
	readonly appRevision: number
	readonly plan: readonly RepairStep[]
	/** The document moved on without the app: the next step would use a stale `expectedRevision`. */
	readonly stale: boolean
	readonly lastOutcome: Outcome | null
	readonly log: readonly LogEntry[]
	/** The stored draft is exactly the text it was when the session opened. */
	readonly storedUntouched: boolean
	/** A Runtime of the notice board system created from the valid document, or `null`. */
	readonly preview: BoardRuntime | null
	/** The repaired source as JSON text once exported, or `null`. */
	readonly exported: string | null
}

export type StatusKind = 'opened' | 'applied' | 'no-change' | 'other-saved' | 'reread' | 'previewed' | 'exported' | 'closed' | 'reset'

/** The page's one status line: what the last action did. `values` fill the renderer's text. */
export interface StatusNote {
	readonly kind: StatusKind
	readonly values: Readonly<Record<string, string | number>>
}

/** The page's one alert: the latest refused call. */
export interface AlertNote {
	readonly draftId: string
	readonly stepId: string | null
	readonly code: string
	readonly message: string
	readonly operationIndex?: number
	readonly expectedRevision?: number
	readonly actualRevision?: number
}

export interface RepairHost {
	/** The open sessions by draft id. */
	readonly sessions: Readonly<Ref<ReadonlyMap<string, SessionView>>>
	readonly status: Readonly<Ref<StatusNote | null>>
	readonly alert: Readonly<Ref<AlertNote | null>>
	/** Opens an editing session on a copy of the stored draft; `false` when there is no such draft or it is already open. */
	open: (draftId: string) => boolean
	/** Applies the first step of the app's plan with the revision it was planned at. `null` when there is no session or no step. */
	applyNext: (draftId: string) => Outcome | null
	/** Applies `step` with the revision the app last read. */
	applyStep: (draftId: string, step: RepairStep) => Outcome | null
	/** A second writer saves a small valid edit to the same document, without the app re-reading. */
	otherEditorSaves: (draftId: string) => Outcome | null
	/** The app reads the current snapshot and plans from it. */
	reread: (draftId: string) => void
	/** Creates a Runtime of the notice board system from the document. `false` unless the document is valid. */
	preview: (draftId: string) => boolean
	closePreview: (draftId: string) => void
	exportJson: (draftId: string) => void
	/** Ends the session: unsubscribes and disposes the preview. The stored draft was never changed. */
	close: (draftId: string) => void
	/** Closes every session and clears the page's messages. */
	resetAll: () => void
}

export interface RepairHostHandle {
	readonly host: RepairHost
	/** Closes every session and stops touching the Runtime. */
	dispose: () => void
}

export const RepairHostKey: InjectionKey<RepairHost> = Symbol('widget-lab:repair-host')

export const MAX_LOG = 30

interface Session {
	readonly draftId: string
	readonly savedWith: SavedWith
	readonly storedText: string
	readonly document: WidgetDocument<BoardPlugins>
	unsubscribe: () => void
	appRevision: number
	plan: readonly RepairStep[]
	lastOutcome: Outcome | null
	log: LogEntry[]
	sequence: number
	preview: BoardRuntime | null
	exported: string | null
}

/** The small valid edit the second writer makes: the board title gets a mark, or the root gets `meta` when there is no title to mark. */
export function otherEditorPatch(source: unknown): SourcePatch {
	if (!isRecord(source))
		return []
	const config = source.config
	const title = isRecord(config) && isRecord(config.title) ? config.title : null
	if (title !== null && typeof title.en === 'string')
		return [{ op: 'replace', path: ['config', 'title', 'en'], value: `${title.en} (edited)` }]
	return [{ op: 'add', path: ['meta'], value: { editedBy: 'another editor' } }]
}

function failureOutcome(by: Writer, stepId: string | null, failure: ApplyPatchFailure): Outcome {
	const base = { kind: 'failed', by, stepId, code: failure.code, message: failure.message } as const
	if (failure.code === 'document-revision-conflict')
		return { ...base, expectedRevision: failure.expectedRevision, actualRevision: failure.actualRevision }
	if ('operationIndex' in failure)
		return { ...base, operationIndex: failure.operationIndex }
	return base
}

export function createRepairHost(runtime: RepairRuntime): RepairHostHandle {
	const sessions = new Map<string, Session>()
	const views = shallowRef<ReadonlyMap<string, SessionView>>(new Map())
	const status = shallowRef<StatusNote | null>(null)
	const alert = shallowRef<AlertNote | null>(null)
	let writer: Writer | null = null
	let disposed = false

	function readDraft(draftId: string): { readonly source: unknown, readonly savedWith: SavedWith, readonly widget: ReturnType<typeof runtime.getWidget> } | null {
		if (disposed || runtime.isDisposed)
			return null
		const widget = runtime.getWidget(draftId)
		if (widget === null || widget.type !== 'SavedDraft')
			return null
		const source = widget.properties.source.get()
		const savedWith = widget.properties.savedWith.get()
		return source.ok && savedWith.ok ? { source: source.value, savedWith: savedWith.value, widget } : null
	}

	function mirror(session: Session | null, draftId: string): void {
		if (disposed || runtime.isDisposed)
			return
		const widget = runtime.getWidget(draftId)
		if (widget === null || widget.type !== 'SavedDraft')
			return
		const snapshot = session?.document.getSnapshot()
		widget.state.revision.set(snapshot?.revision ?? -1)
		widget.state.appRevision.set(session?.appRevision ?? -1)
		widget.state.repaired.set(snapshot?.blueprint.status === 'valid')
	}

	function viewOf(session: Session): SessionView {
		const snapshot = session.document.getSnapshot()
		const stored = readDraft(session.draftId)
		return {
			draftId: session.draftId,
			savedWith: session.savedWith,
			revision: snapshot.revision,
			status: snapshot.blueprint.status,
			findings: findingsOfBlueprint(snapshot.blueprint),
			appRevision: session.appRevision,
			plan: session.plan,
			stale: session.appRevision !== snapshot.revision,
			lastOutcome: session.lastOutcome,
			log: session.log,
			storedUntouched: stored !== null && JSON.stringify(stored.source) === session.storedText,
			preview: session.preview,
			exported: session.exported,
		}
	}

	function publish(): void {
		views.value = new Map([...sessions].map(([draftId, session]) => [draftId, viewOf(session)]))
	}

	function disposePreview(session: Session): void {
		session.preview?.dispose()
		session.preview = null
	}

	function setStatus(kind: StatusKind, values: Record<string, string | number> = {}): void {
		status.value = { kind, values }
	}

	function setAlert(session: Session, outcome: Outcome): void {
		if (outcome.kind !== 'failed') {
			alert.value = null
			return
		}
		alert.value = {
			draftId: session.draftId,
			stepId: outcome.stepId,
			code: outcome.code,
			message: outcome.message,
			...(outcome.operationIndex === undefined ? {} : { operationIndex: outcome.operationIndex }),
			...(outcome.expectedRevision === undefined ? {} : { expectedRevision: outcome.expectedRevision }),
			...(outcome.actualRevision === undefined ? {} : { actualRevision: outcome.actualRevision }),
		}
	}

	function readSnapshotIntoApp(session: Session): void {
		const snapshot = session.document.getSnapshot()
		session.appRevision = snapshot.revision
		session.plan = planRepair(snapshot.blueprint.source, session.savedWith)
	}

	function close(draftId: string): void {
		const session = sessions.get(draftId)
		if (session === undefined)
			return
		session.unsubscribe()
		disposePreview(session)
		sessions.delete(draftId)
		mirror(null, draftId)
		if (alert.value?.draftId === draftId)
			alert.value = null
		setStatus('closed', { draft: draftId })
		publish()
	}

	function open(draftId: string): boolean {
		if (sessions.has(draftId))
			return false
		const draft = readDraft(draftId)
		if (draft === null)
			return false
		const document = createWidgetDocument({ system: boardSystem, source: structuredClone(draft.source) })
		const session: Session = {
			draftId,
			savedWith: draft.savedWith,
			storedText: JSON.stringify(draft.source),
			document,
			unsubscribe: () => {},
			appRevision: 0,
			plan: [],
			lastOutcome: null,
			log: [],
			sequence: 0,
			preview: null,
			exported: null,
		}
		session.unsubscribe = document.subscribe((snapshot, { previous, patch }) => {
			session.sequence += 1
			session.log = [...session.log, { sequence: session.sequence, by: writer ?? 'app', from: previous.revision, to: snapshot.revision, operations: patch.length }].slice(-MAX_LOG)
		})
		readSnapshotIntoApp(session)
		sessions.set(draftId, session)
		mirror(session, draftId)
		setStatus('opened', { draft: draftId, revision: session.appRevision })
		alert.value = null
		publish()
		return true
	}

	function applyWith(session: Session, by: Writer, stepId: string | null, patch: SourcePatch, expectedRevision: number | undefined): Outcome {
		const from = session.document.getSnapshot().revision
		writer = by
		const result = expectedRevision === undefined ? session.document.applyPatch(patch) : session.document.applyPatch(patch, { expectedRevision })
		writer = null
		const outcome: Outcome = result.ok
			? { kind: 'applied', by, stepId, changed: result.changed, from, to: session.document.getSnapshot().revision, operations: patch.length }
			: failureOutcome(by, stepId, result.failure)
		session.lastOutcome = outcome
		return outcome
	}

	function applyStep(draftId: string, step: RepairStep): Outcome | null {
		const session = sessions.get(draftId)
		if (session === undefined)
			return null
		const outcome = applyWith(session, 'app', step.id, step.patch, session.appRevision)
		if (outcome.kind === 'applied' && outcome.changed) {
			disposePreview(session)
			session.exported = null
			readSnapshotIntoApp(session)
			setStatus('applied', { step: step.id, from: outcome.from, to: outcome.to })
		}
		else if (outcome.kind === 'applied') {
			setStatus('no-change', { step: step.id, revision: outcome.to })
		}
		setAlert(session, outcome)
		mirror(session, draftId)
		publish()
		return outcome
	}

	function applyNext(draftId: string): Outcome | null {
		const step = sessions.get(draftId)?.plan[0]
		return step === undefined ? null : applyStep(draftId, step)
	}

	function otherEditorSaves(draftId: string): Outcome | null {
		const session = sessions.get(draftId)
		if (session === undefined)
			return null
		// The other editor works on the live document and does not use the app's revision: it simply saves.
		const outcome = applyWith(session, 'other-editor', null, otherEditorPatch(session.document.getSnapshot().blueprint.source), undefined)
		if (outcome.kind === 'applied' && outcome.changed) {
			disposePreview(session)
			session.exported = null
			setStatus('other-saved', { from: outcome.from, to: outcome.to })
		}
		setAlert(session, outcome)
		mirror(session, draftId)
		publish()
		return outcome
	}

	function reread(draftId: string): void {
		const session = sessions.get(draftId)
		if (session === undefined)
			return
		readSnapshotIntoApp(session)
		session.lastOutcome = null
		alert.value = alert.value?.draftId === draftId ? null : alert.value
		setStatus('reread', { revision: session.appRevision, steps: session.plan.length })
		mirror(session, draftId)
		publish()
	}

	function preview(draftId: string): boolean {
		const session = sessions.get(draftId)
		if (session === undefined)
			return false
		const blueprint = session.document.getSnapshot().blueprint
		// Only a valid Blueprint has `createRuntime`: an invalid document has no Runtime to create.
		if (blueprint.status !== 'valid')
			return false
		disposePreview(session)
		session.preview = blueprint.createRuntime()
		setStatus('previewed', { revision: session.document.getSnapshot().revision })
		publish()
		return true
	}

	function closePreview(draftId: string): void {
		const session = sessions.get(draftId)
		if (session === undefined)
			return
		disposePreview(session)
		publish()
	}

	function exportJson(draftId: string): void {
		const session = sessions.get(draftId)
		if (session === undefined)
			return
		session.exported = JSON.stringify(session.document.getSnapshot().blueprint.source, null, 2)
		setStatus('exported', { revision: session.document.getSnapshot().revision })
		publish()
	}

	function closeAll(): void {
		for (const draftId of [...sessions.keys()]) {
			const session = sessions.get(draftId)!
			session.unsubscribe()
			disposePreview(session)
			sessions.delete(draftId)
			mirror(null, draftId)
		}
		alert.value = null
	}

	function resetAll(): void {
		closeAll()
		setStatus('reset')
		publish()
	}

	function dispose(): void {
		closeAll()
		disposed = true
		publish()
	}

	return {
		host: { sessions: views, status, alert, open, applyNext, applyStep, otherEditorSaves, reread, preview, closePreview, exportJson, close, resetAll },
		dispose,
	}
}
