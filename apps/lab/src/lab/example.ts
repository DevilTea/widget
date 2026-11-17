/**
 * What the header's Examples menu says the current document is: the last loaded preset while the document
 * still is exactly that preset's source (or whichever preset of the showcase it exactly equals), otherwise "edited". Pure presentation logic over state the Lab
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
	if (input.isDirty)
		return { kind: 'edited' }
	const loaded = input.loadedPresetId === null ? undefined : input.presets.find(candidate => candidate.id === input.loadedPresetId)
	// The loaded preset wins; otherwise any preset of the showcase the source is exactly equal to (Undo back
	// to the default after loading another preset names the default again instead of saying "edited").
	const preset = loaded !== undefined && input.appliedSourceText === loaded.sourceText
		? loaded
		: input.presets.find(candidate => candidate.sourceText === input.appliedSourceText)
	return preset === undefined ? { kind: 'edited' } : { kind: 'preset', preset }
}
