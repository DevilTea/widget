/**
 * The quote "backend": a dedicated module Worker the Preview starts. It runs `evaluateQuoteJson` (`./evaluate.ts`) over
 * the very same plugins the page renders, in a realm with no `document`, no `window` and no Vue. It imports
 * `./worker-protocol` and nothing else; `evaluate.unit.test.ts` checks that import graph for DOM and Vue.
 */

import { handleWorkerMessage } from './worker-protocol'

interface WorkerScope {
	addEventListener: (type: 'message', listener: (event: { readonly data: unknown }) => void) => void
	postMessage: (message: unknown) => void
}

const scope = globalThis as unknown as WorkerScope

scope.addEventListener('message', (event) => {
	const reply = handleWorkerMessage(event.data)
	if (reply !== null)
		scope.postMessage(reply)
})
