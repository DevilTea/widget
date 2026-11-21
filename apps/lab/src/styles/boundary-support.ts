import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Test-only helpers shared by the Lab's boundary tests (`styling-boundary`, `showcase-isolation`, `shell-isolation`). */

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

export interface References {
	/** Every module, stylesheet or asset the source refers to by a literal path, in the form a bundler would resolve it. */
	readonly specifiers: string[]
	/** Constructs whose target cannot be known from the text (`import(\`${x}\`)`, `import.meta.glob`, ...). A guard fails closed on them. */
	readonly opaque: string[]
}

/** `url(x)` targets that never leave the document: inlined data, fragments, and the like. */
const INERT_URL = /^(?:data:|#|about:|blob:)/i

/** A CSS resource target as a bundler resolves it: an unquoted or bare target is relative to the stylesheet. */
function cssTarget(target: string): string {
	return /^(?:\.{1,2}\/|[/~@]|[a-z][a-z0-9+.-]*:)/i.test(target) ? target : `./${target}`
}

/** The text between the parenthesis that opens at `open` and its match, or the rest of the source when it never closes. */
function parenthesised(source: string, open: number): string {
	let depth = 0
	for (let index = open; index < source.length; index++) {
		if (source[index] === '(')
			depth++
		else if (source[index] === ')' && --depth === 0)
			return source.slice(open + 1, index)
	}
	return source.slice(open + 1)
}

/**
 * Every way a source file (TypeScript, a Vue SFC or CSS) can pull in another file, as far as text shows it:
 *
 * - static `import ... from`, side-effect `import '...'`, `export ... from`, and `import('...')` with a literal
 * - CSS `@import 'x'`, `@import url(x)` (quoted or not) and any other `url(x)`
 * - SFC `<script src>`, `<style src>`, `<template src>`, and `src`/`href`/`poster` attributes with a relative, alias or absolute path
 * - `new URL('x', import.meta.url)`
 *
 * and, as `opaque`, the ones it cannot resolve: a dynamic `import()` whose argument is not a plain literal (a template with a
 * substitution, a variable, a concatenation), `import.meta.glob`, any other use of `import.meta.url`, and `require(`.
 * Comments are not stripped: a string like `'**` + `/*.vue'` would otherwise hide code, so a comment that merely looks like
 * an import is reported too and should be reworded.
 */
export function referencesOf(source: string): References {
	const specifiers: string[] = []
	const opaque: string[] = []

	// `from`/`import` as a keyword only: not the tail of a member or attribute value (`transfer.from"`, `data-from`), and
	// not a bare identifier that opens a quoted attribute value or string (`:x="from"`, `'from'`): a keyword never follows a quote.
	for (const match of source.matchAll(/(?:(?<![.$\w'"-])from\s*|(?<![.$\w'"-])import\s*)(['"])([^'"]+)\1/g))
		specifiers.push(match[2]!)

	// `import(...)`: literal specifiers only (a template without `${` counts as a literal); every other `import(` is opaque.
	const dynamicImports = [...source.matchAll(/\bimport\s*\(/g)].length
	let literalDynamicImports = 0
	for (const match of source.matchAll(/\bimport\s*\(\s*(['"`])([^'"`$\\]*)\1\s*[,)]/g)) {
		specifiers.push(match[2]!)
		literalDynamicImports++
	}
	if (dynamicImports > literalDynamicImports)
		opaque.push(`${dynamicImports - literalDynamicImports} dynamic import() with a non-literal specifier`)

	if (/\bimport\.meta\.glob(?:Eager)?\b/.test(source))
		opaque.push('import.meta.glob')
	if (/\brequire\s*\(/.test(source))
		opaque.push('require()')

	const metaUrls = [...source.matchAll(/\bimport\.meta\.url\b/g)].length
	let literalUrls = 0
	for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*(['"`])([^'"`$\\]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
		specifiers.push(match[2]!)
		literalUrls++
	}
	if (metaUrls > literalUrls)
		opaque.push('import.meta.url outside new URL(\'literal\', import.meta.url)')

	// CSS: `@import 'x'`, `@import url(x)`, `url(x)`; unquoted targets are relative to the stylesheet.
	for (const match of source.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/g))
		specifiers.push(match[2]!)
	for (const match of source.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s)][^)\s]*))\s*\)/g)) {
		const target = (match[1] ?? match[2] ?? match[3] ?? '').trim()
		if (INERT_URL.test(target))
			continue
		specifiers.push(cssTarget(target))
	}
	// `image-set()` takes plain strings as image targets, with no `url()` around them.
	for (const match of source.matchAll(/(?:-webkit-)?image-set\(/g)) {
		for (const target of parenthesised(source, match.index + match[0].length - 1)
			.matchAll(/(["'])([^"']+)\1/g)) {
			if (!INERT_URL.test(target[2]!))
				specifiers.push(cssTarget(target[2]!))
		}
	}
	// Preprocessor stylesheets and their module systems resolve files the text does not name plainly: fail closed.
	if (/<style\b[^>]*\slang\s*=\s*["']?(?:scss|sass|less|styl|stylus)\b/.test(source))
		opaque.push('a <style> block in a CSS preprocessor language (scss, sass, less, stylus)')
	if (/@(?:use|forward)\s/.test(source))
		opaque.push('a Sass @use/@forward')

	// SFC blocks with `src`, and template asset attributes that Vue turns into imports.
	for (const match of source.matchAll(/<(?:script|style|template)\b[^>]*?\ssrc\s*=\s*(['"])([^'"]+)\1/g))
		specifiers.push(match[2]!)
	for (const match of source.matchAll(/\b(?:src|href|poster)\s*=\s*(['"])((?:\.{1,2}\/|\/|~|@\/)[^'"]*)\1/g))
		specifiers.push(match[2]!)

	return { specifiers: [...new Set(specifiers)], opaque }
}

/** Every module/stylesheet/asset specifier a file refers to (see `referencesOf`). */
export function specifiersOf(source: string): string[] {
	return referencesOf(source).specifiers
}
