import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { resolveLabTheme } from './theme'

/** The inline first-paint script of `index.html` (the only script without `type` or `src`). */
function bootstrapScript(): string {
	const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
	const match = /<script>([\s\S]*?)<\/script>/.exec(html)
	if (match === null)
		throw new Error('index.html has no inline first-paint script')
	return match[1]!
}

interface Outcome { readonly attribute: string | null, readonly colorScheme: string | null }

/** Runs the script against a fake document, storage and `matchMedia`. */
function run(options: { readonly stored: string | null | 'throws', readonly prefersDark: boolean | 'no-matchMedia' }): Outcome {
	let attribute: string | null = null
	const style: { colorScheme: string | null } = { colorScheme: null }
	const document = {
		documentElement: {
			setAttribute: (name: string, value: string) => {
				if (name === 'data-lab-theme')
					attribute = value
			},
			style,
		},
	}
	const localStorage = {
		getItem: (key: string) => {
			if (options.stored === 'throws')
				throw new Error('blocked')
			return key === 'widget-lab:theme' ? options.stored : null
		},
	}
	const matchMedia = options.prefersDark === 'no-matchMedia'
		? undefined
		: (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && options.prefersDark === true })
	// The page's own globals, as the browser has them when the script runs.
	runInNewContext(bootstrapScript(), { document, localStorage, matchMedia })
	return { attribute, colorScheme: style.colorScheme }
}

describe('first-paint theme script (index.html)', () => {
	const stored: (string | null)[] = ['light', 'dark', null, 'sepia', '']
	for (const value of stored) {
		for (const prefersDark of [true, false]) {
			it(`agrees with resolveLabTheme() for stored ${JSON.stringify(value)} and prefers-dark ${prefersDark}`, () => {
				const expected = resolveLabTheme(value, prefersDark)
				expect(run({ stored: value, prefersDark }))
					.toEqual({ attribute: expected, colorScheme: expected })
			})
		}
	}

	it('falls back to the system preference when storage is blocked, and to light without matchMedia', () => {
		expect(run({ stored: 'throws', prefersDark: true }).attribute)
			.toBe('dark')
		expect(run({ stored: 'throws', prefersDark: false }).attribute)
			.toBe('light')
		expect(run({ stored: null, prefersDark: 'no-matchMedia' }).attribute)
			.toBe('light')
	})
})
