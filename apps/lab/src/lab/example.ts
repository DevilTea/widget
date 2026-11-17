/**
 * What the header's Examples menu says the current document is: the last loaded preset while the document
 * still is exactly that preset's source, otherwise "edited". Pure presentation logic over state the Lab
 * store already has; it never decides what is applied.
 */

export interface ExamplePresetRef {
	readonly id: string
	readonly sourceText: string
}

export type ExampleState<Preset extends ExamplePresetRef = ExamplePresetRef>
	= | { readonly kind: 'preset', readonly preset: Preset }
		| { readonly kind: 'edited' }

export interface ExampleStateInput<Preset extends ExamplePresetRef> {
	/** The preset the document was last started from: a showcase's default on entry, or the last loaded preset. */
	readonly loadedPresetId: string | null
	readonly presets: readonly Preset[]
	/** The applied source text (`LabDocumentState.sourceText`). */
	readonly appliedSourceText: string
	/** Whether the editor holds an unapplied draft. An unapplied edit is already "edited". */
	readonly isDirty: boolean
}

export function deriveExampleState<Preset extends ExamplePresetRef>(input: ExampleStateInput<Preset>): ExampleState<Preset> {
	const preset = input.loadedPresetId === null ? undefined : input.presets.find(candidate => candidate.id === input.loadedPresetId)
	if (preset !== undefined && !input.isDirty && input.appliedSourceText === preset.sourceText)
		return { kind: 'preset', preset }
	return { kind: 'edited' }
}
