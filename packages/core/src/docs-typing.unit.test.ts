/**
 * Type-level conformance of the docs written in the builder (Discussion #12, "Descriptions live in the plugin
 * builder; JSON Schema is inferred from the types (0.4.0)", points 2-11): field docs are required-complete for
 * every declared type, `ref` must match the field's type, `defineFieldDocs` is exact, `undocumented` type-checks
 * wherever docs are required, `WidgetRef` holds any string and keeps its plugin types, and a generic factory can
 * carry docs typed over its generic `Raw` to a concrete call site.
 *
 * The negative cases are `@ts-expect-error`s inside never-invoked functions or never-read constants; most were
 * first probed outside the repository (the `neg/n1`-`n11` cases of the 0.4 design probe).
 */

import type {
	FieldDoc,
	FieldDocs,
	JsonValue,
	ShapeDocs,
	TypeDocs,
	WidgetChild,
	WidgetInterfaces,
	WidgetPlugin,
	WidgetPluginConfigPhase,
	WidgetRawConfigOf,
	WidgetRef,
	WidgetRefTypesOf,
} from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, defineFieldDocs, defineTypeDocs, undocumented } from './index'

// -------------------------------------------------------------------------------------------------
// Shapes (modelled on a real consumer's survey widgets)
// -------------------------------------------------------------------------------------------------

type LocalizedText = Readonly<Record<string, string>>

type Condition
	= | { readonly op: 'all', readonly conditions: readonly Condition[] }
		| { readonly op: 'any', readonly conditions: readonly Condition[] }
		| { readonly op: 'not', readonly condition?: Condition }
		| { readonly op: 'test', readonly target?: WidgetRef<'Question' | 'Page'>, readonly operator?: string, readonly operand?: JsonValue }

interface CustomErrorRule {
	readonly when: Condition
	readonly message: LocalizedText
}

interface TextRawConfig {
	readonly maxLength?: number
	readonly placeholder?: LocalizedText
}

interface ShortAnswerRawConfig extends TextRawConfig {
	readonly format?: 'text' | 'email'
}

interface QuestionRawConfig {
	readonly required?: boolean | Condition
	readonly visibleWhen?: Condition
	readonly customErrors?: readonly CustomErrorRule[]
}

type ChoiceOption = { readonly id: string } & (
	| { readonly label: LocalizedText, readonly other?: undefined }
	| { readonly other: true, readonly label?: LocalizedText | null }
)

interface ChoiceRawConfig {
	readonly options: readonly ChoiceOption[]
}

interface ThemeMode {
	readonly primaryColor: string
	readonly background: { readonly image: string | null, readonly opacity: number }
}

interface StyleRawConfig {
	readonly theme?: { readonly light: ThemeMode, readonly dark: ThemeMode }
	readonly papers: Readonly<Record<string, { readonly name: string, readonly weight: number }>>
}

const conditionDocs: TypeDocs<Condition> = defineTypeDocs<Condition>('Condition', {
	description: 'A display or required rule.',
	fields: {
		op: { description: 'The node kind.' },
		conditions: { description: 'The members of an all or any.', items: { ref: () => conditionDocs } },
		condition: { description: 'The negated rule.', ref: () => conditionDocs },
		target: { description: 'The widget tested.' },
		operator: { description: 'The operator id.' },
		operand: { description: 'The operand, when the operator takes one.' },
	},
})

const customErrorRuleDocs = defineTypeDocs<CustomErrorRule>('CustomErrorRule', {
	description: 'One custom error rule.',
	fields: {
		when: { description: 'When the answer is refused.', ref: conditionDocs },
		message: { description: 'What the respondent is told, per language.' },
	},
})

const themeModeDocs = defineTypeDocs<ThemeMode>('ThemeMode', {
	description: 'One theme mode.',
	fields: {
		primaryColor: { description: 'The primary color, `#RRGGBB`.' },
		background: { description: 'The background image.', fields: { image: { description: 'Its address.' }, opacity: { description: 'Percent.' } } },
	},
})

