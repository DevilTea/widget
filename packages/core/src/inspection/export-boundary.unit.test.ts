/**
 * Conformance group 1 (export boundary) + type half of group 16 (no Method runtime inspection surface)
 * from issue #10's inspection amendment "inspection exact API v1 (part 2)".
 *
 * The runtime half of group 16 (no `getMethod` on an actual `RuntimeWidgetInspection` instance) lives in
 * `runtime-facades.unit.test.ts`, alongside the fixtures it needs.
 */

import type { RuntimeWidgetInspection } from './types'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as RootModule from '../index'
import * as InspectionModule from './index'

const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url))
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
	readonly exports: Record<string, { readonly types: string, readonly import: string }>
}

describe('export boundary', () => {
	it('the root entrypoint does not export inspectBlueprint/inspectRuntime at runtime', () => {
		expect((RootModule as Record<string, unknown>).inspectBlueprint)
			.toBeUndefined()
		expect((RootModule as Record<string, unknown>).inspectRuntime)
			.toBeUndefined()
	})

	it('the root entrypoint does not expose inspectBlueprint/inspectRuntime at the type level', () => {
		expectTypeOf<typeof RootModule>().not.toHaveProperty('inspectBlueprint')
		expectTypeOf<typeof RootModule>().not.toHaveProperty('inspectRuntime')
	})

	it('the ./inspection subpath exports inspectBlueprint and inspectRuntime as functions', () => {
		expect(typeof InspectionModule.inspectBlueprint)
			.toBe('function')
		expect(typeof InspectionModule.inspectRuntime)
			.toBe('function')
	})

	it('package.json declares the ./inspection subpath export with types+import conditions distinct from the root', () => {
		expect(packageJson.exports['.'])
			.toEqual({ types: './dist/index.d.mts', import: './dist/index.mjs' })
		expect(packageJson.exports['./inspection'])
			.toEqual({ types: './dist/inspection/index.d.mts', import: './dist/inspection/index.mjs' })
	})
})

describe('no Method runtime inspection surface (type level)', () => {
	it('runtimeWidgetInspection exposes no getMethod / method invocation / method history surface', () => {
		expectTypeOf<RuntimeWidgetInspection>().not.toHaveProperty('getMethod')
		expectTypeOf<RuntimeWidgetInspection>().not.toHaveProperty('methods')
		expectTypeOf<RuntimeWidgetInspection>().not.toHaveProperty('invokeHistory')
	})

	it('runtimeWidgetInspection only exposes the documented readonly surface', () => {
		expectTypeOf<RuntimeWidgetInspection>()
			.toHaveProperty('nodeId')
		expectTypeOf<RuntimeWidgetInspection>()
			.toHaveProperty('blueprintNode')
		expectTypeOf<RuntimeWidgetInspection>()
			.toHaveProperty('getState')
		expectTypeOf<RuntimeWidgetInspection>()
			.toHaveProperty('getProperty')
	})
})
