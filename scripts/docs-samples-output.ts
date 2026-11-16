/**
 * Comparison of what a runnable documentation sample prints with what its comments claim.
 *
 * The samples state expected output in two forms, and both are compared here:
 *
 * 1. A trailing comment on the statement that prints: `console.log(x) // true: the Method completed`.
 * 2. Comment lines directly below the statement (or the loop) that prints:
 *    `console.log(a, b)` followed by `// a b`, one comment line per printed line.
 *
 * A claim matches an output when it is that output, or begins with it and continues after a delimiter
 * (`true: the Method completed` claims `true`). `...` in a claim matches any text. A claim on a statement that
 * prints only indirectly (a call that makes a subscriber print) is compared only when it quotes the output.
 * Everything else a comment says (return values, prose) cannot be compared mechanically and is reported as
 * `uncompared`.
 */

export interface RecordedOutput {
	/** What `console.log` and friends printed, formatted exactly as Node formats it. */
	text: string
	/** The lines of the sample on the call stack when it printed; the first is the line that called `console`. */
	lines: number[]
}

export interface OutputClaim {
	/** 1-based line of the sample the claim is written on. */
	line: number
	text: string
}

export interface OutputFailure {
	/** 1-based line of the sample. */
	line: number
	message: string
}

export interface UncomparedClaim {
	line: number
	text: string
	reason: string
}

export interface OutputComparison {
	failures: OutputFailure[]
	/** The number of claims that were matched against printed output. */
	compared: number
	uncompared: UncomparedClaim[]
}

interface ScannedLine {
	code: string
	comment: string | null
}

const consoleCall = /\bconsole\.(?:log|info|error|warn|debug)\(/

/** Splits a line into code and a trailing `//` comment, ignoring `//` inside strings and template literals. */
export function scanLine(line: string): ScannedLine {
	let quote: string | null = null
	const templateDepth: number[] = []
	for (let i = 0; i < line.length; i++) {
		const char = line[i]!
		if (quote !== null) {
			if (char === '\\') {
				i++
			}
			else if (char === quote) {
				quote = null
			}
			else if (quote === '`' && char === '$' && line[i + 1] === '{') {
				templateDepth.push(1)
				quote = null
				i++
			}
			continue
		}
		if (templateDepth.length > 0) {
			if (char === '{') {
				templateDepth[templateDepth.length - 1]!++
			}
			else if (char === '}' && --templateDepth[templateDepth.length - 1]! === 0) {
				templateDepth.pop()
				quote = '`'
				continue
			}
		}
		if (char === '\'' || char === '"' || char === '`') {
			quote = char
		}
		else if (char === '/' && line[i + 1] === '/') {
			return { code: line.slice(0, i), comment: line.slice(i + 2)
				.trim() }
		}
		else if (char === '/' && line[i + 1] === '*') {
			const end = line.indexOf('*/', i + 2)
			if (end === -1)
				return { code: line.slice(0, i), comment: null }
			i = end + 1
		}
	}
	return { code: line, comment: null }
}

const indentOf = (line: string) => line.length - line.trimStart().length
const isBlank = (line: string) => line.trim() === ''
// A line that continues the statement above it.
const isContinuation = (code: string) => /^\s*[.?)\]}:&|+*/-]/.test(code) && !/^\s*\/\//.test(code)

