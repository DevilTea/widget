/**
 * Verifies the Agent Skills the packages ship: `@deviltea/widget-core` ships exactly `skills/widget-plugin-authoring`
 * and `@deviltea/widget-vue` exactly `skills/widget-vue-renderer`, the Inspector and the documentation generator ship
 * none. Each skill is `skills/<name>/SKILL.md` (the layout `npx skills experimental_sync` reads from `node_modules`)
 * with frontmatter whose `name` is the folder's name and whose `description` is a non-empty JSON double-quoted
 * string (the one spelling accepted, see `readFrontmatter`), and every
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

/**
 * The frontmatter of a package skill, held to one spelling that is always valid YAML: exactly the lines
 * `name: <lowercase letters, digits and hyphens>` and `description: "<one JSON double-quoted string>"`, the spelling the
 * generator writes. The `skills` CLI parses the frontmatter as YAML and skips a skill it cannot parse, so a looser
 * spelling (a plain scalar holding `: `, a block scalar) could pass here and then silently not install.
 */
function readFrontmatter(text) {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
	if (match === null)
		return { fields: {}, problems: ['has no frontmatter block (`---` lines)'] }
	const fields = {}
	const problems = []
	for (const line of match[1].split('\n')) {
		const name = /^name: ([a-z0-9-]+)$/.exec(line)
		const description = /^description: (".*")$/.exec(line)
		if (name !== null && !('name' in fields)) {
			fields.name = name[1]
			continue
		}
		if (description !== null && !('description' in fields)) {
			try {
				const value = JSON.parse(description[1])
				if (typeof value === 'string') {
					fields.description = value
					continue
				}
			}
			catch {}
		}
		problems.push(`has a frontmatter line other than \`name: <lowercase-kebab>\` and \`description: "<JSON string>"\`: ${line}`)
	}
	return { fields, problems }
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
		const { fields: frontmatter, problems: frontmatterProblems } = readFrontmatter(text)
		for (const problem of frontmatterProblems)
			problems.push(`${manifest.name}: skills/${name}/SKILL.md ${problem}`)
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
