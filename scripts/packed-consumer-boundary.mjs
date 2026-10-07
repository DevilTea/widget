/** Verifies the installed `@deviltea/widget-inspector` tarball exposes exactly its accepted public subpaths. */
import process from 'node:process'

const publicSubpaths = ['agent', 'anchor', 'channel', 'client', 'frame-bootstrap', 'protocol', 'transport', 'value']
const unexported = [
	'',
	'/geometry',
	'/overlay',
	'/projection',
	'/test-fixture',
	'/validation',
	'/dist/agent.mjs',
	'/package.json',
]

for (const name of publicSubpaths) {
	const namespace = await import(`@deviltea/widget-inspector/${name}`)
	if (Object.keys(namespace).length === 0)
		throw new Error(`Public subpath @deviltea/widget-inspector/${name} exported nothing at runtime.`)
}

for (const subpath of unexported) {
	const specifier = `@deviltea/widget-inspector${subpath}`
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

process.stdout.write(`Packed Inspector boundary passed: ${publicSubpaths.length} public subpaths import, ${unexported.length} internal paths are rejected.\n`)
