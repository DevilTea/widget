import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assertUnifiedVersion, distTagFor, fail, packageEntry, packageIds, packageVersion, workspaceRoot } from './release-package'

/**
 * Publishes the packed Widget packages for one release (run by `.github/workflows/publish.yml`).
 *
 * The four packages are published in dependency order, Core first. A package whose exact version is
 * already on the registry is skipped, so re-running the workflow after a partial failure finishes the
 * release. The registry is asked about the exact version (`GET /<name>/<version>`), which is not served from
 * the cached package document that lags behind a publish; an answer that is neither a clear "present" nor a
 * clear "absent" stops the run before anything is published. So does a package that does not exist on the
 * registry at all: Trusted Publishing cannot create one, so publishing the others first would leave a partial
 * release (see `docs/migration/release-cutover.md` for the one-time placeholder).
 */

const REGISTRY = 'https://registry.npmjs.org'

export interface ReleasePackage {
	id: string
	name: string
	version: string
	/** Absolute path of the packed tarball. */
	tarball: string
}

/**
 * What the registry says about one package version: `published` (that exact version is there), `absent` (the
 * package exists and that version is not there), `missing-package` (the package itself does not exist: Trusted
 * Publishing cannot create it) or `unclear`.
 */
export type RegistryAnswer
	= | { kind: 'published', integrity: string | null }
		| { kind: 'absent' }
		| { kind: 'missing-package' }
		| { kind: 'unclear', reason: string }

/** Where the one-time step that creates a package on npm is described. */
export const PACKAGE_CREATION_GUIDE = 'docs/migration/release-cutover.md'

/** The packages in the order they must be published: Core, then the packages that peer-depend on it. */
export const publishOrder: readonly string[] = packageIds

/** The file name `npm pack` gives a package: `@deviltea/widget-core` at `0.1.1` is `deviltea-widget-core-0.1.1.tgz`. */
export function tarballName(name: string, version: string) {
	return `${name.replace(/^@/, '')
		.replace('/', '-')}-${version}.tgz`
}

/** The registry URL that answers for exactly one version of one package. */
export function registryVersionUrl(name: string, version: string) {
	return `${REGISTRY}/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`
}

/** The registry URL of a package's document (the packument), which exists exactly when the package does. */
export function registryPackageUrl(name: string) {
	return `${REGISTRY}/${name.replace('/', '%2F')}`
}

/**
 * Reads the registry's answer for one exact version. Pure: takes the HTTP status and the parsed JSON body
 * (`undefined` when the body was not JSON).
 *
 * `200` with this very name and version is "published". `404` with a JSON body is "absent" here: that version is
 * not served. The registry answers the same status for a missing version and for a missing package, so whether
 * the package exists is asked separately (`interpretPackageResponse`). Anything else, including a `200` for
 * another version, a `404` that is not JSON (a proxy or CDN page) and every `4xx`/`5xx` other than `404`, is
 * unclear, because publishing on a guess could either fail on "cannot publish over the previously published
 * versions" or publish something that is already there.
 */
export function interpretRegistryResponse(name: string, version: string, status: number, body: unknown): RegistryAnswer {
	if (status === 200) {
		if (typeof body === 'object' && body !== null) {
			const document = body as { name?: unknown, version?: unknown, dist?: { integrity?: unknown } }
			if (document.name === name && document.version === version) {
				const integrity = document.dist?.integrity
				return { kind: 'published', integrity: typeof integrity === 'string' ? integrity : null }
			}
		}
		return { kind: 'unclear', reason: `the registry answered 200 for ${name}@${version} with a document that is not that version` }
	}
	if (status === 404) {
		if (typeof body === 'string' || (typeof body === 'object' && body !== null))
			return { kind: 'absent' }
		return { kind: 'unclear', reason: `the registry answered 404 for ${name}@${version} without a JSON body` }
	}
	return { kind: 'unclear', reason: `the registry answered HTTP ${status} for ${name}@${version}` }
}

/**
 * Reads the registry's answer for a package's document, asked after the exact version was not found. Pure: takes
 * the HTTP status and the parsed JSON body. It goes by the status and the document's own `name`, never by the
 * wording of an error message.
 *
 * `200` with a document of this name is "absent": the package exists and the version is not published yet (the
 * normal case of a release). A document that lists the version anyway contradicts the version answer and is
 * unclear. `404` with a JSON body is "missing-package": the package does not exist, and Trusted Publishing cannot
 * create it. Anything else is unclear.
 */
