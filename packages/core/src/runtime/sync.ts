/**
 * Synchronous semantic-boundary guard.
 *
 * Normative source: issue #10 amendment "synchronous core boundary and future async seams" /
 * consolidated handoff §16: a semantic callback returning a thenable is an implementation-contract
 * violation, not a Blueprint/Runtime Issue and not an `ExecutionResult.failure`, so it throws.
 */
export function assertSyncValue(value: unknown, description: string): void {
	if (
		typeof value === 'object'
		&& value !== null
		&& 'then' in value
		&& typeof (value as { then?: unknown }).then === 'function'
	) {
		throw new TypeError(`${description} returned a thenable. The widget-core semantic boundary is synchronous only.`)
	}
}
