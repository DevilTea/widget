/**
 * Widget Lab session types — the non-UI Apply lifecycle contract.
 *
 * Normative source: diagnostic #13 (Widget Lab Phase 4) comment "Checkpoint — Source Apply lifecycle and
 * applied snapshot boundary". This module owns only the Lab-local shape; it consumes
 * `@deviltea/widget-core`'s public Blueprint/Runtime contract and never reinterprets it.
 */

import type { AnyWidgetPluginTuple, ApplyPatchFailure, ApplyPatchResult, JsonPrimitive, SourcePatch, ValidWidgetSystemBlueprint, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'

/** The deliberately narrow semantic command surface exposed by the Phase 3 Structure view. */
export interface ReplaceConfigScalarCommand {
	readonly type: 'replace-config-scalar'
	/** Snapshot-local identity from the current Document inspection. Never reused across revisions. */
	readonly nodeId: InspectionNodeId
	readonly documentRevision: number
	readonly configKey: string
	readonly value: JsonPrimitive
}

export type AuthorCommand = ReplaceConfigScalarCommand

export type AuthorOutcome
	= | { readonly status: 'applied', readonly blueprintStatus: 'valid' | 'invalid' }
		| { readonly status: 'skipped-concurrent' }
		| { readonly status: 'draft-dirty' }
		| { readonly status: 'unsupported', readonly reason: 'stale-selection' | 'widget-not-found' | 'config-not-found' | 'config-value-not-scalar' | 'invalid-value' }
		| { readonly status: 'patch-error', readonly failure: ApplyPatchFailure }

/**
 * A `JSON.parse()` syntax failure at Apply time. Lab-only: never injected into core Blueprint
 * diagnostics, and never surfaced when the active snapshot itself is untouched by a failed Apply.
 */
export interface SourceParseError {
	/** The native `SyntaxError` message, kept verbatim (never re-parsed for a machine taxonomy). */
	readonly message: string
	/** The exact draft text that failed to parse, captured at the start of the Apply command. */
	readonly sourceText: string
}

/**
 * The last successfully parsed-and-applied source snapshot.
 *
 * `definition` is the exact Lab-local `JSON.parse(sourceText)` value accepted by Apply. Core's
 * authoritative authored source/Blueprint lives in the `WidgetDocument`; `revision` is that Document
 * snapshot revision. A text-only structural no-op may therefore update `sourceText`/`definition` while
 * retaining the same revision and Blueprint. Runtime ownership is deliberately separate in
 * `LabPreviewSnapshot`: an invalid current Document may coexist with an older, still-running Preview.
 */
export interface LabDocumentState<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly sourceText: string
	readonly definition: unknown
	readonly revision: number
	readonly blueprint: WidgetSystemBlueprint<Plugins>
}

/** The last valid Blueprint revision promoted to the remote Preview host. No Runtime object lives here. */
export interface LabPreviewSnapshot<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly revision: number
	readonly sourceText: string
	readonly blueprint: ValidWidgetSystemBlueprint<Plugins>
}

/**
 * Caller-supplied remote Preview promotion seam (issue #10 / Phase B2).
 *
 * `LabSession` owns only the authored WidgetDocument and last-valid Preview metadata. The hook is the
 * one point where a valid committed snapshot is handed to the remote Preview host; that host owns
 * renderer unmount, Runtime disposal/creation, InspectorAgent binding, and readiness acknowledgement.
 */
export interface LabSessionHooks<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	replacePreview: (preview: LabPreviewSnapshot<Plugins>) => Promise<void> | void
}

export type ApplyOutcome
	= | { readonly status: 'skipped-concurrent' }
		| { readonly status: 'parse-error', readonly error: SourceParseError }
		| { readonly status: 'patch-error', readonly failure: ApplyPatchFailure }
		| { readonly status: 'applied', readonly blueprintStatus: 'valid' | 'invalid' }

/** Lab-only provenance for the latest applied patch; this is telemetry, not authored-state authority. */
export type LabPatchOrigin = 'json' | 'structure'

export interface LabAppliedSourcePatch {
	readonly origin: LabPatchOrigin
	readonly revision: number
	readonly patch: SourcePatch
}

/** Bounded, session-only observations of Document-related Lab activity. Never replayable history. */
export type LabDocumentTraceEvent
	= | {
		readonly kind: 'commit'
		readonly origin: LabPatchOrigin
		readonly revision: number
		readonly changed: boolean
	}
	| {
		readonly kind: 'parse-error'
		readonly revision: number
	}
	| {
		readonly kind: 'patch-error'
		readonly revision: number
		readonly code: ApplyPatchFailure['code']
	}
	| {
		readonly kind: 'conflict-demo'
		readonly expectedRevision: number
		readonly actualRevision: number
		readonly failureCode: ApplyPatchFailure['code'] | null
	}

export interface RevisionConflictDemoResult {
	readonly expectedRevision: number
	readonly beforeDocumentRevision: number
	readonly afterDocumentRevision: number
	readonly beforePreviewRevision: number | null
	readonly afterPreviewRevision: number | null
	readonly result: ApplyPatchResult
}

/**
 * Fired after every state-observable Lab mutation (draft edits, Apply start/end, revert, format).
 * Carries no payload — listeners re-read whatever `LabSession` fields they care about, mirroring the
 * plain-getter, framework-agnostic shape the rest of this module keeps.
 */
export type LabSessionListener = () => void
