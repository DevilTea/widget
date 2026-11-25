/**
 * Verifies the installed `@deviltea/widget-inspector`, `@deviltea/widget-vue` and `@deviltea/widget-docs-generator`
 * tarballs expose exactly their accepted public subpaths, that each declares `@deviltea/widget-core` as a peer, and
 * that the generator's `./runtime` entry reaches no build-time module.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const boundaries = [
	{
		name: '@deviltea/widget-inspector',
		publicSubpaths: ['/agent', '/anchor', '/channel', '/client', '/frame-bootstrap', '/protocol', '/transport', '/value'],
		unexported: [
			'',
			'/geometry',
			'/overlay',
			'/projection',
			'/test-fixture',
			'/validation',
			'/dist/agent.mjs',
			'/package.json',
		],
	},
	{
		name: '@deviltea/widget-vue',
		publicSubpaths: ['', '/testing'],
		unexported: [
			'/context',
			'/runtime-guard',
			'/renderer',
			'/dist/index.mjs',
			'/dist/testing.mjs',
			'/package.json',
		],
	},
	{
		name: '@deviltea/widget-docs-generator',
		// `./virtual-widget-docs` and `./virtual-widget-docs-slim` are declaration-only (`types`, no `import`): they
		// are checked by `packed-consumer-types.mts`, and at run time they resolve to nothing.
		publicSubpaths: ['', '/docs', '/runtime', '/vite'],
		typeOnlySubpaths: ['/virtual-widget-docs', '/virtual-widget-docs-slim'],
		unexported: [
			'/virtual-widget-docs',
			'/virtual-widget-docs-slim',
			'/cli',
			'/runtime-facts',
			'/runtime-worker',
			'/flat',
			'/extract',
			'/docs-cache',
			'/docs-types',
			'/dist/index.mjs',
			'/dist/cli.mjs',
			'/dist/runtime-facts.mjs',
			'/dist/runtime-worker.mjs',
			'/src/index.ts',
			'/fixtures/survey-system.ts',
			'/package.json',
		],
	},
]

/** The installed root of a package in this consumer. */
function packageRoot(name) {
	return fileURLToPath(new URL(`./node_modules/${name}/`, import.meta.url))
}

let publicCount = 0
let internalCount = 0
for (const { name, publicSubpaths, typeOnlySubpaths = [], unexported } of boundaries) {
	// The manifest names exactly these subpaths: a new one has to be added here (and to the docs) on purpose.
	const exported = Object.keys(JSON.parse(readFileSync(join(packageRoot(name), 'package.json'), 'utf8')).exports)
		.sort()
	const expected = [...publicSubpaths, ...typeOnlySubpaths].map(subpath => `.${subpath}`)
		.sort()
	if (exported.join() !== expected.join())
		throw new Error(`Expected ${name} to export exactly ${expected.join(', ')}, got: ${exported.join(', ')}`)

	for (const subpath of publicSubpaths) {
		const namespace = await import(`${name}${subpath}`)
		if (Object.keys(namespace).length === 0)
			throw new Error(`Public subpath ${name}${subpath} exported nothing at runtime.`)
		publicCount++
	}

	for (const subpath of unexported) {
		const specifier = `${name}${subpath}`
		try {
			await import(specifier)
		}
		catch (error) {
			if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED')
				continue
			throw new Error(`Expected ${specifier} to be rejected as not exported, got: ${error}`)
		}
		throw new Error(`Expected ${specifier} not to be importable, but it resolved.`)
	}
	internalCount += unexported.length
}

// `/testing` must never leak the private widget-context injection key.
const testing = await import('@deviltea/widget-vue/testing')
if (Object.keys(testing)
	.join() !== 'createWidgetTestHost') {
	throw new Error(`Expected @deviltea/widget-vue/testing to export only createWidgetTestHost, got: ${Object.keys(testing)
		.join()}`)
}

// Core must be a peer, resolved once: a nested second copy would make the Vue adapter reject the host's Runtime, and
// the generator's `inspectPlugin` reject the System's plugins.
const coreVersion = JSON.parse(readFileSync(join(packageRoot('@deviltea/widget-core'), 'package.json'), 'utf8')).version
const dependents = ['@deviltea/widget-inspector', '@deviltea/widget-vue', '@deviltea/widget-docs-generator']
for (const name of dependents) {
	const root = packageRoot(name)
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	if (manifest.dependencies?.['@deviltea/widget-core'] !== undefined)
		throw new Error(`${name} must not list @deviltea/widget-core under dependencies.`)
	if (manifest.peerDependencies?.['@deviltea/widget-core'] !== `^${coreVersion}`)
		throw new Error(`${name} must list @deviltea/widget-core as the peerDependency ^${coreVersion}, got ${manifest.peerDependencies?.['@deviltea/widget-core']}.`)
	if (existsSync(join(root, 'node_modules/@deviltea/widget-core')))
		throw new Error(`${name} resolved a nested copy of @deviltea/widget-core instead of the consumer's.`)
}

// The generator's `./runtime` is what an application bundles: its installed chunk graph must reach no module outside
// the package (no `typescript`, no `tsx`, no `node:` builtin such as `node:worker_threads`). A static walk of the
// import specifiers is enough: the chunks are plain ES modules.
function specifiersOf(file) {
	const code = readFileSync(file, 'utf8')
	return [...code.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
		.map(match => match[1] ?? match[2] ?? match[3])
}
function chunkGraph(entry) {
	const files = new Set()
	const external = new Set()
	const visit = (file) => {
		if (files.has(file))
			return
		files.add(file)
		for (const specifier of specifiersOf(file)) {
			if (specifier.startsWith('./') || specifier.startsWith('../'))
				visit(resolve(dirname(file), specifier))
			else
				external.add(specifier)
		}
	}
	visit(entry)
	return { files, external: [...external].sort() }
}
const runtimeEntry = fileURLToPath(import.meta.resolve('@deviltea/widget-docs-generator/runtime'))
const runtimeGraph = chunkGraph(runtimeEntry)
if (runtimeGraph.external.length > 0)
	throw new Error(`@deviltea/widget-docs-generator/runtime must import nothing outside the package, but its chunks import: ${runtimeGraph.external.join(', ')}`)
// The walk does see externals: the build-time entry reaches TypeScript and the worker threads.
const buildTimeGraph = chunkGraph(fileURLToPath(import.meta.resolve('@deviltea/widget-docs-generator')))
for (const specifier of ['typescript', 'node:worker_threads']) {
	if (!buildTimeGraph.external.includes(specifier))
		throw new Error(`The chunk walk no longer sees ${specifier} in the build-time entry; it cannot vouch for ./runtime.`)
}

process.stdout.write(`Packed package boundaries passed: ${publicCount} public subpaths import, ${internalCount} internal paths are rejected, ${dependents.length} dependents peer core ^${coreVersion}, the generator's ./runtime reaches ${runtimeGraph.files.size} files and no external module.\n`)
