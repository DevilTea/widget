import type { NonEmptyReadonlyArray } from './types'

export interface ExecutionFailure<Diagnostic> {
	readonly diagnostics: NonEmptyReadonlyArray<Diagnostic>
}

/** Domain-specific execution outcome. There is intentionally no public generic `Result` alias. */
export type ExecutionResult<T, Diagnostic>
	= | { readonly ok: true, readonly value: T }
		| { readonly ok: false, readonly failure: ExecutionFailure<Diagnostic> }
