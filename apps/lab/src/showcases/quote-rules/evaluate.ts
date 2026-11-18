/**
 * JSON in, JSON out, with no Vue and no DOM: the shape a backend bundles. It compiles a quote document with the
 * same `quoteSystem` the Preview runs, writes the request's answers into a fresh Runtime and returns the same
 * `quote` the Preview's root widget exposes. The browser and the backend agree because they run the same plugin
 * files: there is no second implementation of a price rule to drift.
 *
 * The Preview runs this module in a Web Worker (`./quote.worker.ts`) as its "backend". Everything this file
 * imports (the system, the plugins, Core and Valibot) is DOM-free, which `evaluate.unit.test.ts` checks over the
 * import graph, and each result says whether `document`/`window` existed where it ran.
 *
 * What a result is made of:
 * - `outcome`: the quote, or why there is none. Failures are data: `invalid-request`, `invalid-document` (the
 *   located Blueprint diagnostics), `diagnostics` (a plugin reported a fact about the data, such as an unknown
 *   paper) and `exception` (a rule's code threw: an implementation defect, which Core does not wrap, so a direct
 *   `get()` rethrows it and this module reports it);
 * - `rejected`: answers the Runtime refused (unknown widget or State, or a value the schema library rejected, with
 *   the library's messages verbatim). They are not failures of the quote: the Runtime keeps the previous value.
 *
 * `readQuoteOutcome()` is the one function that turns a Runtime into an outcome, and the Preview's host calls it on
 * the live Runtime too, so the two sides are compared like for like.
 *
 * This module compiles the document and creates a Runtime on every call, which keeps it stateless. A real backend
 * should cache the Blueprint per document revision and reuse one Runtime with `resetState()` between requests. It
 * sets no isolated-error handler: nothing here subscribes, so Core has nothing to isolate, and installing a
 * handler belongs to the host bundle (guide, "Host requirements"), not to a plugin library.
 */

import type { QuoteAnswers, QuoteResult } from './domain'
import type { QuoteRuntime } from './system'
import { isPlainObject } from './domain'
import { quoteSystem } from './system'

export interface QuoteRequest {
	/** The quote definition: a `WidgetDocument` source such as the `quote-default` preset. */
	readonly quote: unknown
	/** The answers to write before reading, by widget id and State name: the root's Property `answers`. */
	readonly answers: QuoteAnswers
}

export interface DocumentDiagnostic {
	readonly code: string
	readonly message: string
	/** The widget the diagnostic is about, or `null` when it is about the document as a whole. */
	readonly widgetId: string | null
}

export interface MemberDiagnostic {
	readonly widgetId: string
	readonly member: string
	readonly code: string
	readonly message: string
	readonly reason: string | null
}

export type QuoteFailure
	= | { readonly kind: 'invalid-request', readonly message: string }
		| { readonly kind: 'invalid-document', readonly diagnostics: readonly DocumentDiagnostic[] }
		| { readonly kind: 'diagnostics', readonly diagnostics: readonly MemberDiagnostic[] }
		| { readonly kind: 'exception', readonly widgetId: string | null, readonly member: string | null, readonly name: string, readonly message: string }

export type QuoteOutcome
	= | { readonly ok: true, readonly quote: QuoteResult }
		| { readonly ok: false, readonly failure: QuoteFailure }

export interface RejectedAnswer {
	readonly widgetId: string
	/** The State member, or `null` when the widget itself was refused. */
	readonly member: string | null
	readonly reason: 'unknown-widget' | 'unknown-state' | 'invalid-value'
	/** What the State validator said, verbatim. Empty unless `reason` is `invalid-value`. */
	readonly messages: readonly string[]
}

/** Where a result was computed. */
export interface EvaluationEnvironment {
	readonly hasDocument: boolean
	readonly hasWindow: boolean
}

export interface QuoteEvaluation {
	readonly outcome: QuoteOutcome
	readonly rejected: readonly RejectedAnswer[]
	readonly environment: EvaluationEnvironment
}

/** Whether `document` and `window` exist in the realm this runs in: both are missing in a Web Worker. */
export function describeEnvironment(): EvaluationEnvironment {
	return { hasDocument: typeof document !== 'undefined', hasWindow: typeof window !== 'undefined' }
}

function invalidRequest(message: string): QuoteOutcome {
	return { ok: false, failure: { kind: 'invalid-request', message } }
}

/** The ids of the root Quote's items, then its rules, in document order, for the members that can fail. */
function memberTargets(runtime: QuoteRuntime): readonly { readonly widgetId: string, readonly member: 'line' | 'adjustment' }[] {
	const blueprint = runtime.blueprint
	const root = blueprint.root
	return [
		...blueprint.getChildrenAt(root, 'items')
			.map(child => ({ widgetId: child.id, member: 'line' as const })),
		...blueprint.getChildrenAt(root, 'rules')
			.map(child => ({ widgetId: child.id, member: 'adjustment' as const })),
	]
}

/** Reads one member of one widget the way a Property is read directly: the result, or what it threw. */
function probe(runtime: QuoteRuntime, widgetId: string, member: 'line' | 'adjustment'): { readonly thrown: true, readonly error: unknown } | { readonly thrown: false, readonly result: { readonly ok: boolean, readonly failure?: unknown } } {
	const widget = runtime.getWidget(widgetId)
	const property = widget === null || !('properties' in widget)
		? undefined
		: (widget.properties as Record<string, { get: () => { ok: boolean, failure?: unknown } } | undefined>)[member]
	if (property === undefined)
		return { thrown: false, result: { ok: true } }
	try {
		return { thrown: false, result: property.get() }
	}
	catch (error) {
		return { thrown: true, error }
	}
}

