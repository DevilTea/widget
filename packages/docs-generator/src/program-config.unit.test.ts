import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readProgramConfig } from './extract'

const scratch = mkdtempSync(join(tmpdir(), 'widget-docs-config-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A directory with `src/system.ts` and the given `tsconfig.json`. */
function project(tsconfig: unknown): { directory: string, module: string } {
	const directory = mkdtempSync(join(scratch, 'project-'))
	mkdirSync(join(directory, 'src'))
	writeFileSync(join(directory, 'src/system.ts'), 'export const system = 1\n')
	writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfig))
	return { directory, module: join(directory, 'src/system.ts') }
}

describe('readProgramConfig', () => {
	it('refuses the nearest tsconfig when it is a solution file with no root files', () => {
		const { directory, module } = project({ files: [], references: [{ path: './tsconfig.app.json' }] })
		expect(() => readProgramConfig({ modulePath: module }))
			.toThrow(`${join(directory, 'tsconfig.json')} does not include ${module} (it has no root files: a solution tsconfig?)`)
	})

	it('refuses a tsconfig that does not include the module', () => {
		const { directory, module } = project({ compilerOptions: { strict: true }, include: ['./other/**/*.ts'] })
		mkdirSync(join(directory, 'other'))
		writeFileSync(join(directory, 'other/other.ts'), 'export const other = 1\n')
		expect(() => readProgramConfig({ modulePath: module }))
			.toThrow('not in its files or include')
	})

	it('refuses a tsconfig without strictNullChecks, which would erase `| null`', () => {
		const { directory, module } = project({ include: ['./src/**/*.ts'] })
		expect(() => readProgramConfig({ modulePath: module, tsconfigPath: join(directory, 'tsconfig.json') }))
			.toThrow('compiles without strictNullChecks')
		const loose = project({ compilerOptions: { strict: true, strictNullChecks: false }, include: ['./src/**/*.ts'] })
		expect(() => readProgramConfig({ modulePath: loose.module }))
			.toThrow('compiles without strictNullChecks')
	})

	it('accepts an application tsconfig that includes the module with strictNullChecks', () => {
		const { directory, module } = project({ files: [], references: [{ path: './tsconfig.app.json' }] })
		writeFileSync(join(directory, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { strictNullChecks: true }, include: ['./src/**/*.ts'] }))
		const config = readProgramConfig({ modulePath: module, tsconfigPath: join(directory, 'tsconfig.app.json') })
		expect(config.tsconfigPath)
			.toBe(join(directory, 'tsconfig.app.json'))
		expect(config.compilerOptions.strictNullChecks)
			.toBe(true)
	})
})