function normalize(text: string): string {
	return text.replace(/\s+/g, ' ')
		.trim()
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const boundary = /^(?:$|[\s:,;(.\-])/

/** Whether a claim is the output, or the output followed by a delimiter and a remark. */
export function claimMatches(claim: string, output: string): boolean {
	const wanted = normalize(claim)
	const printed = normalize(output)
	if (wanted === '' || printed === '')
		return wanted === printed
	for (const candidate of [printed, `'${printed}'`, `"${printed}"`]) {
		if (wanted === candidate)
			return true
		if (wanted.startsWith(candidate) && boundary.test(wanted.slice(candidate.length)))
			return true
	}
	// A comment may describe only the last value of `console.log('label', value)`.
	if (printed.endsWith(` ${wanted}`))
		return true
	if (wanted.includes('...')) {
		const pattern = wanted.split('...')
			.map(escapeRegExp)
			.join('.*?')
		if (new RegExp(`(?:^|\\s)${pattern}$`, 's')
			.test(printed)) {
			return true
		}
	}
	return false
}

const literalStart = /^(?:[-+]?\d|true\b|false\b|null\b|undefined\b|['"`[{])/
function firstWord(text: string) {
	return normalize(text)
		.split(' ')[0] ?? ''
}
const isScalar = (text: string) => !/\s/.test(normalize(text)) && !/^[[{]/.test(normalize(text))

interface Group { start: number, end: number }

export function compareOutput(code: string, outputs: RecordedOutput[]): OutputComparison {
	const lines = code.split('\n')
	const scanned = lines.map(scanLine)
	const result: OutputComparison = { failures: [], compared: 0, uncompared: [] }
	const innermost = (output: RecordedOutput) => output.lines[0]
	const outputsIn = (group: Group, directOnly: boolean) => outputs.filter((output) => {
		if (directOnly) {
			const line = innermost(output)
			return line !== undefined && line >= group.start && line <= group.end
		}
		return output.lines.some(line => line >= group.start && line <= group.end)
	})
	const isDirect = (group: Group) => scanned.slice(group.start - 1, group.end)
		.some(entry => consoleCall.test(entry.code))

	// The first line of the statement that line `line` (1-based) belongs to or ends.
	const groupStartFor = (line: number, indent: number): number => {
		let index = line
		while (index > 1) {
			const entry = scanned[index - 1]!
			const text = lines[index - 1]!
			const code = entry.code
			if (!isBlank(code) && !isContinuation(code) && indentOf(text) <= indent)
				return index
			index--
		}
		return 1
	}

	let index = 0
	while (index < lines.length) {
		const entry = scanned[index]!
		const lineNo = index + 1
		if (entry.comment !== null && !isBlank(entry.code)) {
			// Form 1: a trailing comment.
			const group: Group = { start: groupStartFor(lineNo, indentOf(lines[index]!)), end: lineNo }
			judgeTrailing(group, { line: lineNo, text: entry.comment })
			index++
			continue
		}
		if (isBlank(entry.code) && entry.comment !== null && index > 0 && !isBlank(lines[index - 1]!) && !isCommentOnly(index - 1)) {
			// Form 2: a block of comment lines directly below a statement.
			const blockStart = index
			let blockEnd = index
			while (blockEnd + 1 < lines.length && isCommentOnly(blockEnd + 1))
				blockEnd++
			const claims: OutputClaim[] = []
			for (let i = blockStart; i <= blockEnd; i++)
				claims.push({ line: i + 1, text: scanned[i]!.comment! })
			const blockIndent = indentOf(lines[blockStart]!)
			const group: Group = { start: groupStartFor(blockStart, blockIndent), end: blockStart }
			judgeBlock(group, claims)
			index = blockEnd + 1
			continue
		}
		index++
	}
	return result

	function isCommentOnly(i: number): boolean {
		return isBlank(scanned[i]!.code) && scanned[i]!.comment !== null
	}

	function judgeTrailing(group: Group, claim: OutputClaim) {
		const direct = isDirect(group)
		const attributed = outputsIn(group, direct)
		if (direct) {
			if (attributed.length === 0) {
				if (literalStart.test(claim.text) || isScalar(claim.text))
					result.failures.push({ line: claim.line, message: `the comment claims "${claim.text}" but this statement printed nothing` })
				else
					result.uncompared.push({ ...claim, reason: 'prose; the statement printed nothing' })
				return
			}
			if (attributed.some(output => claimMatches(claim.text, output.text))) {
				result.compared++
				return
			}
			const prose = !literalStart.test(claim.text)
				&& !attributed.every(output => isScalar(output.text))
				&& !attributed.some(output => firstWord(output.text) === firstWord(claim.text))
			if (prose) {
				result.uncompared.push({ ...claim, reason: 'prose next to a printed value' })
				return
			}
			result.compared++
			result.failures.push({ line: claim.line, message: describeMismatch(claim.text, attributed) })
			return
		}
		if (attributed.length === 0) {
			result.uncompared.push({ ...claim, reason: 'not printed output (a returned value or a remark)' })
			return
		}
		if (attributed.some(output => claimMatches(claim.text, output.text))) {
			result.compared++
			return
		}
		if (attributed.some(output => firstWord(output.text) === firstWord(claim.text)) && !literalStart.test(claim.text)) {
			result.compared++
			result.failures.push({ line: claim.line, message: describeMismatch(claim.text, attributed) })
			return
		}
		result.uncompared.push({ ...claim, reason: 'not printed output (a returned value or a remark)' })
	}

	function judgeBlock(group: Group, claims: OutputClaim[]) {
		const attributed = outputsIn(group, true)
		if (attributed.length === 0 || !isDirect(group)) {
			for (const claim of claims)
				result.uncompared.push({ ...claim, reason: 'a remark; the statement above prints nothing' })
			return
		}
		if (attributed.length === claims.length) {
			claims.forEach((claim, i) => {
				result.compared++
				if (!claimMatches(claim.text, attributed[i]!.text))
					result.failures.push({ line: claim.line, message: describeMismatch(claim.text, [attributed[i]!]) })
			})
			return
		}
		for (const claim of claims) {
			if (attributed.some(output => claimMatches(claim.text, output.text))) {
				result.compared++
			}
			else if (literalStart.test(claim.text) || attributed.some(output => firstWord(output.text) === firstWord(claim.text))) {
				result.compared++
				result.failures.push({ line: claim.line, message: `${describeMismatch(claim.text, attributed)} (${claims.length} comment lines for ${attributed.length} printed lines)` })
			}
			else {
				result.uncompared.push({ ...claim, reason: 'a remark below a printing statement' })
			}
		}
	}
}

function describeMismatch(claim: string, attributed: RecordedOutput[]): string {
	const printed = attributed.map(output => JSON.stringify(normalize(output.text)))
		.join(', ')
	return `the comment claims ${JSON.stringify(normalize(claim))} but the statement printed ${printed}`
}
