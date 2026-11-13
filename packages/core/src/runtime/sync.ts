/**
 * Synchronous semantic-boundary guard.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 amendment "synchronous core boundary and future async seams" /
 * consolidated handoff §16: a semantic callback returning a thenable is an implementation-contract
 * violation, not a Blueprint/Runtime Diagnostic and not an `ExecutionResult.failure`, so it throws.
 *
 * `PromiseLike` is a structural (duck-typed) contract, not a nominal one, and its `then` method may
 * live on an object *or* on a callable (a function value with a `.then` property is still thenable).
 * Checking `typeof value === 'object'` alone misses that callable case, so both representations are
 * treated as thenable candidates before inspecting `.then`.
 */
export function assertSyncValue(value: unknown, description: string): void
/**
 * The same check for the description `${kind} "${name}"'s ${what}`, which is only built when the check
 * throws: hot paths pass its parts instead of allocating the string on every call.
 */
export function assertSyncValue(value: unknown, kind: string, name: string, what: string): void
export function assertSyncValue(value: unknown, description: string, name?: string, what?: string): void {
	if (
		((typeof value === 'object' && value !== null) || typeof value === 'function')
		&& 'then' in value
		&& typeof (value as { then?: unknown }).then === 'function'
	) {
		const subject = name === undefined ? description : `${description} "${name}"'s ${what}`
		throw new TypeError(`${subject} returned a thenable. The widget-core semantic boundary is synchronous only.`)
	}
}

/**
 * Callback-context lifetime guard: a callback's `addDiagnostic` / `hasAnyDiagnostic` belong to the
 * synchronous call that received them. Calling one after that callback returned or threw is an
 * implementation-contract violation (the operation's diagnostics are already final), so it throws.
 */
export function throwClosedCollector(method: 'addDiagnostic' | 'hasAnyDiagnostic'): never {
	throw new TypeError(`${method} was called after its callback returned. Diagnostics must be reported synchronously while the callback runs.`)
}

/**
 * The same lifetime guard for a callback's dependency callables (`deps.*`) and `emit` callables. They
 * are valid only while the callback that received them is the innermost running callback (see
 * `callbackScope` in `./context`): a call after it returned or threw, or from a listener or another
 * callback running inside it, is an implementation-contract violation and performs nothing.
 */
export function throwClosedCallbackMember(member: 'deps' | 'emit'): never {
	throw new TypeError(`${member === 'deps' ? 'A dependency' : 'An emit'} callable was called outside the callback that received it. Dependency and emit callables must be used synchronously while that callback runs, not after it returned and not from a listener or another callback running inside it.`)
}
