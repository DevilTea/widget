import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

const packages = {
	'widget-core': {
		directory: 'packages/core',
		name: '@deviltea/widget-core',
	},
	'widget-vue': {
		directory: 'packages/vue',
		name: '@deviltea/widget-vue',
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

export function packageTag(id: string) {
	return `${id}@${packageVersion(id)}`
}

export function verifyTag(tag: string) {
	const separator = tag.lastIndexOf('@')
	if (separator <= 0)
		fail(`Invalid release tag: ${tag}`)
	const id = tag.slice(0, separator)
	const version = tag.slice(separator + 1)
	const currentVersion = packageVersion(id)
	if (version !== currentVersion)
		fail(`Tag ${tag} does not match ${id}@${currentVersion}`)
	return id
}

function runCli() {
	const [command, value] = process.argv.slice(2)
	if (!command || !value)
		fail('Usage: release-package.ts <package-path|package-name|version|tag|verify-tag> <value>')
	switch (command) {
		case 'package-path':
			console.log(packageEntry(value).directory)
			break
		case 'package-name':
			console.log(packageEntry(value).name)
			break
		case 'version':
			console.log(packageVersion(value))
			break
		case 'tag':
			console.log(packageTag(value))
			break
		case 'verify-tag':
			console.log(verifyTag(value))
			break
		default: fail(`Unknown command: ${command}`)
	}
}

const entrypoint = process.argv[1]
if (entrypoint != null && resolve(entrypoint) === fileURLToPath(import.meta.url))
	runCli()
