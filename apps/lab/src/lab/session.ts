/**
 * `LabSession` — the Widget Lab Source Apply lifecycle state machine.
 *
 * Normative source: diagnostic #13 (Widget Lab Phase 4) comment "Checkpoint — Source Apply lifecycle and
 * applied snapshot boundary". Framework-agnostic on purpose: this module never imports Vue and never
 * touches the DOM. The Vue layer supplies `LabSessionHooks` (see `types.ts`) as the seam that lets it
 * guarantee Preview unmount-before-dispose ordering; `LabSession` only sequences those hooks.
 *
 * Consumes `@deviltea/widget-core` only through its public contract (`WidgetSystem`,
 * `WidgetSystemBlueprint`, `WidgetSystemRuntime`) — no private imports, no reinterpretation of core
 * semantics.
 */

import type { AnyWidgetPluginTuple, WidgetSystem } from '@deviltea/widget-core'
import type { ApplyOutcome, LabActiveSnapshot, LabSessionHooks, LabSessionListener, SourceParseError } from './types'

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

export class LabSession<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	private readonly system: WidgetSystem<Plugins>
	private readonly hooks: LabSessionHooks
	private readonly listeners = new Set<LabSessionListener>()

	private draftText: string
	private parseErrorValue: SourceParseError | null = null
	private activeSnapshot: LabActiveSnapshot<Plugins>
	private applying = false

	constructor(options: LabSessionOptions<Plugins>) {
		this.system = options.system
		this.hooks = options.hooks ?? noopHooks

		const definition: unknown = JSON.parse(options.initialSourceText)
		const blueprint = this.system.createBlueprint(definition)
		const runtime = blueprint.status === 'valid' ? blueprint.createRuntime() : null

		this.activeSnapshot = {
			sourceText: options.initialSourceText,
			definition,
			blueprint,
			runtime,
		}
		this.draftText = options.initialSourceText
	}

	get draftSourceText(): string {
		return this.draftText
	}

	get parseError(): SourceParseError | null {
		return this.parseErrorValue
	}

	get active(): LabActiveSnapshot<Plugins> {
		return this.activeSnapshot
	}

	get isApplying(): boolean {
		return this.applying
	}

	get isDirty(): boolean {
		return this.draftText !== this.activeSnapshot.sourceText
	}

	subscribe(listener: LabSessionListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
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
	 * Restores `draftSourceText = active.sourceText` and clears the Lab parse error. Never touches the
	 * active Blueprint/Runtime.
	 */
	revert(): void {
		this.setDraftSourceText(this.activeSnapshot.sourceText)
	}

	/**
	 * The deterministic Apply command (diagnostic #13 Phase 4 Apply-lifecycle comment):
	 *
	 * - captures the draft at command start; concurrent edits stay in the draft and are not applied;
	 * - concurrent Apply is disabled — a call while one is already running is a no-op;
	 * - a `JSON.parse` failure sets a Lab-only `SourceParseError` and leaves `active` untouched;
	 * - a parse ok always crosses the applied-snapshot boundary, even when the resulting
	 *   Blueprint is semantically invalid (`runtime` becomes `null`, Preview unavailable);
	 * - replacement ordering: detach old Preview -> dispose old Runtime -> commit the new Blueprint
	 *   snapshot -> create a fresh Runtime when valid -> mount the new Preview. `WidgetRenderer` (the
	 *   Vue layer) never disposes a Runtime itself; this method owns that lifecycle.
	 */
	async apply(): Promise<ApplyOutcome> {
		if (this.applying)
			return { status: 'skipped-concurrent' }

		const capturedText = this.draftText
		this.applying = true
		this.emit()

		try {
			let definition: unknown
			try {
				definition = JSON.parse(capturedText)
			}
			catch (error) {
				this.parseErrorValue = toParseError(capturedText, error)
				return { status: 'parse-error', error: this.parseErrorValue }
			}

			this.parseErrorValue = null
			const oldRuntime = this.activeSnapshot.runtime

			if (oldRuntime !== null) {
				await this.hooks.detachPreview()
				oldRuntime.dispose()
			}

			// Compilation happens only after the teardown boundary above: the locked ordering is detach
			// -> dispose -> compile/commit -> create Runtime -> mount, never compile-then-teardown.
			const blueprint = this.system.createBlueprint(definition)
			const runtime = blueprint.status === 'valid' ? blueprint.createRuntime() : null
			this.activeSnapshot = {
				sourceText: capturedText,
				definition,
				blueprint,
				runtime,
			}

			if (runtime !== null)
				await this.hooks.mountPreview()

			return { status: 'applied', blueprintStatus: blueprint.status }
		}
		finally {
			this.applying = false
			this.emit()
		}
	}

	/**
	 * Presets are source text through the same Apply pipeline: no bypass of `JSON.parse` or
	 * Blueprint creation.
	 */
	async applyPreset(sourceText: string): Promise<ApplyOutcome> {
		this.setDraftSourceText(sourceText)
		return this.apply()
	}

	private emit(): void {
		for (const listener of this.listeners) listener()
	}
}
