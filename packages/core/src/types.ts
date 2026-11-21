/**
 * Core identity, capability and member-key domain types.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 (consolidated handoff §2, amendments
 * "WidgetMemberKey domain" and "builder completion typestate and finite member-key universe").
 */

import type { JsonDomainViolation } from './json'

export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from './json'

/**
 * Persisted/domain widget identity. Compiler-internal node identity is private and never public.
 */
export type WidgetId = string

/**
 * Semantic member key domain for state / properties / methods / slots.
 *
 * Locked to `string`: numeric keys, symbol keys and broad string index signatures are unsupported.
 */
export type WidgetMemberKey = string

/**
 * Plugin capability declaration. Every section is optional and every present section is a capability
 * that must be implemented completely by the plugin builder.
 */
export interface WidgetInterfaces {
	config?: {
		/**
		 * The authored config values the plugin accepts. `config.validate` always runs, and an omitted
		 * config is validated as `null`, so include `null` (e.g. `raw: MyConfig | null`) when config may be
		 * omitted; leave it out to make config required.
		 */
		raw: Record<any, any> | null
		resolved: Record<any, any>
	}

	/**
	 * The slots, keyed by name. Each value is what the plugin expects of the slot's children: a union of
	 * plugin `type` literals, a {@link WidgetContract}, or {@link WidgetChild} (any widget). The expectation is
	 * type-level only: Core checks nothing at run time, and a plugin that declares one enforces it in
	 * `validateStructure`. `slots: never` is the explicit-empty spelling.
	 */
	slots?: Record<any, WidgetSlotExpectation>
	state?: Record<any, any>
	properties?: Record<any, any>
	methods?: Record<any, (...args: any[]) => any>
	events?: Record<any, readonly any[]>
	/**
	 * The diagnostic reasons the plugin reports, keyed by reason. Each value is the type of the `details`
	 * a diagnostic with that reason carries (`void` when it carries none); a payload must be a JSON value.
	 * Not a capability: it has no builder phase and no entry in `plugin.capabilities`.
	 */
	reasons?: Record<any, any>
}

declare const widgetContractShape: unique symbol

/** The members a {@link WidgetContract} expects of a widget. Every section is optional. */
export interface WidgetContractShape {
	state?: Record<any, any>
	properties?: Record<any, any>
	methods?: Record<any, (...args: any[]) => any>
	events?: Record<any, readonly any[]>
}

/**
 * A structural, type-only expectation of a slot's children: the State, Properties, Methods and Events a
 * child is expected to have. It has no runtime form (no value of this type exists), and Core never checks
 * it. The brand is required, so an ordinary object type is not mistaken for a contract.
 */
export interface WidgetContract<Shape extends WidgetContractShape = WidgetContractShape> {
	readonly [widgetContractShape]: Shape
}

/** The slot expectation that accepts any widget. */
export type WidgetChild = WidgetContract<Record<never, never>>

/** What a slot may declare about its children; see `WidgetInterfaces['slots']`. */
export type WidgetSlotExpectation = string | WidgetContract<any>

/**
 * A readonly array that is non-empty when present. Used by every optional `related` collection.
 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

type IsAny<T> = 0 extends 1 & T ? true : false

/**
 * Reads one declared capability. Returns `never` when the capability is absent.
 *
 * A capability counts as declared only when the interfaces type declares the key as a required
 * property; an optional (`undefined`-inclusive) declaration is treated as absent so that
 * `interface X extends WidgetInterfaces` does not silently claim every capability.
 */
export type WidgetCapabilityOf<
	Interfaces extends WidgetInterfaces,
	Key extends keyof WidgetInterfaces,
> = Interfaces extends Record<Key, infer Capability>
	? Capability
	: never

/**
 * `true` when the capability is declared, `false` otherwise.
 *
 * The authoritative presence predicate (diagnostic #10 amendment "declaration-presence semantics and public
 * `WidgetPlugin.capabilities`"): presence is required-key *declaration*, independent of the capability's
 * own payload type. It must never be implemented by testing whether `WidgetCapabilityOf<...>` is
 * `never` — a legitimately-present capability can itself have payload `never` (the canonical
 * explicit-empty spelling for `slots`, e.g. `slots: never`), which would otherwise be indistinguishable
 * from a capability that was never declared at all. `Interfaces extends Record<Key, unknown>` checks
 * required-property presence directly: an optional inherited declaration (`config?: X` left unnarrowed)
 * is not assignable to a shape requiring `Key`, so it correctly stays `false`.
 */
