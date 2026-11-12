/**
 * Verifies the installed `@deviltea/widget-inspector` and `@deviltea/widget-vue` tarballs expose exactly their
 * accepted public subpaths, and that `@deviltea/widget-vue` declares `@deviltea/widget-core` as a peer.
 */
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

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
]

let publicCount = 0
let internalCount = 0
for (const { name, publicSubpaths, unexported } of boundaries) {
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

// Core must be a peer, resolved once: a nested second copy would make the Vue adapter reject the host's Runtime.
const vueRoot = new URL('./node_modules/@deviltea/widget-vue/', import.meta.url)
const vueManifest = JSON.parse(readFileSync(new URL('package.json', vueRoot), 'utf8'))
if (vueManifest.dependencies?.['@deviltea/widget-core'] !== undefined)
	throw new Error('@deviltea/widget-vue must not list @deviltea/widget-core under dependencies.')
if (typeof vueManifest.peerDependencies?.['@deviltea/widget-core'] !== 'string' || !vueManifest.peerDependencies['@deviltea/widget-core'].startsWith('^'))
	throw new Error('@deviltea/widget-vue must list @deviltea/widget-core as a caret-ranged peerDependency.')
if (existsSync(new URL('node_modules/@deviltea/widget-core', vueRoot)))
	throw new Error('@deviltea/widget-vue resolved a nested copy of @deviltea/widget-core instead of the consumer\'s.')

process.stdout.write(`Packed package boundaries passed: ${publicCount} public subpaths import, ${internalCount} internal paths are rejected, @deviltea/widget-vue peers core.\n`)
