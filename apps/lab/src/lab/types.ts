/**
 * Widget Lab session types — the non-UI Apply lifecycle contract.
 *
 * Normative source: issue #13 (Widget Lab Phase 4) comment "Checkpoint — Source Apply lifecycle and
 * applied snapshot boundary". This module owns only the Lab-local shape; it consumes
 * `@deviltea/widget-core`'s public Blueprint/Runtime contract and never reinterprets it.
 */

import type { AnyWidgetPluginTuple, WidgetSystemBlueprint, WidgetSystemRuntime } from '@deviltea/widget-core'

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
 * `definition` is the exact `JSON.parse(sourceText)` value handed to
 * `WidgetSystem.createBlueprint(...)`, with no Lab cloning/normalization. `runtime` is `null`
 * whenever `blueprint.status !== 'valid'` — a semantically invalid Blueprint is still a
 * successfully applied snapshot, it simply has no Runtime and no Preview.
 */
export interface LabActiveSnapshot<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly sourceText: string
	readonly definition: unknown
	readonly blueprint: WidgetSystemBlueprint<Plugins>
	readonly runtime: WidgetSystemRuntime<Plugins> | null
}

/**
 * Caller-supplied Preview replacement seam (issue #13 Phase 4 Apply-lifecycle comment).
 *
 * `LabSession` never touches the DOM or Vue directly; it only sequences these two hooks around
 * Runtime disposal so the Vue layer can guarantee the old renderer subtree has actually unmounted
 * (e.g. by clearing the Preview `runtime` prop and awaiting a Vue render boundary) before the old
 * Runtime is disposed, and mount the new Preview only after the new Runtime exists.
 */
export interface LabSessionHooks {
	/** Called once, only when an old Runtime exists, before it is disposed. */
	detachPreview: () => Promise<void> | void
	/** Called once, only when a fresh Runtime was created for the new snapshot. */
	mountPreview: () => Promise<void> | void
}

export type ApplyOutcome
	= | { readonly status: 'skipped-concurrent' }
		| { readonly status: 'parse-error', readonly error: SourceParseError }
		| { readonly status: 'applied', readonly blueprintStatus: 'valid' | 'invalid' }

/**
 * Fired after every state-observable Lab mutation (draft edits, Apply start/end, revert, format).
 * Carries no payload — listeners re-read whatever `LabSession` fields they care about, mirroring the
 * plain-getter, framework-agnostic shape the rest of this module keeps.
 */
export type LabSessionListener = () => void