export type HasWidgetCapability<
	Interfaces extends WidgetInterfaces,
	Key extends keyof WidgetInterfaces,
> = Interfaces extends Record<Key, unknown>
	? true
	: false

/**
 * Indexes a declared member record without requiring the key to be statically provable.
 */
export type WidgetMemberValueOf<Members, Key extends WidgetMemberKey> = Key extends keyof Members
	? Members[Key]
	: never

export type WidgetRawConfigOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'config'> extends { raw: infer Raw }
	? Raw
	: never

export type WidgetResolvedConfigOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'config'> extends { resolved: infer Resolved }
	? Resolved
	: never

/** The declared slots record, or `never` when the capability is absent or explicitly empty (`slots: never`). */
export type WidgetSlotsOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'slots'>

/** The declared diagnostic reasons record, or `never` when `reasons` is not declared. */
export type WidgetReasonsOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'reasons'>

export type WidgetStateOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'state'>

export type WidgetPropertiesOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'properties'>

export type WidgetMethodsOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'methods'> extends infer Methods extends Record<WidgetMemberKey, (...args: any[]) => any>
	? Methods
	: never

export type WidgetEventsOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'events'> extends infer Events extends Record<WidgetMemberKey, readonly any[]>
	? Events
	: never

/**
 * Declared member keys of one section, or `never` when the capability is absent.
 */
export type WidgetMemberKeysOf<Members> = [Members] extends [never]
	? never
	: Extract<keyof Members, WidgetMemberKey>

/** The declared slot names: the keys of the `slots` record. */
export type WidgetSlotNameOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetSlotsOf<Interfaces>>

/** What the slot `Name` expects of its children. */
export type WidgetSlotExpectedOf<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
> = WidgetMemberValueOf<WidgetSlotsOf<Interfaces>, Name>

export type WidgetReasonKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetReasonsOf<Interfaces>>

export type WidgetStateKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetStateOf<Interfaces>>

export type WidgetPropertyKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetPropertiesOf<Interfaces>>

export type WidgetMethodKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetMethodsOf<Interfaces>>

export type WidgetEventKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetEventsOf<Interfaces>>

export type WidgetStateValueOf<
	Interfaces extends WidgetInterfaces,
	Key extends WidgetMemberKey,
> = WidgetMemberValueOf<WidgetStateOf<Interfaces>, Key>

export type WidgetPropertyValueOf<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
> = WidgetMemberValueOf<WidgetPropertiesOf<Interfaces>, Name>

export type WidgetMethodOf<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
> = Extract<WidgetMemberValueOf<WidgetMethodsOf<Interfaces>, Name>, (...args: any[]) => any>

export type WidgetMethodArgsOf<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
> = Parameters<WidgetMethodOf<Interfaces, Name>>

export type WidgetMethodReturnOf<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
> = ReturnType<WidgetMethodOf<Interfaces, Name>>

export type WidgetEventArgsOf<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
> = Extract<WidgetMemberValueOf<WidgetEventsOf<Interfaces>, Name>, readonly any[]>

type ContainsPromiseLike<Value> = IsAny<Value> extends true
	? false
	: [Extract<Value, PromiseLike<unknown>>] extends [never]
			? false
			: true

type MemberKeyDomainViolation<Section extends string, Members> = [Members] extends [never]
	? never
	: [keyof Members] extends [never]
			? never
			: [keyof Members] extends [WidgetMemberKey]
					? WidgetMemberKey extends keyof Members
						? `'${Section}' must not be declared with a broad string index signature`
						: never
					: `'${Section}' member keys must be finite string literals`

type SyncValueDomainViolation<Section extends string, Members> = [Members] extends [never]
	? never
	: true extends { [Key in keyof Members]-?: ContainsPromiseLike<Members[Key]> }[keyof Members]
		? `'${Section}' values must not be PromiseLike; the core semantic boundary is synchronous`
		: never

type SyncMethodReturnViolation<Interfaces extends WidgetInterfaces> = WidgetMethodsOf<Interfaces> extends infer Methods
	? [Methods] extends [never]
			? never
			: true extends { [Key in keyof Methods]-?: ContainsPromiseLike<ReturnType<Extract<Methods[Key], (...args: any[]) => any>>> }[keyof Methods]
				? `'methods' return types must not be PromiseLike; the core semantic boundary is synchronous`
				: never
	: never

