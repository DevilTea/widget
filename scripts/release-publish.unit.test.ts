import type { PublishDependencies, PublishOptions, RegistryAnswer, ReleasePackage } from './release-publish'
import { describe, expect, it } from 'vitest'
import { packageEntry, packageIds } from './release-package'
import {
	integrityNote,
	interpretRegistryResponse,
	packedManifestProblem,
	PublishError,
	publishOrder,
	registryVersionUrl,
	runPublish,
	tarballName,
} from './release-publish'

function release(version: string, ids: readonly string[] = packageIds): ReleasePackage[] {
	return ids.map((id) => {
		const { name } = packageEntry(id)
		return { id, name, version, tarball: `/tmp/${tarballName(name, version)}` }
	})
}

const published: RegistryAnswer = { kind: 'published', integrity: 'sha512-abc' }
const absent: RegistryAnswer = { kind: 'absent' }

interface Script {
	/** Registry state per package id; a list is consumed one answer per lookup, the last answer repeating. */
	registry: Record<string, RegistryAnswer | RegistryAnswer[]>
	/** Package ids whose `npm publish` fails. */
	failing?: string[]
}

function harness(script: Script) {
	const events: string[] = []
	const lines: string[] = []
	const counters = new Map<string, number>()
	const deps: PublishDependencies = {
		async lookup(pkg) {
			const state = script.registry[pkg.id] ?? absent
			const answers = Array.isArray(state) ? state : [state]
			const index = counters.get(pkg.id) ?? 0
			counters.set(pkg.id, index + 1)
			return answers[Math.min(index, answers.length - 1)] ?? absent
		},
		async publish(pkg, distTag) {
			events.push(`publish ${pkg.id} ${distTag}`)
			return { ok: script.failing?.includes(pkg.id) !== true }
		},
		localIntegrity: () => 'sha512-abc',
		async sleep(milliseconds) {
			events.push(`sleep ${milliseconds}`)
		},
		log: line => lines.push(line),
	}
	return { deps, events, lines }
}

const options: PublishOptions = { dryRun: false, recheckAttempts: 3, recheckIntervalMs: 5000 }

/** The same registry answer for every published package, with `overrides` on top. */
function everyPackage(answer: RegistryAnswer, overrides: Script['registry'] = {}): Script['registry'] {
	return { ...Object.fromEntries(packageIds.map(id => [id, answer])), ...overrides }
}

describe('publishOrder and tarballName', () => {
	it('publishes Core first, then the Inspector, the Vue adapter and the documentation generator', () => {
		expect(publishOrder)
			.toEqual(['widget-core', 'widget-inspector', 'widget-vue', 'widget-docs-generator'])
	})

	it('names the tarball the way npm pack does', () => {
		expect(tarballName('@deviltea/widget-core', '0.1.1'))
			.toBe('deviltea-widget-core-0.1.1.tgz')
		expect(tarballName('@deviltea/widget-vue', '0.2.0-beta.1'))
			.toBe('deviltea-widget-vue-0.2.0-beta.1.tgz')
	})

	it('asks the registry for exactly one version of a scoped package', () => {
		expect(registryVersionUrl('@deviltea/widget-core', '0.1.1'))
			.toBe('https://registry.npmjs.org/@deviltea%2Fwidget-core/0.1.1')
	})
})

describe('interpretRegistryResponse', () => {
	const name = '@deviltea/widget-core'

	it('reads a 200 for exactly this name and version as published, with its integrity', () => {
		expect(interpretRegistryResponse(name, '0.1.0', 200, { name, version: '0.1.0', dist: { integrity: 'sha512-x' } }))
			.toEqual({ kind: 'published', integrity: 'sha512-x' })
		expect(interpretRegistryResponse(name, '0.1.0', 200, { name, version: '0.1.0' }))
			.toEqual({ kind: 'published', integrity: null })
	})

	it('reads a JSON 404 as absent, for a missing version and for a missing package', () => {
		expect(interpretRegistryResponse(name, '0.1.1', 404, 'version not found: 0.1.1'))
			.toEqual({ kind: 'absent' })
		expect(interpretRegistryResponse(name, '0.1.1', 404, 'Not Found'))
			.toEqual({ kind: 'absent' })
		expect(interpretRegistryResponse(name, '0.1.1', 404, { error: 'not found' }))
			.toEqual({ kind: 'absent' })
	})

	it.each([
		['a 404 that is not JSON (a proxy page)', 404, undefined],
		['a 200 for another version', 200, { name, version: '0.0.9' }],
		['a 200 for another package', 200, { name: '@deviltea/widget-vue', version: '0.1.0' }],
		['a 200 that is not a document', 200, 'ok'],
		['a 200 without a body', 200, undefined],
		['a 429', 429, 'slow down'],
		['a 500', 500, undefined],
		['a 503', 503, { error: 'unavailable' }],
		['a 401', 401, { error: 'unauthorized' }],
		['a 403', 403, undefined],
	])('is unclear about %s', (_description, status, body) => {
		expect(interpretRegistryResponse(name, '0.1.0', status, body).kind)
			.toBe('unclear')
	})
})