export function interpretPackageResponse(name: string, version: string, status: number, body: unknown): RegistryAnswer {
	if (status === 200) {
		if (typeof body === 'object' && body !== null && (body as { name?: unknown }).name === name) {
			const versions = (body as { versions?: unknown }).versions
			if (typeof versions === 'object' && versions !== null && Object.hasOwn(versions, version))
				return { kind: 'unclear', reason: `the registry lists ${name}@${version} in the package document but did not serve that version` }
			return { kind: 'absent' }
		}
		return { kind: 'unclear', reason: `the registry answered 200 for the package ${name} with a document that is not that package` }
	}
	if (status === 404) {
		if (typeof body === 'string' || (typeof body === 'object' && body !== null))
			return { kind: 'missing-package' }
		return { kind: 'unclear', reason: `the registry answered 404 for the package ${name} without a JSON body` }
	}
	return { kind: 'unclear', reason: `the registry answered HTTP ${status} for the package ${name}` }
}

/** Compares the registry's integrity with the local tarball's; only ever informative. */
export function integrityNote(registry: string | null, local: string | null) {
	if (registry === null || local === null)
		return 'integrity not compared'
	return registry === local ? 'same integrity as the local tarball' : 'registry integrity differs from the local tarball; a rebuild is not guaranteed to be byte-identical, so this does not stop the skip'
}

/**
 * What is wrong with a packed `package.json`, or `null`. Pure. The release must never publish a manifest
 * whose name or version is not the package's, or that still carries a `workspace:` range (a dependent's
 * Core peer must have been packed as `^<version>`).
 */
export function packedManifestProblem(manifest: unknown, expected: { name: string, version: string, corePeer: boolean }): string | null {
	if (typeof manifest !== 'object' || manifest === null)
		return 'the packed package.json is not an object'
	const { name, version, peerDependencies, dependencies, devDependencies, optionalDependencies } = manifest as Record<string, unknown>
	if (name !== expected.name)
		return `the packed package.json names ${String(name)}, expected ${expected.name}`
	if (version !== expected.version)
		return `the packed package.json is version ${String(version)}, expected ${expected.version}`
	for (const [section, value] of Object.entries({ dependencies, devDependencies, peerDependencies, optionalDependencies })) {
		if (typeof value !== 'object' || value === null)
			continue
		for (const [dependency, range] of Object.entries(value)) {
			if (typeof range === 'string' && range.startsWith('workspace:'))
				return `the packed ${section} still has the workspace range ${dependency}@${range}`
		}
	}
	if (expected.corePeer) {
		const peer = (peerDependencies as Record<string, unknown> | undefined)?.['@deviltea/widget-core']
		if (peer !== `^${expected.version}`)
			return `the packed @deviltea/widget-core peer range is ${String(peer)}, expected ^${expected.version}`
	}
	return null
}

export interface PublishDependencies {
	/** Asks the registry about one exact version. Must not throw: a failed question is an `unclear` answer. */
	lookup: (pkg: ReleasePackage) => Promise<RegistryAnswer>
	/** Runs `npm publish` for the tarball. */
	publish: (pkg: ReleasePackage, distTag: 'latest' | 'next') => Promise<{ ok: boolean }>
	/** The SRI integrity (`sha512-...`) of the local tarball, or `null` when it cannot be computed. */
	localIntegrity: (pkg: ReleasePackage) => string | null
	sleep: (milliseconds: number) => Promise<void>
	log: (line: string) => void
}

export interface PublishOptions {
	dryRun: boolean
	/** How often the registry is asked after a failed `npm publish` whether the version is there after all. */
	recheckAttempts: number
	recheckIntervalMs: number
}

export type PublishStatus = 'skipped' | 'published' | 'published-despite-error' | 'would-publish'

export interface PublishOutcome {
	id: string
	status: PublishStatus
}

export class PublishError extends Error {
	constructor(message: string, readonly outcomes: readonly PublishOutcome[]) {
		super(message)
		this.name = 'PublishError'
	}
}

function label(pkg: ReleasePackage) {
	return `${pkg.name}@${pkg.version}`
}

/**
 * Publishes `packages` in `publishOrder` order. Nothing is published unless the registry gave a clear answer
 * for every package and every package already exists on the registry, so an unclear answer, or a package that
 * Trusted Publishing cannot create, stops the run before the first publish. A dependent is only published once
 * the packages before it (Core) were published now or found published already; the first failure stops the run
 * and the outcomes so far are on the error.
 */
