/**
 * The Property inspection snapshot mirrors the Runtime Property result: a completed ok value is exactly `T`,
 * never `T | null` (only `RuntimeState.get()` and optional dependency reads keep `null`).
 */

import type { RuntimeProperty } from '../index'
import type { RuntimePropertyInspectionSnapshot } from './index'
import { describe, expectTypeOf, it } from 'vitest'

type Completed<T> = Extract<RuntimePropertyInspectionSnapshot<T>, { readonly status: 'completed' }>
type RuntimeResult<T> = ReturnType<RuntimeProperty<T>['get']>

describe('property inspection snapshot typing', () => {
	it('types a completed result exactly like the Runtime Property result', () => {
		expectTypeOf<Completed<number>['result']>()
			.toEqualTypeOf<RuntimeResult<number>>()
	})

	it('does not widen a completed ok value with null', () => {
		type Ok = Extract<Completed<number>['result'], { readonly ok: true }>
		expectTypeOf<Ok['value']>()
			.toEqualTypeOf<number>()
	})
})