type EventArgsDomainViolation<Interfaces extends WidgetInterfaces> = WidgetEventsOf<Interfaces> extends infer Events
	? [Events] extends [never]
			? never
			: {
					[Key in keyof Events]-?: Events[Key] extends readonly any[]
						? number extends Events[Key]['length']
							? '\'events\' arguments must be declared as tuples'
							: never
						: '\'events\' arguments must be declared as tuples'
				}[keyof Events]
	: never

type IsUnion<T, Whole = T> = [T] extends [never]
	? false
	: T extends unknown
		? [Whole] extends [T] ? false : true
		: never

/**
 * Whether some member of a string union is not a literal (a broad `string` or a template pattern):
 * `{} extends Record<Member, 1>` holds only for a member that has no literal key to require.
 */
type HasNonLiteralMember<Members extends string> = true extends (Members extends unknown ? (Record<never, never> extends Record<Members, 1> ? true : false) : never)
	? true
	: false

type SlotExpectationKindViolation = '\'slots\' values must be a finite union of plugin type literals, a WidgetContract or WidgetChild'

type SlotExpectationContractViolation = '\'slots\' values must name one WidgetContract with a declared shape, not a union of contracts or WidgetContract<any>'

/**
 * Why one slot's expectation is unsupported, or `never`. An expectation is either a finite union of plugin
 * `type` literals or exactly one `WidgetContract` (`WidgetChild` included):
 *
 * - `any`, a broad `string`, a pattern such as `\`x-${string}\`` (it names no registrable plugin type), and a
 *   mix of plugin types and a contract are not an expectation;
 * - a union of contracts, or a contract whose shape is `any`, has no single shape to type the reads of
 *   `slot(name)` by.
 */
type SlotExpectationViolation<Expected> = IsAny<Expected> extends true
	? SlotExpectationKindViolation
	: [Expected] extends [string]
			? HasNonLiteralMember<Extract<Expected, string>> extends true ? SlotExpectationKindViolation : never
			: [Extract<Expected, string>] extends [never]
					? IsUnion<Expected> extends true
						? SlotExpectationContractViolation
						: Expected extends WidgetContract<infer Shape>
							? IsAny<Shape> extends true ? SlotExpectationContractViolation : never
							: SlotExpectationKindViolation
					: SlotExpectationKindViolation

/** Slot names are checked like every other member key; this checks each slot's expectation. */
type SlotDomainViolation<Interfaces extends WidgetInterfaces> = WidgetSlotsOf<Interfaces> extends infer Slots
	? [Slots] extends [never]
			? never
			: { [Name in keyof Slots]-?: SlotExpectationViolation<Slots[Name]> }[keyof Slots]
	: never

type ReasonsDomainViolation<Interfaces extends WidgetInterfaces> = WidgetReasonsOf<Interfaces> extends infer Reasons
	? [Reasons] extends [never]
			? never
			: {
					[Reason in keyof Reasons]-?: IsAny<Reasons[Reason]> extends true
						? '\'reasons\' payloads cannot be any'
						: [Reasons[Reason]] extends [void]
								? never
								: [JsonDomainViolation<Reasons[Reason]>] extends [never] ? never : '\'reasons\' payloads must be JSON values (or void for none)'
				}[keyof Reasons]
	: never

type RawConfigDomainViolation<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'config'> extends true
	? JsonDomainViolation<WidgetRawConfigOf<Interfaces>>
	: never

/**
 * Every reason the supplied `WidgetInterfaces` cannot back a plugin builder, or `never` when valid.
 *
 * Rejection happens at the `.interfaces()` boundary so that a section can never start with an
 * unfinishable `Remaining` such as `string`.
 */
export type WidgetInterfacesViolationOf<Interfaces extends WidgetInterfaces>
	= | MemberKeyDomainViolation<'state', WidgetStateOf<Interfaces>>
		| MemberKeyDomainViolation<'properties', WidgetPropertiesOf<Interfaces>>
		| MemberKeyDomainViolation<'methods', WidgetMethodsOf<Interfaces>>
		| MemberKeyDomainViolation<'events', WidgetEventsOf<Interfaces>>
		| EventArgsDomainViolation<Interfaces>
		| MemberKeyDomainViolation<'slots', WidgetSlotsOf<Interfaces>>
		| SlotDomainViolation<Interfaces>
		| MemberKeyDomainViolation<'reasons', WidgetReasonsOf<Interfaces>>
		| ReasonsDomainViolation<Interfaces>
		| RawConfigDomainViolation<Interfaces>
		| SyncValueDomainViolation<'state', WidgetStateOf<Interfaces>>
		| SyncValueDomainViolation<'properties', WidgetPropertiesOf<Interfaces>>
		| SyncMethodReturnViolation<Interfaces>
