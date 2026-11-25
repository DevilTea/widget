import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { workspaceRoot } from './release-package'

const check = fileURLToPath(new URL('./packed-consumer-skills.mjs', import.meta.url))
const packageDirectories = ['core', 'vue', 'inspector', 'docs-generator'].map(name => join(workspaceRoot, 'packages', name))
const skillFiles = {
	core: join(workspaceRoot, 'packages/core/skills/widget-plugin-authoring'),
	vue: join(workspaceRoot, 'packages/vue/skills/widget-vue-renderer'),
}
const read = (path: string) => readFileSync(path, 'utf8')

function markdownFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true, recursive: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.md'))
		.map(entry => join(entry.parentPath, entry.name))
}

describe('the skills the packages ship', () => {
	it('are skills/<name>/SKILL.md with a matching name and a description, in Core and Vue only (the check CI runs on the tarballs)', () => {
		const output = execFileSync(process.execPath, [check, ...packageDirectories], { encoding: 'utf8' })
		expect(output.trim())
			.toBe('skills verified: 4 packages')
	})

	it('the check names a wrong name, an empty description, a missing reference and a package.json that does not publish them', () => {
		const root = mkdtempSync(join(tmpdir(), 'widget-package-skills-'))
		try {
			const skill = join(root, 'skills/widget-plugin-authoring')
			mkdirSync(join(skill, 'references'), { recursive: true })
			writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deviltea/widget-core', files: ['dist'] }))
			writeFileSync(join(skill, 'SKILL.md'), '---\nname: plugin-authoring\ndescription: ""\n---\n\nSee `references/missing.md`.\n')
			const result = spawnSync(process.execPath, [check, root], { encoding: 'utf8' })
			expect(result.status)
				.toBe(1)
			expect(result.stderr.trim()
				.split('\n'))
				.toEqual([
					'@deviltea/widget-core: package.json "files" does not list "skills"',
					'@deviltea/widget-core: skills/widget-plugin-authoring/SKILL.md names itself "plugin-authoring", expected "widget-plugin-authoring"',
					'@deviltea/widget-core: skills/widget-plugin-authoring/SKILL.md has no description',
					'@deviltea/widget-core: skills/widget-plugin-authoring/SKILL.md names references/missing.md, which is missing',
				])
		}
		finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	// The `skills` CLI parses the frontmatter as YAML and skips a skill it cannot parse, so a spelling it may reject has
	// to fail here: an unquoted value holding `: ` is invalid YAML, and a block scalar is not a description on one line.
	it.each([
		['an unquoted description that holds a colon', 'description: Write a plugin: the Interfaces', ['description: Write a plugin: the Interfaces']],
		['a block scalar', 'description: |\n  Write a plugin.', ['description: |', '  Write a plugin.']],
		['a single-quoted description', 'description: \'Write a plugin.\'', ['description: \'Write a plugin.\'']],
	])('the check refuses %s, which the skills CLI may not parse', (_label, line, rejected) => {
		const root = mkdtempSync(join(tmpdir(), 'widget-package-skills-'))
		try {
			const skill = join(root, 'skills/widget-plugin-authoring')
			mkdirSync(skill, { recursive: true })
			writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deviltea/widget-core', files: ['dist', 'skills'] }))
			writeFileSync(join(skill, 'SKILL.md'), `---\nname: widget-plugin-authoring\n${line}\n---\n\n# Skill\n`)
			const result = spawnSync(process.execPath, [check, root], { encoding: 'utf8' })
			expect(result.status)
				.toBe(1)
			expect(result.stderr.trim()
				.split('\n'))
				.toEqual([
					...rejected.map(text => `@deviltea/widget-core: skills/widget-plugin-authoring/SKILL.md has a frontmatter line other than \`name: <lowercase-kebab>\` and \`description: "<JSON string>"\`: ${text}`),
					'@deviltea/widget-core: skills/widget-plugin-authoring/SKILL.md has no description',
				])
		}
		finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('are what skills.sh.json lists for `npx skills add`: every skills folder of a package, and nothing else', () => {
		const config = JSON.parse(read(join(workspaceRoot, 'skills.sh.json'))) as { $schema: string, paths: string[] }
		const containers = readdirSync(join(workspaceRoot, 'packages'))
			.filter(name => existsSync(join(workspaceRoot, 'packages', name, 'skills')))
			.map(name => `./packages/${name}/skills`)
		expect(config)
			.toEqual({ $schema: 'https://skills.sh/schemas/skills.sh.schema.json', paths: containers })
		expect(containers)
			.toEqual(['./packages/core/skills', './packages/vue/skills'])
	})

	it('describe the 0.4 builder in Core, and the useWidget() surface in Vue, without JSDoc, constraint tags or the generator\'s API', () => {
		const core = read(join(skillFiles.core, 'SKILL.md'))
		expect(core)
			.toContain('`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → reasons? → done`')
		expect(core)
			.toContain('**A failing Method is not rolled back.**')
		const coreAll = markdownFiles(skillFiles.core)
			.map(read)
			.join('\n')
		for (const term of ['.description(', '.events({', '.reasons({', 'WidgetRef<', 'WidgetContract<', 'WidgetChild', 'defineTypeDocs', 'defineFieldDocs', 'undocumented']) {
			expect(coreAll, term)
				.toContain(term)
		}
		const vue = read(join(skillFiles.vue, 'SKILL.md'))
		for (const term of ['createWidgetVueRenderer(system, renderers => renderers', 'returns the Method\'s value on success and `null` on failure', 'WidgetSlot', 'createWidgetTestHost', 'invalid-renderer-registry']) {
			expect(vue, term)
				.toContain(term)
		}
		for (const path of [...markdownFiles(skillFiles.core), ...markdownFiles(skillFiles.vue)]) {
			const text = read(path)
			expect(text, path).not.toContain('JSDoc')
			for (const tag of ['@minimum', '@pattern', '@widgetRef', '@remarks', '@param', '@returns', '@default'])
				expect(text, `${path} ${tag}`).not.toContain(tag)
			// The skills stand alone: they never tell a reader to import the generator.
			expect(text, path).not.toMatch(/from '@deviltea\/widget-docs-generator/)
		}
	})
})