/**
 * Which widget's code threw `error`. A Property that threw keeps the exception as its cached outcome, so reading
 * the Items and the rules again throws the very same object at the one that raised it (and at nothing else).
 * Core's isolated-error handler receives only the exception, so a host that wants to say "which rule" asks this.
 */
export function findThrowingMember(runtime: QuoteRuntime, error: unknown): { readonly widgetId: string, readonly member: string } | null {
	for (const { widgetId, member } of memberTargets(runtime)) {
		const read = probe(runtime, widgetId, member)
		if (read.thrown && read.error === error)
			return { widgetId, member }
	}
	return null
}

/** The failed members under the root, with Core's own messages: what a `diagnostics` failure lists. */
function failedMembers(runtime: QuoteRuntime): MemberDiagnostic[] {
	const found: MemberDiagnostic[] = []
	for (const { widgetId, member } of memberTargets(runtime)) {
		const read = probe(runtime, widgetId, member)
		if (read.thrown || read.result.ok)
			continue
		const diagnostics = (read.result.failure as { diagnostics?: readonly { code: string, message: string, reason?: unknown }[] } | undefined)?.diagnostics ?? []
		// A dependent of the failed member only repeats the failure in its own words (`dependency-target-failed`).
		for (const diagnostic of diagnostics.filter(candidate => !candidate.code.startsWith('dependency-')))
			found.push({ widgetId, member, code: diagnostic.code, message: diagnostic.message, reason: typeof diagnostic.reason === 'string' ? diagnostic.reason : null })
	}
	return found
}

/**
 * The quote of a Runtime as an outcome. A rule that throws makes the direct read throw (Core does not wrap a
 * plugin's exception), and that is reported as an `exception` with the widget found by `findThrowingMember`.
 */
export function readQuoteOutcome(runtime: QuoteRuntime): QuoteOutcome {
	const root = runtime.getWidget(runtime.blueprint.root.id)
	if (root?.type !== 'Quote')
		return invalidRequest('The root of the document is not a Quote.')
	let result
	try {
		result = root.properties.quote.get()
	}
	catch (error) {
		const where = findThrowingMember(runtime, error)
		return {
			ok: false,
			failure: {
				kind: 'exception',
				widgetId: where?.widgetId ?? null,
				member: where?.member ?? null,
				name: error instanceof Error ? error.name : 'Error',
				message: error instanceof Error ? error.message : String(error),
			},
		}
	}
	if (result.ok)
		return { ok: true, quote: result.value }
	const diagnostics = failedMembers(runtime)
	return {
		ok: false,
		failure: {
			kind: 'diagnostics',
			diagnostics: diagnostics.length > 0
				? diagnostics
				: result.failure.diagnostics.map(diagnostic => ({ widgetId: root.id, member: 'quote', code: diagnostic.code, message: diagnostic.message, reason: null })),
		},
	}
}

/** Writes the answers into the Runtime and lists the ones it refused. */
export function applyAnswers(runtime: QuoteRuntime, answers: QuoteAnswers): RejectedAnswer[] {
	const rejected: RejectedAnswer[] = []
	for (const [widgetId, members] of Object.entries(answers)) {
		const widget = runtime.getWidget(widgetId)
		if (widget === null || !('state' in widget) || !isPlainObject(members)) {
			rejected.push({ widgetId, member: null, reason: 'unknown-widget', messages: [] })
			continue
		}
		const state = widget.state as Record<string, { set: (value: unknown) => { ok: boolean, failure?: { diagnostics: readonly { message: string }[] } } } | undefined>
		for (const [member, value] of Object.entries(members)) {
			const target = Object.hasOwn(state, member) ? state[member] : undefined
			if (target === undefined) {
				rejected.push({ widgetId, member, reason: 'unknown-state', messages: [] })
				continue
			}
			const result = target.set(value)
			if (!result.ok)
				rejected.push({ widgetId, member, reason: 'invalid-value', messages: result.failure?.diagnostics.map(diagnostic => diagnostic.message) ?? [] })
		}
	}
	return rejected
}

export function evaluateQuote(request: unknown): QuoteEvaluation {
	const environment = describeEnvironment()
	if (!isPlainObject(request) || !isPlainObject(request.answers))
		return { outcome: invalidRequest('A request is { quote, answers: { [widgetId]: { [stateName]: value } } }.'), rejected: [], environment }
	const blueprint = quoteSystem.createBlueprint(request.quote)
	if (blueprint.status !== 'valid') {
		return {
			outcome: { ok: false, failure: { kind: 'invalid-document', diagnostics: blueprint.diagnostics.map(({ code, message, location }) => ({ code, message, widgetId: location.type === 'source' ? null : location.node.id })) } },
			rejected: [],
			environment,
		}
	}
	const runtime = blueprint.createRuntime()
	try {
		const rejected = applyAnswers(runtime, request.answers as QuoteAnswers)
		return { outcome: readQuoteOutcome(runtime), rejected, environment }
	}
	finally {
		runtime.dispose()
	}
}

/** `evaluateQuote` for a host that passes JSON text: unparsable text is an `invalid-request` result. */
export function evaluateQuoteJson(input: string): string {
	let request: unknown
	try {
		request = JSON.parse(input)
	}
	catch {
		return JSON.stringify({ outcome: invalidRequest('The request is not valid JSON.'), rejected: [], environment: describeEnvironment() } satisfies QuoteEvaluation)
	}
	return JSON.stringify(evaluateQuote(request))
}