const textFieldDocs = defineFieldDocs<TextRawConfig>()({
	fields: {
		maxLength: { description: 'The longest answer.' },
		placeholder: { description: 'The hint, per language.' },
	},
})

// -------------------------------------------------------------------------------------------------
// FieldDocs
// -------------------------------------------------------------------------------------------------

describe('field docs are required-complete', () => {
	it('accepts complete docs for every shape: optional keys, arrays, records, unions and recursion', () => {
		const shortAnswer: FieldDocs<ShortAnswerRawConfig> = { fields: { ...textFieldDocs.fields, format: { description: 'The input format.' } } }
		const question = defineFieldDocs<QuestionRawConfig>()({
			fields: {
				required: { description: 'Required, fixed or on a condition.', ref: conditionDocs },
				visibleWhen: { description: 'Shown while it holds.', ref: conditionDocs },
				customErrors: { description: 'The rules, in order.', items: { ref: customErrorRuleDocs } },
			},
		})
		const choice = defineFieldDocs<ChoiceRawConfig>()({
			fields: {
				options: {
					description: 'The options, in order.',
					items: { fields: { id: { description: 'Its id.' }, label: { description: 'Its label.' }, other: { description: 'Whether it takes free text.' } } },
				},
			},
		})
		const style = defineFieldDocs<StyleRawConfig>()({
			fields: {
				theme: { description: 'The theme.', fields: { light: { description: 'Light.', ref: themeModeDocs }, dark: { description: 'Dark.', ref: themeModeDocs } } },
				papers: { description: 'The papers, by id.', values: { fields: { name: { description: 'Its name.' }, weight: { description: 'Grams.' } } } },
			},
		})

		expect([shortAnswer, question, choice, style])
			.toHaveLength(4)
	})

	it('needs nothing beyond the description for primitives, literal unions, primitive arrays, open records and JSON', () => {
		expectTypeOf<ShapeDocs<string>>()
			.toEqualTypeOf<unknown>()
		expectTypeOf<ShapeDocs<'a' | 'b' | null>>()
			.toEqualTypeOf<unknown>()
		expectTypeOf<ShapeDocs<WidgetRef<'Rating'>>>()
			.toEqualTypeOf<unknown>()
		const leaves: readonly unknown[] = [
			{ description: 'A list.' } satisfies FieldDoc<readonly string[]>,
			{ description: 'Text by language.' } satisfies FieldDoc<LocalizedText>,
			{ description: 'Any JSON.' } satisfies FieldDoc<JsonValue>,
			{ description: 'Anything.' } satisfies FieldDoc<unknown>,
			{ description: 'A list.', items: { description: 'One tag.' } } satisfies FieldDoc<readonly string[]>,
		]
		expect(leaves)
			.toHaveLength(5)
	})

	it('rejects missing, misspelt and stale keys, wrong refs and half-written docs', () => {
		const typeOnly = () => {
			// N1: a field of the extended interface is missing.
			// @ts-expect-error 'format' is missing
			const n1: FieldDocs<ShortAnswerRawConfig> = { fields: { ...textFieldDocs.fields } }
			// N3: a key of one union member only is missing in the items.
			// @ts-expect-error 'other' is missing
			const n3: FieldDocs<ChoiceRawConfig> = { fields: { options: { description: 'o', items: { fields: { id: { description: 'i' }, label: { description: 'l' } } } } } }
			// N4: the Condition part of `boolean | Condition` is undocumented.
			// @ts-expect-error 'fields' (or a ref) is missing
			const n4: FieldDocs<QuestionRawConfig> = { fields: { required: { description: 'r' }, visibleWhen: { description: 'v', ref: conditionDocs }, customErrors: { description: 'c', items: { ref: customErrorRuleDocs } } } }
			// N5: a misspelt key.
			// @ts-expect-error 'maxLenght' is not a field
			const n5: FieldDocs<TextRawConfig> = { fields: { maxLength: { description: 'm' }, placeholder: { description: 'p' }, maxLenght: { description: 'typo' } } }
			// N6: a stale key reaching the docs through a variable is caught by defineFieldDocs.
			const stale = { fields: { maxLength: { description: 'm' }, placeholder: { description: 'p' }, minLength: { description: 'removed' } } }
			// @ts-expect-error 'minLength' is not a field
			const n6 = defineFieldDocs<TextRawConfig>()(stale)
			// N7: a ref to the docs of another type.
			// @ts-expect-error CustomErrorRule docs for a Condition field
			const n7: FieldDocs<QuestionRawConfig> = { fields: { required: { description: 'r', ref: conditionDocs }, visibleWhen: { description: 'v', ref: customErrorRuleDocs }, customErrors: { description: 'c', items: { ref: customErrorRuleDocs } } } }
			// N8: deep in a nested object, one mode has no docs.
			// @ts-expect-error 'dark' has no ref or fields
			const n8: FieldDocs<StyleRawConfig> = { fields: { theme: { description: 't', fields: { light: { description: 'l', ref: themeModeDocs }, dark: { description: 'd' } } }, papers: { description: 'p', values: { fields: { name: { description: 'n' }, weight: { description: 'w' } } } } } }
			// N9: the recursive docs leave out a key of one union member.
			// @ts-expect-error 'operand' is missing
			const n9: TypeDocs<Condition> = defineTypeDocs<Condition>('Condition', { description: 'd', fields: { op: { description: 'o' }, conditions: { description: 'c', items: { ref: () => n9 } }, condition: { description: 'c', ref: () => n9 }, target: { description: 't' }, operator: { description: 'o' } } })
			// N11: a misspelt key inside an item, and a field with both `ref` and inline docs.
			// @ts-expect-error 'mesage' is not a field
			const n11: FieldDocs<QuestionRawConfig> = { fields: { required: { description: 'r', ref: conditionDocs }, visibleWhen: { description: 'v', ref: conditionDocs }, customErrors: { description: 'c', items: { fields: { when: { description: 'w', ref: conditionDocs }, message: { description: 'm' }, mesage: { description: 'typo' } } } } } }
			// @ts-expect-error `ref` and `fields` exclude each other
			const both: FieldDoc<CustomErrorRule> = { description: 'c', ref: customErrorRuleDocs, fields: { when: { description: 'w', ref: conditionDocs }, message: { description: 'm' } } }
			// An array of closed objects needs `items`; a record of closed objects needs `values`.
			// @ts-expect-error 'items' is missing
			const items: FieldDoc<readonly CustomErrorRule[]> = { description: 'c' }
			// @ts-expect-error 'values' is missing
			const values: FieldDoc<StyleRawConfig['papers']> = { description: 'p' }
			// A field description is required (only `items`, `values`, `raw`, `resolved` and `details` may leave it out).
			// @ts-expect-error 'description' is missing
			const noDescription: FieldDoc<string> = {}
			return [n1, n3, n4, n5, n6, n7, n8, n9, n11, both, items, values, noDescription]
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('accepts `undocumented` for a whole docs value, and as a description that waives the nested docs', () => {
		const whole: FieldDocs<StyleRawConfig> = undocumented
		const fields: FieldDocs<StyleRawConfig> = { fields: { theme: undocumented, papers: { description: undocumented } } }
		const waived: FieldDoc<readonly CustomErrorRule[]> = { description: undocumented }
		const typeOnly = () => {
			// @ts-expect-error nested docs that are given are still checked
			const checked: FieldDoc<CustomErrorRule> = { description: undocumented, fields: { when: undocumented, mesage: undocumented } }
			return checked
		}

		expect([whole, fields, waived, typeOnly])
			.toHaveLength(4)
	})
})

// -------------------------------------------------------------------------------------------------
// WidgetRef
// -------------------------------------------------------------------------------------------------

describe('widgetRef', () => {
	interface Raw {
		readonly followUp?: WidgetRef<'Rating'>
		readonly ids: readonly WidgetRef<'Note'>[]
	}

	it('accepts any string without a cast, reads back as a string and keeps its plugin types', () => {
		const id: string = 'q1'
		const raw: Raw = { followUp: id, ids: ['a', id] }
		const followUp: string | undefined = raw.followUp

		expectTypeOf<WidgetRefTypesOf<WidgetRef<'Rating' | 'Choice'>>>()
			.toEqualTypeOf<'Rating' | 'Choice'>()
		expectTypeOf<WidgetRefTypesOf<NonNullable<Raw['followUp']>>>()
			.toEqualTypeOf<'Rating'>()
		expectTypeOf<WidgetRefTypesOf<string>>()
			.toEqualTypeOf<never>()
		expect(followUp?.toUpperCase())
			.toBe('Q1')
	})

	it('is an authored JSON value in a raw config', () => {
		const plugin = createWidgetPlugin('ref-holder')
			.description(undocumented)
			.interfaces<{ config: { raw: Raw, resolved: Raw } }>()
			.config({ description: undocumented, validate: (input): input is Raw => typeof input === 'object', resolve: raw => raw ?? { ids: [] } })
			.done()

		expect(plugin.capabilities.config)
			.toBe(true)
	})
})

// -------------------------------------------------------------------------------------------------
// Member docs in the builder
// -------------------------------------------------------------------------------------------------

describe('member docs in the builder', () => {
	interface Interfaces {
		config: { raw: TextRawConfig | null, resolved: { maxLength: number } }
		slots: { body: WidgetChild }
		state: { position: { readonly x: number, readonly y: number } }
		properties: { label: string }
		methods: { move: (x: number, options?: { readonly animate: boolean }) => { readonly moved: boolean }, reset: () => void }
		events: { moved: [x: number, y: number], cleared: [] }
		reasons: { 'off-grid': { readonly x: number }, 'empty': void }
	}

	const validate = (input: unknown): input is never => input === undefined

	it('accepts complete docs', () => {
		const plugin = createWidgetPlugin('complete')
			.description('Moves a point.')
			.interfaces<Interfaces>()
			.config({ description: 'Limits.', raw: textFieldDocs, resolved: { fields: { maxLength: { description: 'Resolved limit.' } } }, validate, resolve: () => ({ maxLength: 1 }) })
			.slots({ body: { description: 'The body.' } })
			.state(state => state.position({ description: 'Where it is.', fields: { x: { description: 'x' }, y: { description: 'y' } }, validate }))
			.properties(properties => properties.label({ description: 'A label.', compute: () => '' }))
			.methods(methods => methods
				.move({
					description: 'Moves it.',
					params: [{ description: 'The target x.' }, { description: 'How.', fields: { animate: { description: 'Whether to animate.' } } }],
					returns: { description: 'The outcome.', fields: { moved: { description: 'Whether it moved.' } } },
					validateArgs: validate,
					execute: () => ({ moved: true }),
				})
				.reset({ description: 'Resets it.', validateArgs: validate, execute: () => {} }))
			.events({ moved: { description: 'It moved.', payload: [{ description: 'x' }, { description: 'y' }] }, cleared: { description: 'It was cleared.' } })
			.reasons({ 'off-grid': { description: 'Off the grid.', details: { fields: { x: { description: 'x' } } } }, 'empty': { description: 'Empty.' } })
			.done()

		expectTypeOf(plugin)
			.toEqualTypeOf<WidgetPlugin<'complete', Interfaces>>()
	})

	it('accepts `undocumented` everywhere, waiving nested docs', () => {
		const plugin = createWidgetPlugin('undocumented')
			.description(undocumented)
			.interfaces<Interfaces>()
			.config({ description: undocumented, validate, resolve: () => ({ maxLength: 1 }) })
			.slots({ body: { description: undocumented } })
			.state(state => state.position({ description: undocumented, validate }))
			.properties(properties => properties.label({ description: undocumented, compute: () => '' }))
			.methods(methods => methods
				.move({ description: undocumented, validateArgs: validate, execute: () => ({ moved: true }) })
				.reset({ description: undocumented, validateArgs: validate, execute: () => {} }))
			.events({ moved: undocumented, cleared: undocumented })
			.reasons({ 'off-grid': undocumented, 'empty': undocumented })
			.done()

		expect(plugin.docs.description)
			.toBeNull()
	})

	it('rejects incomplete or misplaced member docs', () => {
		const typeOnly = () => {
			const builder = createWidgetPlugin('incomplete')
				.description('d')
				.interfaces<Interfaces>()
			// @ts-expect-error a documented config needs `raw` and `resolved`
			builder.config({ description: 'Limits.', validate, resolve: () => ({ maxLength: 1 }) })
			const afterConfig = builder.config({ description: undocumented, validate, resolve: () => ({ maxLength: 1 }) })
			// @ts-expect-error a slot needs a description
			afterConfig.slots({ body: {} })
			const afterSlots = afterConfig.slots({ body: { description: undocumented } })
			// @ts-expect-error a documented object-valued State needs `fields`
			afterSlots.state(state => state.position({ description: 'Where.', validate }))
			const afterState = afterSlots.state(state => state.position({ description: undocumented, validate }))
			// @ts-expect-error a description is required
			afterState.properties(properties => properties.label({ compute: () => '' }))
			const afterProperties = afterState.properties(properties => properties.label({ description: undocumented, compute: () => '' }))
			afterProperties.methods(methods => methods
				// @ts-expect-error a documented Method with parameters needs `params`, and one that returns a value `returns`
				.move({ description: 'Moves.', validateArgs: validate, execute: () => ({ moved: true }) })
				.reset({ description: 'Resets.', validateArgs: validate, execute: () => {} }))
			afterProperties.methods(methods => methods
				// @ts-expect-error the optional second parameter needs its entry too
				.move({ description: 'Moves.', params: [{ description: 'x' }], returns: { description: 'r', fields: { moved: { description: 'm' } } }, validateArgs: validate, execute: () => ({ moved: true }) })
				.reset({ description: 'Resets.', validateArgs: validate, execute: () => {} }))
			afterProperties.methods(methods => methods
				.move({ description: undocumented, validateArgs: validate, execute: () => ({ moved: true }) })
				// @ts-expect-error a `void` Method has no `returns`
				.reset({ description: 'Resets.', returns: { description: 'Nothing.' }, validateArgs: validate, execute: () => {} }))
			const afterMethods = afterProperties.methods(methods => methods
				.move({ description: undocumented, validateArgs: validate, execute: () => ({ moved: true }) })
				.reset({ description: undocumented, validateArgs: validate, execute: () => {} }))
			// @ts-expect-error a documented Event with a payload needs `payload`
			afterMethods.events({ moved: { description: 'Moved.' }, cleared: undocumented })
			const afterEvents = afterMethods.events({ moved: undocumented, cleared: undocumented })
			// @ts-expect-error a documented reason with a payload needs `details`
			afterEvents.reasons({ 'off-grid': { description: 'Off.' }, 'empty': undocumented })
			// @ts-expect-error a `void` reason takes no `details`
			afterEvents.reasons({ 'off-grid': undocumented, 'empty': { description: 'Empty.', details: {} } })
			// @ts-expect-error every declared reason needs an entry
			afterEvents.reasons({ 'off-grid': undocumented })
			// @ts-expect-error `.reasons()` is required when reasons are declared
			afterEvents.done()
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('starts with `.description()`: `.interfaces()` first is an order error', () => {
		const typeOnly = () => {
			const start = createWidgetPlugin('early')
			// @ts-expect-error '.interfaces()' is called too early; call '.description()' first
			start.interfaces<Interfaces>()
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})
})

// -------------------------------------------------------------------------------------------------
// Edge cases
// -------------------------------------------------------------------------------------------------

describe('edge cases', () => {
	it('documents an omittable config (`raw | null`) as its object type', () => {
		interface NoteInterfaces { config: { raw: { readonly text?: string } | null, resolved: { readonly text: string } } }
		const plugin = createWidgetPlugin('note')
			.description('A note.')
			.interfaces<NoteInterfaces>()
			.config({
				description: 'Its text.',
				raw: { fields: { text: { description: 'The text.' } } },
				resolved: { fields: { text: { description: 'The text, empty when omitted.' } } },
				validate: (input): input is { readonly text?: string } | null => input === null || typeof input === 'object',
				resolve: raw => ({ text: raw?.text ?? '' }),
			})
			.done()

		expect(plugin.docs.config?.raw)
			.toEqual({ fields: { text: { description: 'The text.' } } })
	})

	it('completes explicitly empty sections with empty docs', () => {
		const plugin = createWidgetPlugin('empty')
			.description('Empty.')
			.interfaces<{ slots: never, state: Record<never, never>, events: Record<never, never>, reasons: Record<never, never> }>()
			.slots({})
			.state(state => state)
			.events({})
			.reasons({})
			.done()

		expect(plugin.docs.slots)
			.toEqual({})
	})

	it('supports a generic factory: docs typed over a generic `Raw`, required complete at a concrete call site', () => {
		interface ControlInterfaces<Raw extends object, Resolved extends object> extends WidgetInterfaces {
			config: { raw: Raw | null, resolved: Resolved }
			properties: { visible: boolean }
		}
		interface ControlSpec<Type extends string, Raw extends object, Resolved extends object> {
			readonly type: Type
			readonly description: string
			readonly config: { readonly description: string, readonly raw: FieldDocs<Raw>, readonly resolved: FieldDocs<Resolved> }
			readonly resolve: (raw: Raw | null) => Resolved
		}
		function createControlPlugin<const Type extends string, Raw extends object, Resolved extends object>(spec: ControlSpec<Type, Raw, Resolved>) {
			type I = ControlInterfaces<Raw, Resolved>
			// The cast a consumer already needs for a generic interfaces type (`.interfaces<Generic>()` is deferred);
			// the docs add none: `FieldDocs<Raw>` is accepted where the phase wants the docs of `Raw | null`.
			const phase = createWidgetPlugin(spec.type)
				.description(spec.description)
				.interfaces<I>() as unknown as WidgetPluginConfigPhase<Type, I>
			return phase
				.config({
					description: spec.config.description,
					raw: spec.config.raw,
					resolved: spec.config.resolved,
					validate: (input): input is Raw | null => input === null || typeof input === 'object',
					resolve: spec.resolve,
				})
				.properties(properties => properties.visible({ description: 'Whether the control is shown.', compute: () => true }))
				.done()
		}
		expectTypeOf<WidgetRawConfigOf<ControlInterfaces<ShortAnswerRawConfig, object>>>()
			.toEqualTypeOf<ShortAnswerRawConfig | null>()

		const shortAnswer = createControlPlugin({
			type: 'short-answer',
			description: 'A one-line answer.',
			config: {
				description: 'How the field is shown.',
				raw: { fields: { ...textFieldDocs.fields, format: { description: 'The input format; text when omitted.' } } } satisfies FieldDocs<ShortAnswerRawConfig>,
				resolved: { fields: { maxLength: { description: 'The limit.' } } },
			},
			resolve: (raw: ShortAnswerRawConfig | null) => ({ maxLength: raw?.maxLength ?? 100 }),
		})
		const typeOnly = () => createControlPlugin({
			type: 'short-answer',
			description: 'A one-line answer.',
			config: {
				description: 'How the field is shown.',
				// @ts-expect-error the concrete call site must document `format` as well
				raw: { fields: { ...textFieldDocs.fields } } as const satisfies FieldDocs<TextRawConfig>,
				resolved: { fields: { maxLength: { description: 'The limit.' } } },
			},
			resolve: (raw: ShortAnswerRawConfig | null) => ({ maxLength: raw?.maxLength ?? 100 }),
		})

		expect(shortAnswer.docs.config?.raw)
			.toEqual({ fields: { maxLength: { description: 'The longest answer.' }, placeholder: { description: 'The hint, per language.' }, format: { description: 'The input format; text when omitted.' } } })
		expect(typeOnly)
			.toBeTypeOf('function')
	})
})
