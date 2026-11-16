import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	assertUnifiedVersion,
	distTagFor,
	legacyPackageTags,
	packageEntry,
	packageIds,
	packageVersions,
	parseVersion,
	releaseBranch,
	releaseCommitMessage,
	releaseTag,
	releaseTagNames,
	releaseTagProblem,
	releaseVersionFromTag,
	unifiedVersionProblem,
	workspaceRoot,
} from './release-package'

function same(version: string) {
	return Object.fromEntries(packageIds.map(id => [id, version]))
}

describe('parseVersion', () => {
	it.each([
		['0.1.1', { major: 0, minor: 1, patch: 1, prerelease: null }],
		['1.20.3', { major: 1, minor: 20, patch: 3, prerelease: null }],
		['0.2.0-beta.1', { major: 0, minor: 2, patch: 0, prerelease: 'beta.1' }],
		['0.1.1-0', { major: 0, minor: 1, patch: 1, prerelease: '0' }],
	])('reads %s', (version, expected) => {
		expect(parseVersion(version))
			.toEqual(expected)
	})

	it.each(['', '1', '1.2', 'v1.2.3', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3-01', '1.2.3+build', 'latest'])('rejects %j', (version) => {
		expect(parseVersion(version))
			.toBeNull()
	})
})

describe('unifiedVersionProblem', () => {
	it.each(['0.1.0', '0.1.1', '0.2.0', '1.0.0', '0.1.1-beta.0'])('accepts every package at %s', (version) => {
		expect(unifiedVersionProblem(same(version)))
			.toBeNull()
	})

	it('refuses packages that differ and names each version', () => {
		const problem = unifiedVersionProblem({ ...same('0.1.1'), 'widget-vue': '0.1.0' })
		expect(problem)
			.toContain('share one version')
		expect(problem)
			.toContain('widget-core 0.1.1')
		expect(problem)
			.toContain('widget-vue 0.1.0')
	})

	it('refuses a prerelease that differs only in its prerelease part', () => {
		expect(unifiedVersionProblem({ ...same('0.1.1-beta.0'), 'widget-inspector': '0.1.1' }))
			.toContain('share one version')
	})

	it('refuses a package without a version', () => {
		const versions = same('0.1.1') as Record<string, string | undefined>
		delete versions['widget-inspector']
		expect(unifiedVersionProblem(versions as Record<string, string>))
			.toContain('widget-inspector')
	})

	it.each(['0.0.0', '0.0.6', '0.0.7-beta.1'])('refuses %s, where the `^` Core peer range of the dependents pins one exact patch', (version) => {
		const problem = unifiedVersionProblem(same(version))
		expect(problem)
			.toContain(version)
		expect(problem)
			.toContain('0.1.0')
	})

	it('refuses a version it cannot read instead of letting the release through', () => {
		expect(unifiedVersionProblem(same('not-a-version')))
			.toContain('not-a-version')
	})
})

describe('release names', () => {
	it('names the one tag, branch and commit of a release after the version', () => {
		expect(releaseTag('0.1.1'))
			.toBe('v0.1.1')
		expect(releaseBranch('0.1.1'))
			.toBe('release/v0.1.1')
		expect(releaseCommitMessage('0.1.1'))
			.toBe('chore: release v0.1.1')
	})

	it('also treats the old per-package tags of the same version as "already released"', () => {
		expect(legacyPackageTags('0.1.0'))
			.toEqual(['widget-core@0.1.0', 'widget-inspector@0.1.0', 'widget-vue@0.1.0'])
		expect(releaseTagNames('0.1.0'))
			.toEqual(['v0.1.0', 'widget-core@0.1.0', 'widget-inspector@0.1.0', 'widget-vue@0.1.0'])
	})

	it('reads the version out of a release tag only when the tag is `v<version>`', () => {
		expect(releaseVersionFromTag('v0.1.1'))
			.toBe('0.1.1')
		expect(releaseVersionFromTag('v0.2.0-beta.1'))
			.toBe('0.2.0-beta.1')
		for (const tag of ['0.1.1', 'widget-core@0.1.1', 'v', 'v1', 'v1.2', 'vscode-1.2.3', 'V0.1.1']) {
			expect(releaseVersionFromTag(tag))
				.toBeNull()
		}
	})
})

describe('releaseTagProblem', () => {
	it('accepts the tag of the version all packages share', () => {
		expect(releaseTagProblem('v0.1.1', same('0.1.1')))
			.toBeNull()
		expect(releaseTagProblem('v0.2.0-beta.1', same('0.2.0-beta.1')))
			.toBeNull()
	})

	it('refuses a tag that is not `v<version>`, including the old per-package tags', () => {
		expect(releaseTagProblem('widget-core@0.1.1', same('0.1.1')))
			.toContain('Invalid release tag')
		expect(releaseTagProblem('v1', same('0.1.1')))
			.toContain('Invalid release tag')
	})

	it('refuses a tag whose version is not the packages\' version', () => {
		const problem = releaseTagProblem('v0.1.2', same('0.1.1'))
		expect(problem)
			.toContain('v0.1.2')
		expect(problem)
			.toContain('0.1.1')
	})

	it('refuses a matching tag when only some packages are at that version', () => {
		expect(releaseTagProblem('v0.1.1', { ...same('0.1.1'), 'widget-inspector': '0.1.0' }))
			.toContain('share one version')
	})

	it('refuses a prerelease tag against a stable version', () => {
		expect(releaseTagProblem('v0.1.1-beta.0', same('0.1.1')))
			.toContain('does not match')
	})
})

describe('distTagFor', () => {
	it('sends stable versions to latest and prereleases to next, never latest', () => {
		expect(distTagFor('0.1.1'))
			.toBe('latest')
		expect(distTagFor('1.0.0'))
			.toBe('latest')
		for (const version of ['0.2.0-beta.0', '0.1.1-0', '1.0.0-rc.1']) {
			expect(distTagFor(version))
				.toBe('next')
		}
	})

	it('rejects a version it cannot read', () => {
		expect(() => distTagFor('latest'))
			.toThrow('latest')
	})
})

describe('workspace manifests', () => {
	it('keeps the published packages at one releasable version', () => {
		expect(unifiedVersionProblem(packageVersions()))
			.toBeNull()
		expect(assertUnifiedVersion())
			.toBe(packageVersions()['widget-core'])
	})

	it('publishes Core first because the other packages peer-depend on it', () => {
		expect(packageIds[0])
			.toBe('widget-core')
		for (const id of packageIds.slice(1)) {
			const manifest = JSON.parse(readFileSync(`${workspaceRoot}${packageEntry(id).directory}/package.json`, 'utf8')) as { peerDependencies?: Record<string, string> }
			expect(manifest.peerDependencies?.['@deviltea/widget-core'])
				.toBe('workspace:^')
		}
	})
})
