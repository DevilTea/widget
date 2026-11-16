/**
 * Comparison of what a runnable documentation sample prints with what its comments claim.
 *
 * A comment is an expected-output claim when it trails a statement that prints (`console.log(x) // true`) or sits
 * on the comment lines directly below one, one line per printed line. "Prints" includes what the statement
 * triggers: a call whose subscriber calls `console.log` is a printing statement too. A claim must then match the
 * output; there is no first-word or prose escape. A comment on or under a statement that printed nothing is not
 * output (a returned value, a remark) and is not looked at.
 *
 * A claim matches an output when it is that output, or that output followed by `: `, `, <word>` or ` (` and a
 * remark (`true: the Method completed`), or the value printed after a `label ->` or `label:` (`{ ok: true }` for
 * `total -> { ok: true }`). `...` inside a claim matches any text; a claim made only of `...` matches nothing.
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

export interface ComparedClaim extends OutputClaim {
	/** The lines that called `console` for the outputs the claim was matched with. */
	sources: number[]
}

export interface OutputComparison {
	failures: OutputFailure[]
	/** The claims that were matched against printed output (an exempt claim that did not match is not one). */
	compared: ComparedClaim[]
	/** Claims that did not match but are exempt (see `compareOutput`). */
	exempted: OutputClaim[]
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

// What may follow the output in a claim: a colon, a comma and a lower-case word (not a value), or a parenthesis.
const remark = /^(?:$|: |, (?!(?:true|false|null|undefined)\b)[a-z]| \()/

function valueMatches(wanted: string, printed: string): boolean {
	for (const candidate of [printed, `'${printed}'`, `"${printed}"`]) {
		if (wanted.startsWith(candidate) && remark.test(wanted.slice(candidate.length)))
			return true
	}
	if (wanted.includes('...')) {
		const pattern = wanted.split('...')
			.map(escapeRegExp)
			.join('.*?')
		return new RegExp(`^${pattern}$`, 's')
			.test(printed)
	}
	return false
}

/** Whether a claim is the output, the output and a remark, or the value an output prints after a label. */
export function claimMatches(claim: string, output: string): boolean {
	const wanted = normalize(claim)
	const printed = normalize(output)
	if (wanted === '' || printed === '')
		return wanted === printed
	if (/^(?:\.\.\.\s*)+$/.test(wanted))
		return false
	if (valueMatches(wanted, printed))
		return true
	for (const label of printed.matchAll(/(?:->|:) /g)) {
		if (valueMatches(wanted, printed.slice(label.index + label[0].length)))
			return true
	}
	return false
}

interface Group { start: number, end: number }

const assumption = 'a comment on, or directly below, a statement that prints is read as its expected output: the printed text, optionally followed by ": ", by ", " and a lowercase word, or by " (" and a remark (a label ending in ":" or "->" may be left out); put a remark on its own line above the statement, or after a blank line'

/**
 * Compares the claims of a sample with what it printed. `isExempt(text)` names comments that sit on a printing
 * statement without being output (existing remarks and return values); an exempt claim that does not match is
 * reported in `exempted` instead of failing.
 */
export function compareOutput(code: string, outputs: RecordedOutput[], isExempt: (claim: string) => boolean = () => false): OutputComparison {
	const lines = code.split('\n')
	const scanned = lines.map(scanLine)
	const result: OutputComparison = { failures: [], compared: [], exempted: [] }
	const outputsIn = (group: Group, directOnly: boolean) => outputs.filter((output) => {
		if (directOnly) {
			const line = output.lines[0]
			return line !== undefined && line >= group.start && line <= group.end
		}
		return output.lines.some(line => line >= group.start && line <= group.end)
	})
	const isDirect = (group: Group) => scanned.slice(group.start - 1, group.end)
		.some(entry => consoleCall.test(entry.code))
	const isCommentOnly = (i: number) => isBlank(scanned[i]!.code) && scanned[i]!.comment !== null

	// The first line of the statement that line `line` (1-based) belongs to or ends.
	const groupStartFor = (line: number, indent: number): number => {
		for (let index = line; index > 1; index--) {
			if (!isBlank(scanned[index - 1]!.code) && !isContinuation(scanned[index - 1]!.code) && indentOf(lines[index - 1]!) <= indent)
				return index
		}
		return 1
	}

	const sourcesOf = (matched: RecordedOutput[]) => matched.map(output => output.lines[0]!)
	const judge = (claim: OutputClaim, candidates: RecordedOutput[], matched: RecordedOutput[], detail: string) => {
		if (matched.length > 0) {
			result.compared.push({ ...claim, sources: sourcesOf(matched) })
		}
		else if (isExempt(claim.text)) {
			result.exempted.push(claim)
		}
		else {
			const printed = candidates.map(output => JSON.stringify(normalize(output.text)))
				.join(', ')
			result.failures.push({ line: claim.line, message: `the comment claims ${JSON.stringify(normalize(claim.text))} but ${detail}${printed}; ${assumption}` })
		}
	}

	let index = 0
	while (index < lines.length) {
		const entry = scanned[index]!
		const lineNo = index + 1
		if (entry.comment !== null && !isBlank(entry.code)) {
			// A trailing comment.
			const claim = { line: lineNo, text: entry.comment }
			const group: Group = { start: groupStartFor(lineNo, indentOf(lines[index]!)), end: lineNo }
			const direct = isDirect(group)
			const attributed = outputsIn(group, direct)
			if (attributed.length > 0)
				judge(claim, attributed, attributed.filter(output => claimMatches(claim.text, output.text)), 'the statement printed ')
			else if (direct)
				judge(claim, [], [], 'this statement printed nothing')
			index++
			continue
		}
		if (isCommentOnly(index) && index > 0 && !isBlank(lines[index - 1]!) && !isCommentOnly(index - 1)) {
			// Comment lines directly below a statement.
			let blockEnd = index
			while (blockEnd + 1 < lines.length && isCommentOnly(blockEnd + 1))
				blockEnd++
			const group: Group = { start: groupStartFor(index, indentOf(lines[index]!)), end: index }
			const attributed = isDirect(group) ? outputsIn(group, true) : []
			const claims: OutputClaim[] = []
			for (let i = index; i <= blockEnd; i++)
				claims.push({ line: i + 1, text: scanned[i]!.comment! })
			if (attributed.length === claims.length) {
				claims.forEach((claim, i) => judge(claim, [attributed[i]!], claimMatches(claim.text, attributed[i]!.text) ? [attributed[i]!] : [], 'the statement printed '))
			}
			else if (attributed.length > 0) {
				for (const claim of claims)
					judge(claim, attributed, attributed.filter(output => claimMatches(claim.text, output.text)), `${claims.length} comment lines follow a statement that printed ${attributed.length} lines: `)
			}
			index = blockEnd + 1
			continue
		}
		index++
	}
	return result
}