describe('integrityNote', () => {
	it('says whether the registry copy is the local tarball, and never fails either way', () => {
		expect(integrityNote('sha512-a', 'sha512-a'))
			.toContain('same integrity')
		expect(integrityNote('sha512-a', 'sha512-b'))
			.toContain('differs')
		expect(integrityNote(null, 'sha512-b'))
			.toContain('not compared')
		expect(integrityNote('sha512-a', null))
			.toContain('not compared')
	})
})

describe('packedManifestProblem', () => {
	const expectedCore = { name: '@deviltea/widget-core', version: '0.1.1', corePeer: false }
	const expectedVue = { name: '@deviltea/widget-vue', version: '0.1.1', corePeer: true }
	const expectedGenerator = { name: '@deviltea/widget-docs-generator', version: '0.1.1', corePeer: true }

	it('accepts a manifest with the right name, version and packed Core peer range', () => {
		expect(packedManifestProblem({ name: '@deviltea/widget-core', version: '0.1.1', dependencies: { 'alien-signals': '^3.0.0' } }, expectedCore))
			.toBeNull()
		expect(packedManifestProblem({ name: '@deviltea/widget-vue', version: '0.1.1', peerDependencies: { '@deviltea/widget-core': '^0.1.1', 'vue': '^3.5.0' } }, expectedVue))
			.toBeNull()
		expect(packedManifestProblem({ name: '@deviltea/widget-docs-generator', version: '0.1.1', peerDependencies: { '@deviltea/widget-core': '^0.1.1', 'vite': '^6.0.0 || ^7.0.0 || ^8.0.0' }, dependencies: { tsx: '^4.23.0', typescript: '^6.0.3' } }, expectedGenerator))
			.toBeNull()
	})

	it('refuses another name or version', () => {
		expect(packedManifestProblem({ name: '@deviltea/widget-vue', version: '0.1.1' }, expectedCore))
			.toContain('names @deviltea/widget-vue')
		expect(packedManifestProblem({ name: '@deviltea/widget-core', version: '0.1.0' }, expectedCore))
			.toContain('0.1.0')
	})

	it('refuses a workspace range that was not rewritten when packing', () => {
		expect(packedManifestProblem({ name: '@deviltea/widget-vue', version: '0.1.1', peerDependencies: { '@deviltea/widget-core': 'workspace:^' } }, expectedVue))
			.toContain('workspace:^')
	})

	it('refuses a dependent whose Core peer range is not ^<version>', () => {
		expect(packedManifestProblem({ name: '@deviltea/widget-vue', version: '0.1.1', peerDependencies: { '@deviltea/widget-core': '^0.1.0' } }, expectedVue))
			.toContain('^0.1.1')
		expect(packedManifestProblem({ name: '@deviltea/widget-vue', version: '0.1.1' }, expectedVue))
			.toContain('^0.1.1')
		// The generator's Core peer: a caret on another version, or Core only as a dev dependency (bundled or missing).
		expect(packedManifestProblem({ name: '@deviltea/widget-docs-generator', version: '0.1.1', peerDependencies: { '@deviltea/widget-core': '^0.1.0' } }, expectedGenerator))
			.toContain('^0.1.1')
		expect(packedManifestProblem({ name: '@deviltea/widget-docs-generator', version: '0.1.1', peerDependencies: { vite: '^7.0.0' }, devDependencies: { '@deviltea/widget-core': '0.1.1' } }, expectedGenerator))
			.toContain('^0.1.1')
	})

	it('refuses a manifest that is not an object', () => {
		expect(packedManifestProblem(null, expectedCore))
			.toContain('not an object')
	})
})

