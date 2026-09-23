/** Controlled, throwaway negative validation of the installed tarball's inspection entrypoint. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const inspectionPath = fileURLToPath(import.meta.resolve('@deviltea/widget-core/inspection'))
const smokePath = fileURLToPath(new URL('./packed-consumer-runtime.mjs', import.meta.url))
const original = readFileSync(inspectionPath)
const source = original.toString('utf8')

// Remove only the named runtime export from the actual installed package entry, not a mock module.
const statements = [...source.matchAll(/\bexport\s*\{([^}]*)\}\s*;?/g)]
const candidates = statements.map(match => ({
	match,
	bindings: match[1].split(',')
		.map(binding => binding.trim())
		.filter(Boolean),
}))
	.filter(({ bindings }) => bindings.includes('inspectRuntime'))
if (candidates.length !== 1)
	throw new Error(`Expected exactly one inspectRuntime named export in packed entry; found ${candidates.length}.`)
const { match, bindings } = candidates[0]
const before = source.slice(0, match.index)
const after = source.slice(match.index + match[0].length)
const namedExports = bindings.filter(binding => binding !== 'inspectRuntime')
const withoutRuntime = `${before}export { ${namedExports.join(', ')} };${after}`

function runSmoke() {
	const result = spawnSync(process.execPath, [smokePath], { encoding: 'utf8' })
	if (result.error)
		throw result.error
	return result
}

try {
	writeFileSync(inspectionPath, withoutRuntime)
	const negative = runSmoke()
	if (negative.status === 0)
		throw new Error('The packed runtime smoke incorrectly passed after inspectRuntime was removed.')
	if (!/does not provide an export named ['"]inspectRuntime['"]/.test(negative.stderr ?? ''))
		throw new Error(`Packed smoke failed for an unexpected reason after mutation:\n${negative.stderr}`)
}
finally {
	// The only mutated file is in this disposable, external tarball consumer.
	writeFileSync(inspectionPath, original)
}

const restored = runSmoke()
if (restored.status !== 0)
	throw new Error(`Packed runtime smoke failed after restoring inspectRuntime:\n${restored.stderr}`)

console.log('Packed inspection negative validation passed: missing inspectRuntime fails; restored tarball entry passes.')
