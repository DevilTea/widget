// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PUBLIC_SUBPATHS = ['agent', 'anchor', 'channel', 'client', 'frame-bootstrap', 'protocol', 'transport', 'value'] as const
const INTERNAL_MODULES = ['geometry', 'overlay', 'projection', 'test-fixture', 'validation'] as const

interface PackageJson {
	readonly name: string
	readonly version: string
	readonly private?: boolean
	readonly files: readonly string[]
	readonly exports: Record<string, { readonly types: string, readonly import: string }>
	readonly main?: string
	readonly module?: string
	readonly types?: string
	readonly dependencies?: Record<string, string>
	readonly peerDependencies?: Record<string, string>
	readonly devDependencies?: Record<string, string>
	readonly publishConfig?: { readonly access?: string }
}

function readText(relative: string): string {
	return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const pkg = JSON.parse(readText('../package.json')) as PackageJson

describe('published package boundary', () => {
	it('is a public package under the accepted name, with a release-managed semver version', () => {
		expect(pkg.name)
			.toBe('@deviltea/widget-inspector')
		expect(pkg.private)
			.toBeUndefined()
		expect(pkg.publishConfig?.access)
			.toBe('public')
		expect(pkg.version)
			.toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i)
		expect(pkg.files)
			.toStrictEqual(['dist'])
	})

	it('exposes exactly the accepted public subpaths and no root entry', () => {
		expect(Object.keys(pkg.exports)
			.sort())
			.toStrictEqual(PUBLIC_SUBPATHS.map(name => `./${name}`)
				.sort())
		expect(Object.keys(pkg.exports)).not.toContain('.')
		// Without a root export the legacy top-level resolution fields would reintroduce one.
		expect(pkg.main)
			.toBeUndefined()
		expect(pkg.module)
			.toBeUndefined()
		expect(pkg.types)
			.toBeUndefined()
	})

	it('maps every public subpath to its built ESM and declaration files', () => {
		for (const name of PUBLIC_SUBPATHS) {
			expect(pkg.exports[`./${name}`])
				.toStrictEqual({ types: `./dist/${name}.d.mts`, import: `./dist/${name}.mjs` })
		}
	})

	it('does not export internal modules through any condition or wildcard', () => {
		const serialized = JSON.stringify(pkg.exports)
		expect(serialized).not.toContain('*')
		expect(serialized).not.toContain('./src/')
		for (const name of INTERNAL_MODULES) {
			expect(Object.keys(pkg.exports)).not.toContain(`./${name}`)
			expect(serialized).not.toContain(`/${name}.`)
		}
	})

	it('builds exactly the public subpaths as entries', () => {
		const config = readText('../tsdown.config.ts')
		const entries = [...config.matchAll(/'src\/([\w-]+)\.ts'/g)].map(match => match[1])
			.sort()
		expect(entries)
			.toStrictEqual([...PUBLIC_SUBPATHS])
	})

	it('classifies every source module as either public or internal', () => {
		const modules = readdirSync(new URL('.', import.meta.url))
			.filter(file => file.endsWith('.ts') && !file.endsWith('.unit.test.ts'))
			.map(file => file.slice(0, -'.ts'.length))
			.sort()
		expect(modules)
			.toStrictEqual([...PUBLIC_SUBPATHS, ...INTERNAL_MODULES].sort())
	})

	it('has no root index module', () => {
		expect(readdirSync(new URL('.', import.meta.url))).not.toContain('index.ts')
	})

	it('treats Core as a peer so a second Core copy is never bundled or installed', () => {
		expect(pkg.peerDependencies?.['@deviltea/widget-core'])
			.toBeDefined()
		expect(pkg.dependencies?.['@deviltea/widget-core'])
			.toBeUndefined()
		expect(pkg.devDependencies?.['@deviltea/widget-core'])
			.toBe('workspace:*')
	})
})
