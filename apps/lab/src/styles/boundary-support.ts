import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Test-only helpers shared by the Lab's boundary tests (`styling-boundary`, `showcase-isolation`). */

export function listFiles(directory: string, files: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test-results' || entry.name === 'playwright-report')
			continue
		const path = join(directory, entry.name)
		if (entry.isDirectory())
			listFiles(path, files)
		else
			files.push(path)
	}
	return files
}

/** Every module/stylesheet specifier a file imports (static, side-effect, dynamic and CSS `@import`). */
export function specifiersOf(source: string): string[] {
	const found: string[] = []
	for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s+(?:url\()?)['"]([^'"]+)['"]/g))
		found.push(match[1]!)
	return found
}