export async function runPublish(packages: readonly ReleasePackage[], deps: PublishDependencies, options: PublishOptions): Promise<PublishOutcome[]> {
	const ordered = [...packages].sort((a, b) => publishOrder.indexOf(a.id) - publishOrder.indexOf(b.id))
	const outcomes: PublishOutcome[] = []

	const answers = new Map<string, RegistryAnswer>()
	const missing: ReleasePackage[] = []
	for (const pkg of ordered) {
		const answer = await deps.lookup(pkg)
		if (answer.kind === 'unclear')
			throw new PublishError(`Cannot tell whether ${label(pkg)} is on the registry: ${answer.reason}. Nothing was published; re-run the workflow.`, outcomes)
		if (answer.kind === 'missing-package')
			missing.push(pkg)
		answers.set(pkg.id, answer)
		deps.log(`${label(pkg)}: ${answer.kind === 'published' ? 'already on the registry' : answer.kind === 'missing-package' ? 'the package does not exist on the registry' : 'not on the registry'}.`)
	}
	if (missing.length > 0) {
		const names = missing.map(pkg => pkg.name)
			.join(', ')
		throw new PublishError(`${names} ${missing.length === 1 ? 'does' : 'do'} not exist on the registry, and npm Trusted Publishing cannot create a package. Publish a 0.0.0 placeholder of each by hand and configure its Trusted Publisher (repository DevilTea/widget, workflow publish.yml), as ${PACKAGE_CREATION_GUIDE} describes, then re-run the workflow. Nothing was published.`, outcomes)
	}

	for (const pkg of ordered) {
		const answer = answers.get(pkg.id)!
		if (answer.kind === 'published') {
			deps.log(`${label(pkg)} is already published, skipping (${integrityNote(answer.integrity, deps.localIntegrity(pkg))}).`)
			outcomes.push({ id: pkg.id, status: 'skipped' })
			continue
		}

		const distTag = distTagFor(pkg.version)
		if (options.dryRun) {
			deps.log(`Dry run: would publish ${label(pkg)} with dist-tag ${distTag} from ${pkg.tarball}.`)
			outcomes.push({ id: pkg.id, status: 'would-publish' })
			continue
		}

		deps.log(`Publishing ${label(pkg)} with dist-tag ${distTag}.`)
		if ((await deps.publish(pkg, distTag)).ok) {
			deps.log(`Published ${label(pkg)}.`)
			outcomes.push({ id: pkg.id, status: 'published' })
			continue
		}

		// `npm publish` can fail after the registry accepted the version (a dropped connection), and a stale
		// "absent" answer makes a version that is already there look unpublished. Ask again for a while.
		let found = false
		for (let attempt = 1; attempt <= options.recheckAttempts && !found; attempt++) {
			if (attempt > 1)
				await deps.sleep(options.recheckIntervalMs)
			found = (await deps.lookup(pkg)).kind === 'published'
		}
		if (!found)
			throw new PublishError(`npm publish failed for ${label(pkg)} and the registry does not have that version. Nothing after ${pkg.id} in the publish order was published; fix the cause and re-run the workflow, which skips what is already published.`, outcomes)
		deps.log(`npm publish reported a failure for ${label(pkg)}, but the registry has that exact version: treating it as published.`)
		outcomes.push({ id: pkg.id, status: 'published-despite-error' })
	}

	return outcomes
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text)
	}
	catch {
		return undefined
	}
}

/** One HTTP GET against the registry: the status and the body parsed as JSON (`undefined` when it is not JSON). */
export type RegistryRequest = (url: string, accept: string) => Promise<{ status: number, body: unknown }>

async function fetchRegistry(url: string, accept: string): Promise<{ status: number, body: unknown }> {
	const response = await fetch(url, {
		headers: { 'accept': accept, 'cache-control': 'no-cache' },
		signal: AbortSignal.timeout(20_000),
	})
	return { status: response.status, body: parseJson(await response.text()) }
}

export interface LookupOptions {
	/** The HTTP GET; `fetch` against the public registry unless a test passes a fake. */
	request?: RegistryRequest
	attempts?: number
	delayMs?: number
}

/**
 * Asks the registry about one version (`GET /<name>/<version>`, which is not served from the cached package
 * document that lags behind a publish). When that version is not there, asks for the package document
 * (`GET /<name>`, abbreviated) to tell "the package exists" from "the package does not exist", by status and
 * document rather than by the wording of the `404`. Each question gets a few attempts on a network error, `429`
 * or `5xx`, then is `unclear`.
 */
