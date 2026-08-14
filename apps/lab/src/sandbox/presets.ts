/**
 * Sandbox preset source texts.
 *
 * Each preset is plain JSON source text that goes through the exact same Apply pipeline as manual
 * editing (`LabSession.applyPreset`) — no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`.
 * They exist to demonstrate the Lab shell, not as a reusable widget-document fixture format.
 */

export interface SandboxPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

const validInteractiveSource = `{
  "id": "root",
  "type": "Stack",
  "slots": {
    "items": [
      { "id": "title", "type": "Text", "config": { "text": "Widget Lab sandbox" } },
      { "id": "counter-1", "type": "Counter" },
      { "id": "summary-1", "type": "Summary", "config": { "counterId": "counter-1" } },
      {
        "id": "section-1",
        "type": "Section",
        "config": { "title": "Details" },
        "slots": {
          "body": [
            {
              "id": "note",
              "type": "Text",
              "config": { "text": "Increment the counter — Summary and Blueprint/Runtime update live." }
            }
          ]
        }
      }
    ]
  }
}
`

const invalidSemanticSource = `{
  "id": "root",
  "type": "Stack",
  "slots": {
    "items": [
      { "id": "counter-1", "type": "Counter" },
      { "id": "summary-1", "type": "Summary", "config": { "counterId": "does-not-exist" } }
    ]
  }
}
`

const rawSlotRecoverySource = `{
  "id": "root",
  "type": "Stack",
  "slots": {
    "items": [
      { "id": "leaf-1", "type": "Text", "config": { "text": "A known, resolved child." } },
      { "id": "mystery-1", "type": "MysteryWidget" }
    ],
    "sidebar": [
      { "id": "orphan-1", "type": "Text", "config": { "text": "Placed under an undeclared slot key (\\"sidebar\\") — recovered as a raw-slot child, not a semantic one." } }
    ]
  }
}
`

export const sandboxPresets: readonly SandboxPreset[] = [
	{
		id: 'valid-interactive',
		label: 'Valid — interactive',
		description: 'A fully valid Blueprint: state, a self-dependent Property, Methods, slots, and a cross-widget dependency (Summary -> Counter).',
		sourceText: validInteractiveSource,
	},
	{
		id: 'invalid-semantic',
		label: 'Invalid — semantic',
		description: 'Summary’s `counterId` names no widget, so its dependency is `invalid` and the Blueprint is invalid; every node still resolves.',
		sourceText: invalidSemanticSource,
	},
	{
		id: 'raw-slot-recovery',
		label: 'Recovery — raw-slot & unresolved',
		description: 'An unresolved child (unknown plugin type) and a raw-slot child (placed under an undeclared slot key), for demonstrating Blueprint recovery.',
		sourceText: rawSlotRecoverySource,
	},
]

export const defaultSandboxPreset: SandboxPreset = sandboxPresets[0]!
