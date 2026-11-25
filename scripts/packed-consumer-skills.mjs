/**
 * Verifies the Agent Skills the packages ship: `@deviltea/widget-core` ships exactly `skills/widget-plugin-authoring`
 * and `@deviltea/widget-vue` exactly `skills/widget-vue-renderer`, the Inspector and the documentation generator ship
 * none. Each skill is `skills/<name>/SKILL.md` (the layout `npx skills experimental_sync` reads from `node_modules`)
 * with frontmatter whose `name` is the folder's name and whose `description` is not empty, and every
 * `references/<file>` its `SKILL.md` names exists beside it.
 *
 * Usage: `node packed-consumer-skills.mjs [<package directory>...]`. Without arguments it checks the four packages
 * installed in `./node_modules` (the CI consumer of the packed tarballs); `scripts/package-skills.unit.test.ts` passes
 * the workspace package directories. Exits with 1 and one line per problem when a check fails.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const expectedSkills = {
	'@deviltea/widget-core': ['widget-plugin-authoring'],
	'@deviltea/widget-vue': ['widget-vue-renderer'],
	'@deviltea/widget-inspector': [],
	'@deviltea/widget-docs-generator': [],
}

/** The `key: value` lines of a YAML frontmatter block; a value may be a JSON string, a single-quoted string or plain. */
function readFrontmatter(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
	if (match === null)
		return null
	const fields = {}
	for (const line of match[1].split(/\r?\n/)) {
		const entry = /^([\w-]+):(.*)$/.exec(line)
		if (entry === null)
			continue
		let value = entry[2].trim()
		if (value.startsWith('"')) {
			try {
				value = JSON.parse(value)
			}
			catch {
				return null
			}
		}
		else if (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2) {
			value = value.slice(1, -1)
				.replaceAll('\'\'', '\'')
		}
		fields[entry[1]] = value
	}
	return fields
}

function checkPackage(directory) {
	const problems = []
	const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
	const expected = expectedSkills[manifest.name]
	if (expected === undefined)
		return [`${directory}: ${manifest.name} is not a package this check knows`]
	const skillsDirectory = join(directory, 'skills')
	const found = existsSync(skillsDirectory)
		? readdirSync(skillsDirectory, { withFileTypes: true })
				.filter(entry => entry.isDirectory())
				.map(entry => entry.name)
				.sort()
		: []
	if (JSON.stringify(found) !== JSON.stringify([...expected].sort()))
		problems.push(`${manifest.name}: ships the skills ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`)
	if (expected.length > 0 && Array.isArray(manifest.files) && !manifest.files.includes('skills'))
		problems.push(`${manifest.name}: package.json "files" does not list "skills"`)
	for (const name of found) {
		const skillFile = join(skillsDirectory, name, 'SKILL.md')
		if (!existsSync(skillFile) || !statSync(skillFile)
			.isFile()) {
			problems.push(`${manifest.name}: skills/${name}/SKILL.md is missing`)
			continue
		}
		const text = readFileSync(skillFile, 'utf8')
		const frontmatter = readFrontmatter(text)
		if (frontmatter === null) {
			problems.push(`${manifest.name}: skills/${name}/SKILL.md has no readable frontmatter`)
			continue
		}
		if (frontmatter.name !== name)
			problems.push(`${manifest.name}: skills/${name}/SKILL.md names itself ${JSON.stringify(frontmatter.name)}, expected ${JSON.stringify(name)}`)
		if (typeof frontmatter.description !== 'string' || frontmatter.description.trim() === '')
			problems.push(`${manifest.name}: skills/${name}/SKILL.md has no description`)
		for (const [, reference] of text.matchAll(/`(references\/[\w.-]+)`/g)) {
			if (!existsSync(join(skillsDirectory, name, reference)))
				problems.push(`${manifest.name}: skills/${name}/SKILL.md names ${reference}, which is missing`)
		}
	}
	return problems
}

const directories = process.argv.length > 2
	? process.argv.slice(2)
			.map(directory => resolve(directory))
	: Object.keys(expectedSkills)
			.map(name => resolve('node_modules', name))
const problems = directories.flatMap(checkPackage)
if (problems.length > 0) {
	console.error(problems.join('\n'))
	process.exit(1)
}
console.log(`skills verified: ${directories.length} packages`)
