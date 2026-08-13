/**
 * Synchronous semantic-boundary guard.
 *
 * Normative source: issue #10 amendment "synchronous core boundary and future async seams" /
 * consolidated handoff §16: a semantic callback returning a thenable is an implementation-contract
 * violation, not a Blueprint/Runtime Issue and not an `ExecutionResult.failure`, so it throws.
 *
 * `PromiseLike` is a structural (duck-typed) contract, not a nominal one, and its `then` method may
 * live on an object *or* on a callable (a function value with a `.then` property is still thenable).
 * Checking `typeof value === 'object'` alone misses that callable case, so both representations are
 * treated as thenable candidates before inspecting `.then`.
 */
export function assertSyncValue(value: unknown, description: string): void {
	if (
		((typeof value === 'object' && value !== null) || typeof value === 'function')
		&& 'then' in value
		&& typeof (value as { then?: unknown }).then === 'function'
	) {
		throw new TypeError(`${description} returned a thenable. The widget-core semantic boundary is synchronous only.`)
	}
}