export async function lookupRegistry(pkg: ReleasePackage, { request = fetchRegistry, attempts = 4, delayMs = 2000 }: LookupOptions = {}): Promise<RegistryAnswer> {
	const ask = async (url: string, accept: string, interpret: (status: number, body: unknown) => RegistryAnswer): Promise<RegistryAnswer> => {
		let answer: RegistryAnswer = { kind: 'unclear', reason: 'no attempt was made' }
		for (let attempt = 1; attempt <= attempts; attempt++) {
			if (attempt > 1)
				await new Promise(done => setTimeout(done, delayMs * (attempt - 1)))
			try {
				const { status, body } = await request(url, accept)
				answer = interpret(status, body)
				if (status !== 429 && status < 500)
					return answer
			}
			catch (error) {
				answer = { kind: 'unclear', reason: `the registry could not be reached (${error instanceof Error ? error.message : String(error)})` }
			}
		}
		return answer
	}

	const versionAnswer = await ask(registryVersionUrl(pkg.name, pkg.version), 'application/json', (status, body) => interpretRegistryResponse(pkg.name, pkg.version, status, body))
	if (versionAnswer.kind !== 'absent')
		return versionAnswer
	return ask(registryPackageUrl(pkg.name), 'application/vnd.npm.install-v1+json', (status, body) => interpretPackageResponse(pkg.name, pkg.version, status, body))
}

export function tarballIntegrity(path: string) {
	if (!existsSync(path))
		return null
	return `sha512-${createHash('sha512')
		.update(readFileSync(path))
		.digest('base64')}`
}

function readPackedManifest(tarball: string): unknown {
	const result = spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' })
	if (result.status !== 0)
		fail(`Cannot read package/package.json from ${tarball}: ${result.stderr}`)
	return JSON.parse(result.stdout)
}

function releasePackages(tarballDirectory: string): ReleasePackage[] {
	const version = assertUnifiedVersion()
	return publishOrder.map((id) => {
		const entry = packageEntry(id)
		return { id, name: entry.name, version: packageVersion(id), tarball: resolve(tarballDirectory, tarballName(entry.name, version)) }
	})
}

function assertPackedManifests(packages: readonly ReleasePackage[]) {
	for (const pkg of packages) {
		if (!existsSync(pkg.tarball))
			fail(`Missing tarball ${pkg.tarball} for ${label(pkg)}.`)
		const problem = packedManifestProblem(readPackedManifest(pkg.tarball), { name: pkg.name, version: pkg.version, corePeer: pkg.id !== 'widget-core' })
		if (problem !== null)
			fail(`${label(pkg)}: ${problem}.`)
	}
}

function option(name: string) {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}

async function runCli() {
	const command = process.argv[2]
	const directory = command === 'pack' ? option('--out') : option('--tarballs')
	if ((command !== 'pack' && command !== 'publish') || directory === undefined)
		fail('Usage: release-publish.ts pack --out <dir> | publish --tarballs <dir> [--dry-run]')

	const packages = releasePackages(directory)

	if (command === 'pack') {
		mkdirSync(directory, { recursive: true })
		for (const pkg of packages) {
			const result = spawnSync('pnpm', ['--dir', packageEntry(pkg.id).directory, 'pack', '--pack-destination', directory], { cwd: workspaceRoot, stdio: 'inherit' })
			if (result.status !== 0)
				fail(`pnpm pack failed for ${label(pkg)}.`)
		}
		assertPackedManifests(packages)
		console.log(`Packed ${packages.map(label)
			.join(', ')} into ${directory}.`)
		return
	}

	assertPackedManifests(packages)
	const outcomes = await runPublish(packages, {
		lookup: pkg => lookupRegistry(pkg),
		publish: async (pkg, distTag) => {
			// A prerelease must never take the default `latest` dist-tag; a stable release keeps npm's default.
			const args = ['publish', pkg.tarball, '--access', 'public', '--provenance', ...(distTag === 'next' ? ['--tag', 'next'] : [])]
			const result = spawnSync('npm', args, { cwd: workspaceRoot, stdio: 'inherit' })
			return { ok: result.status === 0 }
		},
		localIntegrity: pkg => tarballIntegrity(pkg.tarball),
		sleep: milliseconds => new Promise(done => setTimeout(done, milliseconds)),
		log: line => console.log(line),
	}, { dryRun: process.argv.includes('--dry-run'), recheckAttempts: 13, recheckIntervalMs: 5000 })
	console.log(outcomes.map(outcome => `${outcome.id}: ${outcome.status}`)
		.join('\n'))
}

const entrypoint = process.argv[1]
if (entrypoint != null && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
	runCli()
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error))
			process.exit(1)
		})
}
