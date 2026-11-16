import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Extraction of the marked code samples in the project's Markdown documentation.
 *
 * A sample is a fenced code block that is immediately preceded by a marker comment:
 *
 *     <!-- sample: <name> <kind> -->
 *
 * `kind` is `before` (written against the published 0.0.6, never compiled), `after` (type-checked against the
 * workspace packages), `run` (type-checked, executed, and its printed output compared with its comments) or
 * `skip` (a fragment that is deliberately not compiled). `before` and `skip` samples are only checked to exist:
 * a marker with a valid name and kind directly above a `ts` fence.
 * The colon after `sample` is optional, and the marker and the fence may be indented (a sample inside a list item).
 */

export const sampleKinds = ['before', 'after', 'run', 'skip'] as const
export type SampleKind = typeof sampleKinds[number]

export interface DocSample {
	/** Repository-relative path of the document. */
	document: string
	name: string
	kind: SampleKind
	/** The info string language of the fence, e.g. `ts`. */
	language: string
	/** 1-based line of the marker comment. */
	markerLine: number
	/** 1-based line of the first code line (the line after the opening fence). */
	codeLine: number
	/** The code with the fence indentation removed. */
	code: string
}

export interface FenceInfo {
	document: string
	/** 1-based line of the opening fence. */
	line: number
	language: string
}

export interface ExtractionResult {
	samples: DocSample[]
	/** Every fenced block in the document, marked or not. */
	fences: FenceInfo[]
	/** Opening-fence lines of TypeScript-family fences that carry no marker. */
	unmarkedScriptFences: FenceInfo[]
	/** Problems that make the markup untrustworthy: a malformed marker, a missing fence, a duplicate name. */
	problems: string[]
}

// Languages whose fences hold code this check is able to compile.
const scriptLanguages = new Set(['ts', 'typescript', 'mts', 'tsx', 'js', 'javascript', 'mjs'])
const sampleLanguages = new Set(['ts', 'typescript', 'mts'])

const markerPattern = /^(\s*)<!--\s*sample(:?)\s+([\w.-]+)\s+(\S+)\s*-->\s*$/
// A marker is a line of its own; a sentence that mentions the marker is prose.
const looseMarkerPattern = /^\s*<!--\s*sample\b/
const fencePattern = /^(\s*)(`{3,}|~{3,})(?![`~])(.*)$/
const languagePattern = /^\s*([\w+-]*)/

export function isScriptLanguage(language: string): boolean {
	return scriptLanguages.has(language.toLowerCase())
}

export function extractSamples(document: string, text: string): ExtractionResult {
	const lines = text.split('\n')
	const samples: DocSample[] = []
	const fences: FenceInfo[] = []
	const unmarkedScriptFences: FenceInfo[] = []
	const problems: string[] = []
	const seen = new Map<string, number>()
	let index = 0
	let pendingMarker: { line: number, name: string, kind: string } | null = null

	while (index < lines.length) {
		const line = lines[index]!
		const fence = fencePattern.exec(line)
		if (fence === null) {
			const marker = markerPattern.exec(line)
			if (marker !== null) {
				if (pendingMarker !== null)
					problems.push(`${document}:${pendingMarker.line}: marker "${pendingMarker.name}" is not followed by a code fence`)
				pendingMarker = { line: index + 1, name: marker[3]!, kind: marker[4]! }
			}
			else if (looseMarkerPattern.test(line)) {
				problems.push(`${document}:${index + 1}: malformed sample marker; expected \`<!-- sample: <name> <${sampleKinds.join('|')}> -->\`: ${line.trim()}`)
			}
			else if (pendingMarker !== null && line.trim() !== '') {
				problems.push(`${document}:${pendingMarker.line}: marker "${pendingMarker.name}" is not followed by a code fence`)
				pendingMarker = null
			}
			else if (pendingMarker !== null) {
				// A blank line between the marker and its fence detaches the marker.
				problems.push(`${document}:${pendingMarker.line}: marker "${pendingMarker.name}" must be on the line directly above its code fence`)
				pendingMarker = null
			}
			index++
			continue
		}

		const [, indent = '', ticks = '```', rest = ''] = fence
		const language = languagePattern.exec(rest)?.[1] ?? ''
		const openLine = index + 1
		let close = index + 1
		const closing = new RegExp(`^\\s*${ticks[0] === '`' ? '`' : '~'}{${ticks.length},}\\s*$`)
		while (close < lines.length && !closing.test(lines[close]!))
			close++
		if (close >= lines.length)
			problems.push(`${document}:${openLine}: code fence is never closed`)
		const fenceInfo: FenceInfo = { document, line: openLine, language }
		fences.push(fenceInfo)

		if (pendingMarker === null) {
			if (isScriptLanguage(language))
				unmarkedScriptFences.push(fenceInfo)
		}
		else {
			const { name, kind, line: markerLine } = pendingMarker
			pendingMarker = null
			if (!(sampleKinds as readonly string[]).includes(kind)) {
				problems.push(`${document}:${markerLine}: sample "${name}" has unknown kind "${kind}"; expected ${sampleKinds.join(', ')}`)
			}
			else if (!sampleLanguages.has(language.toLowerCase())) {
				problems.push(`${document}:${markerLine}: sample "${name}" must be a \`ts\` fence, found \`${language}\``)
			}
			else if (seen.has(name)) {
				problems.push(`${document}:${markerLine}: sample name "${name}" is already used at line ${seen.get(name)}`)
			}
			else {
				seen.set(name, markerLine)
				const code = lines.slice(index + 1, close)
					.map(codeLine => codeLine.startsWith(indent) ? codeLine.slice(indent.length) : codeLine.trimStart())
				samples.push({
					document,
					name,
					kind: kind as SampleKind,
					language,
					markerLine,
					codeLine: openLine + 1,
					code: `${code.join('\n')}\n`,
				})
			}
		}
		index = close + 1
	}
	if (pendingMarker !== null)
		problems.push(`${document}:${pendingMarker.line}: marker "${pendingMarker.name}" is not followed by a code fence`)
	return { samples, fences, unmarkedScriptFences, problems }
}

const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage'])

/**
 * Every Markdown document of the repository, as repository-relative paths, found by walking `root`. Hidden
 * directories (`.git`, `.github`, `.claude`, `.vitepress` caches) and build output are skipped. Searching instead
 * of listing documents means a sample added to any document, or to a new document, is checked without editing
 * the test.
 */
export function discoverDocuments(root: string): string[] {
	const found: string[] = []
	const walk = (directory: string) => {
		for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
			if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name))
				continue
			const path = directory === '' ? entry.name : `${directory}/${entry.name}`
			if (entry.isDirectory())
				walk(path)
			else if (entry.isFile() && entry.name.endsWith('.md'))
				found.push(path)
		}
	}
	walk('')
	return found.sort()
}

export function readDocument(root: string, document: string): string {
	return readFileSync(join(root, document), 'utf8')
}
