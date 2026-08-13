/**
 * Core identity, capability and member-key domain types.
 *
 * Normative source: issue #10 (consolidated handoff §2, amendments
 * "WidgetMemberKey domain" and "builder completion typestate and finite member-key universe").
 */

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
		raw: Record<any, any>
		resolved: Record<any, any>
	}

	slots?: string
	state?: Record<any, any>
	properties?: Record<any, any>
	methods?: Record<any, (...args: any[]) => any>
}

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
 */
export type HasWidgetCapability<
	Interfaces extends WidgetInterfaces,
	Key extends keyof WidgetInterfaces,
> = [WidgetCapabilityOf<Interfaces, Key>] extends [never]
	? false
	: true

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

export type WidgetSlotNameOf<Interfaces extends WidgetInterfaces> = Extract<WidgetCapabilityOf<Interfaces, 'slots'>, WidgetMemberKey>

export type WidgetStateOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'state'>

export type WidgetPropertiesOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'properties'>

export type WidgetMethodsOf<Interfaces extends WidgetInterfaces> = WidgetCapabilityOf<Interfaces, 'methods'> extends infer Methods extends Record<WidgetMemberKey, (...args: any[]) => any>
	? Methods
	: never

/**
 * Declared member keys of one section, or `never` when the capability is absent.
 */
export type WidgetMemberKeysOf<Members> = [Members] extends [never]
	? never
	: Extract<keyof Members, WidgetMemberKey>

export type WidgetStateKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetStateOf<Interfaces>>

export type WidgetPropertyKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetPropertiesOf<Interfaces>>

export type WidgetMethodKeyOf<Interfaces extends WidgetInterfaces> = WidgetMemberKeysOf<WidgetMethodsOf<Interfaces>>

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

type SlotDomainViolation<Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'slots'>] extends [never]
	? never
	: WidgetMemberKey extends WidgetCapabilityOf<Interfaces, 'slots'>
		? `'slots' must be a finite union of string literals`
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
		| SlotDomainViolation<Interfaces>
		| SyncValueDomainViolation<'state', WidgetStateOf<Interfaces>>
		| SyncValueDomainViolation<'properties', WidgetPropertiesOf<Interfaces>>
		| SyncMethodReturnViolation<Interfaces>
