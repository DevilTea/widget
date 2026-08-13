/**
 * Runtime operation outcome.
 *
 * Normative source: issue #10 checkpoint E / consolidated handoff §12.
 *
 * Rules:
 * - failure issues are non-empty
 * - failure exposes no usable value
 * - `null` is not a failure sentinel; `success` with `value: null` is valid
 * - `RuntimeState.get()` is not an operation outcome and stays a direct `T | null`
 */
export type ExecutionResult<T, Issue>
	= | {
		readonly success: true
		readonly value: T
	}
	| {
		readonly success: false
		readonly issues: readonly [Issue, ...Issue[]]
	}

export type SuccessfulExecutionResult<T> = Extract<ExecutionResult<T, never>, { success: true }>

export type FailedExecutionResult<Issue> = Extract<ExecutionResult<never, Issue>, { success: false }>