describe('runPublish', () => {
	it('publishes Core, then the Inspector, the Vue adapter and the documentation generator when none is on the registry', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent) })
		const outcomes = await runPublish(release('0.1.1'), deps, options)
		expect(events)
			.toEqual(['publish widget-core latest', 'publish widget-inspector latest', 'publish widget-vue latest', 'publish widget-docs-generator latest'])
		expect(outcomes.map(outcome => outcome.status))
			.toEqual(['published', 'published', 'published', 'published'])
	})

	it('orders the packages even when they are given in another order', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent) })
		await runPublish(release('0.1.1', ['widget-docs-generator', 'widget-vue', 'widget-inspector', 'widget-core']), deps, options)
		expect(events.map(event => event.split(' ')[1]))
			.toEqual(['widget-core', 'widget-inspector', 'widget-vue', 'widget-docs-generator'])
	})

	it('skips every package that is already published, saying so, and publishes nothing (a re-run after full success)', async () => {
		const { deps, events, lines } = harness({ registry: everyPackage(published) })
		const outcomes = await runPublish(release('0.1.0'), deps, options)
		expect(events)
			.toEqual([])
		expect(outcomes.map(outcome => outcome.status))
			.toEqual(['skipped', 'skipped', 'skipped', 'skipped'])
		for (const name of packageIds.map(id => packageEntry(id).name)) {
			expect(lines.some(line => line.includes(`${name}@0.1.0 is already published, skipping`)))
				.toBe(true)
		}
	})

	it('finishes a release after Core was published and a dependent was not (a re-run after a partial failure)', async () => {
		const { deps, events } = harness({ registry: everyPackage(published, { 'widget-docs-generator': absent }) })
		const outcomes = await runPublish(release('0.1.1'), deps, options)
		expect(events)
			.toEqual(['publish widget-docs-generator latest'])
		expect(outcomes.map(outcome => outcome.status))
			.toEqual(['skipped', 'skipped', 'skipped', 'published'])
	})

	it('publishes the dependents when Core was found published and they were not', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent, { 'widget-core': published }) })
		await runPublish(release('0.1.1'), deps, options)
		expect(events)
			.toEqual(['publish widget-inspector latest', 'publish widget-vue latest', 'publish widget-docs-generator latest'])
	})

	it('publishes no dependent when Core fails to publish and the registry does not have it', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent), failing: ['widget-core'] })
		const error = await runPublish(release('0.1.1'), deps, options)
			.catch((caught: unknown) => caught)
		expect(error)
			.toBeInstanceOf(PublishError)
		expect(events.filter(event => event.startsWith('publish ')))
			.toEqual(['publish widget-core latest'])
		expect((error as PublishError).outcomes)
			.toEqual([])
		expect((error as PublishError).message)
			.toContain('@deviltea/widget-core@0.1.1')
	})

	it('stops after the Inspector fails and publishes neither the Vue adapter nor the generator, keeping what was published', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent), failing: ['widget-inspector'] })
		const error = await runPublish(release('0.1.1'), deps, options)
			.catch((caught: unknown) => caught)
		expect(events.filter(event => event.startsWith('publish ')))
			.toEqual(['publish widget-core latest', 'publish widget-inspector latest'])
		expect((error as PublishError).outcomes)
			.toEqual([{ id: 'widget-core', status: 'published' }])
	})

	it('treats a failed `npm publish` as published when the registry then has that exact version', async () => {
		const { deps, events, lines } = harness({
			registry: everyPackage(absent, { 'widget-core': [absent, absent, published] }),
			failing: ['widget-core'],
		})
		const outcomes = await runPublish(release('0.1.1'), deps, options)
		expect(outcomes.map(outcome => outcome.status))
			.toEqual(['published-despite-error', 'published', 'published', 'published'])
		expect(events)
			.toEqual(['publish widget-core latest', 'sleep 5000', 'publish widget-inspector latest', 'publish widget-vue latest', 'publish widget-docs-generator latest'])
		expect(lines.some(line => line.includes('treating it as published')))
			.toBe(true)
	})

	it('gives up after the configured number of re-checks when the version never shows up', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent), failing: ['widget-core'] })
		await expect(runPublish(release('0.1.1'), deps, options))
			.rejects
			.toBeInstanceOf(PublishError)
		expect(events.filter(event => event.startsWith('sleep')))
			.toEqual(['sleep 5000', 'sleep 5000'])
	})

	it('publishes nothing when the registry gives an unclear answer for any package', async () => {
		for (const unclearId of packageIds) {
			const registry = everyPackage(absent, { [unclearId]: { kind: 'unclear', reason: 'the registry answered HTTP 503' } })
			const { deps, events } = harness({ registry })
			const error = await runPublish(release('0.1.1'), deps, options)
				.catch((caught: unknown) => caught)
			expect(error)
				.toBeInstanceOf(PublishError)
			expect((error as PublishError).message)
				.toContain('HTTP 503')
			expect(events)
				.toEqual([])
		}
	})

	it('sends a prerelease to the next dist-tag and never to latest', async () => {
		const { deps, events } = harness({ registry: everyPackage(absent) })
		await runPublish(release('0.2.0-beta.0'), deps, options)
		expect(events)
			.toEqual(['publish widget-core next', 'publish widget-inspector next', 'publish widget-vue next', 'publish widget-docs-generator next'])
	})

	it('in a dry run asks the registry but publishes nothing, listing what it would publish in order', async () => {
		const { deps, events, lines } = harness({ registry: everyPackage(absent, { 'widget-core': published }) })
		const outcomes = await runPublish(release('0.1.1'), deps, { ...options, dryRun: true })
		expect(events)
			.toEqual([])
		expect(outcomes)
			.toEqual([
				{ id: 'widget-core', status: 'skipped' },
				{ id: 'widget-inspector', status: 'would-publish' },
				{ id: 'widget-vue', status: 'would-publish' },
				{ id: 'widget-docs-generator', status: 'would-publish' },
			])
		expect(lines.filter(line => line.startsWith('Dry run: would publish')))
			.toHaveLength(3)
	})
})
