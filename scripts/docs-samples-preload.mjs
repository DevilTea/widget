// Preloaded (`node --import`) into every runnable documentation sample. It records what the sample prints
// together with the lines of the sample that were on the call stack, so that the comments next to a
// statement can be compared with the output that statement caused. See docs-samples-output.ts.
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { format } from 'node:util'

Error.stackTraceLimit = 200

const recordFile = process.env.DOCS_SAMPLE_RECORD
const sampleFile = process.env.DOCS_SAMPLE_FILE
const frame = new RegExp(`${sampleFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):\\d+`)

for (const method of ['log', 'info', 'error', 'warn', 'debug']) {
	const original = console[method].bind(console)
	console[method] = (...args) => {
		const lines = []
		for (const entry of new Error('trace').stack.split('\n')
			.slice(1)) {
			const match = frame.exec(entry)
			if (match !== null)
				lines.push(Number(match[1]))
		}
		appendFileSync(recordFile, `${JSON.stringify({ method, text: format(...args), lines })}\n`)
		original(...args)
	}
}
