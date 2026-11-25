import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * The published packages, in publish order: Core first, because the other three declare it as a peer
 * dependency, then the Inspector, the Vue adapter and the documentation generator. They always carry one and
 * the same version. `legacyTags` marks the packages that were released with per-package tags
 * (`widget-core@0.1.0`) before the versions were unified; the generator joined the release after that.
 */
const packages = {
	'widget-core': {
		directory: 'packages/core',
		name: '@deviltea/widget-core',
		legacyTags: true,
	},
	'widget-inspector': {
		directory: 'packages/inspector',
		name: '@deviltea/widget-inspector',
		legacyTags: true,
	},
	'widget-vue': {
		directory: 'packages/vue',
		name: '@deviltea/widget-vue',
		legacyTags: true,
	},
	'widget-docs-generator': {
		directory: 'packages/docs-generator',
		name: '@deviltea/widget-docs-generator',
		legacyTags: false,
	},
} as const

type PackageId = keyof typeof packages
export const packageIds = Object.keys(packages) as PackageId[]

export function fail(message: string): never {
	throw new Error(message)
}

export function packageEntry(id: string) {
	if (!(id in packages))
		fail(`Unknown release package: ${id}`)
	return packages[id as PackageId]
}

export function packageVersion(id: string) {
	const entry = packageEntry(id)
	const packageJsonPath = resolve(workspaceRoot, entry.directory, 'package.json')
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string, version?: string }
	if (packageJson.name !== entry.name)
		fail(`Expected ${packageJsonPath} to name ${entry.name}`)
	if (!packageJson.version)
		fail(`Expected ${packageJsonPath} to contain a version`)
	return packageJson.version
}

/** The workspace version of every published package, keyed by package id. */
export function packageVersions(): Record<string, string> {
	return Object.fromEntries(packageIds.map(id => [id, packageVersion(id)]))
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*))*))?$/i

/** Parses `major.minor.patch[-prerelease]`; build metadata is not used by this repository and is rejected. */
export function parseVersion(version: string) {
	const match = SEMVER.exec(version)
	if (match === null)
		return null
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ?? null,
	}
}

/** The version the published packages share: Core's, which `unifiedVersionProblem` has checked the others against. */
export function sharedVersion(versions: Readonly<Record<string, string>>) {
	return versions['widget-core'] ?? ''
}

/**
 * What stops the published packages from being released together at `versions` (package id to version), or
 * `null` when they can. Pure: takes the versions.
 *
 * The packages share one version. Every package but Core declares Core as a `workspace:^` peer,
 * which packs as `^<version>`; on `0.0.x` that caret is an exact pin (`^0.0.6` is `0.0.6`), so a `0.0.x`
 * release is refused as well.
 */
export function unifiedVersionProblem(versions: Readonly<Record<string, string>>): string | null {
	const missing = packageIds.filter(id => typeof versions[id] !== 'string')
	if (missing.length > 0)
		return `No version for ${missing.join(', ')}.`

	const listed = packageIds.map(id => `${id} ${versions[id]}`)
		.join(', ')
	const distinct = new Set(packageIds.map(id => versions[id]))
	if (distinct.size > 1)
		return `The published packages must share one version, but they differ: ${listed}. Set them all to the same version.`

	const version = sharedVersion(versions)
	const parsed = parseVersion(version)
	if (parsed === null)
		return `"${version}" is not a plain \`major.minor.patch[-prerelease]\` version.`
	if (parsed.major === 0 && parsed.minor === 0)
		return `Version ${version} is \`0.0.x\`, where the \`^${version}\` Core peer range of the other packages would pin exactly that patch. Release \`0.1.0\` or later.`
	return null
}

/** Throws when the workspace packages do not share one releasable version; returns that version otherwise. */
export function assertUnifiedVersion() {
	const versions = packageVersions()
	const problem = unifiedVersionProblem(versions)
	if (problem !== null)
		fail(problem)
	return sharedVersion(versions)
}

/** The one annotated tag of a release: `v<version>`. */
export function releaseTag(version: string) {
	return `v${version}`
}

/** The version a release tag names, or `null` when `tag` is not `v<version>`. */
export function releaseVersionFromTag(tag: string) {
	if (!tag.startsWith('v'))
		return null
	const version = tag.slice(1)
	return parseVersion(version) === null ? null : version
}

export function releaseBranch(version: string) {
	return `release/${releaseTag(version)}`
}

export function releaseCommitMessage(version: string) {
	return `chore: release ${releaseTag(version)}`
}

/**
 * The per-package tags (`widget-core@0.1.0`) of the releases made before the versions were unified. Only the
 * packages released that way have them: the documentation generator was only ever tagged `v<version>`.
 */
export function legacyPackageTags(version: string) {
	return packageIds.filter(id => packages[id].legacyTags)
		.map(id => `${id}@${version}`)
}

/**
 * Every tag that would mean `version` is already released: the unified tag and the old per-package tags.
 * Pure: the caller asks the remote which of them exist.
 */
export function releaseTagNames(version: string) {
	return [releaseTag(version), ...legacyPackageTags(version)]
}

/**
 * What is wrong with releasing `tag` while the workspace packages are at `versions`, or `null` when the tag
 * is `v<version>` and every published package is at exactly that version. Pure.
 */
export function releaseTagProblem(tag: string, versions: Readonly<Record<string, string>>): string | null {
	const tagVersion = releaseVersionFromTag(tag)
	if (tagVersion === null)
		return `Invalid release tag "${tag}": expected \`v<major>.<minor>.<patch>[-prerelease]\`.`
	const problem = unifiedVersionProblem(versions)
	if (problem !== null)
		return problem
	const version = sharedVersion(versions)
	if (version !== tagVersion)
		return `Tag ${tag} does not match the package version ${version} (expected tag ${releaseTag(version)}).`
	return null
}

/** The npm dist-tag of a release: prereleases go to `next` and never take the default `latest`. */
export function distTagFor(version: string): 'latest' | 'next' {
	const parsed = parseVersion(version)
	if (parsed === null)
		fail(`"${version}" is not a plain \`major.minor.patch[-prerelease]\` version.`)
	return parsed.prerelease === null ? 'latest' : 'next'
}

function runCli() {
	const [command, value] = process.argv.slice(2)
	switch (command) {
		case 'check':
			console.log(assertUnifiedVersion())
			break
		case 'verify-tag': {
			if (!value)
				fail('Usage: release-package.ts verify-tag <tag>')
			const problem = releaseTagProblem(value, packageVersions())
			if (problem !== null)
				fail(problem)
			console.log(assertUnifiedVersion())
			break
		}
		default:
			fail('Usage: release-package.ts <check|verify-tag <tag>>')
	}
}

const entrypoint = process.argv[1]
if (entrypoint != null && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
	try {
		runCli()
	}
	catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
