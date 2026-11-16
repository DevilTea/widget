/**
 * JSON in, JSON out: the shape a backend bundles. It compiles a survey definition with the same
 * `surveySystem` the Preview runs, writes the request's answers (and language) into a fresh Runtime,
 * and returns the same `response` the Preview's root widget exposes, so a form and a backend agree
 * because they run the same plugin files.
 *
 * Answer problems are data, not failures: a well-typed answer that breaks a rule is stored and shows up
 * as an entry of `errors`; only an answer that cannot be stored at all (unknown question, wrong JSON
 * type, unsupported language) is listed in `rejected`. A survey that does not compile has no Runtime, so
 * the result is `ok: false` with the located diagnostics.
 *
 * This module sets no isolated-error handler: that belongs to the host bundle (guide, "Host
 * requirements"), not to a plugin library.
 */

import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { ConfigPath, SurveyResponse } from './domain'
import type { surveyPlugins } from './plugins'
import { isPlainObject } from './domain'
import { surveySystem } from './system'

export interface ResponseRequest {
	/** The survey definition: a `WidgetDocument` source such as a `survey-default` preset. */
	readonly survey: unknown
	/** The survey language to answer in; omitted means the survey's default language. */
	readonly language?: string
	/** Raw answers by question id: a string, a number, a string array or `null`. */
	readonly answers: Readonly<Record<string, unknown>>
}

export type RejectedReason = 'unknown-question' | 'invalid-answer' | 'invalid-language'

export interface RejectedAnswer {
	/** The question id, or `null` for a rejected `language`. */
	readonly questionId: string | null
	readonly reason: RejectedReason
}

export interface EvaluationDiagnostic {
	readonly code: string
	readonly message: string
	readonly widgetId: string | null
	/** The Property or Method the diagnostic is about, when it is about one. */
	readonly member: string | null
	/** Where the problem is in the survey definition; `null` when it has no place there. */
	readonly sourcePath: ConfigPath | null
}

export type ResponseResult
	= | { readonly ok: true, readonly canSubmit: boolean, readonly response: SurveyResponse, readonly rejected: readonly RejectedAnswer[] }
		| { readonly ok: false, readonly diagnostics: readonly EvaluationDiagnostic[] }

type SurveyBlueprint = WidgetSystemBlueprint<typeof surveyPlugins>

function jsonPath(path: readonly PropertyKey[]): ConfigPath {
	return path.map(segment => typeof segment === 'number' ? segment : String(segment))
}

/** One Blueprint diagnostic as plain data with the widget, member and source path it concerns. */
function describeDiagnostic(blueprint: SurveyBlueprint, diagnostic: SurveyBlueprint['diagnostics'][number]): EvaluationDiagnostic {
	const { code, message, location } = diagnostic
	const path = 'path' in diagnostic ? diagnostic.path : undefined
	if (location.type === 'source')
		return { code, message, widgetId: null, member: null, sourcePath: path === undefined ? null : jsonPath(path) }
	const nodePath = blueprint.getSourcePath(location.node)
	// A config diagnostic's `path` is relative to the widget's `config`.
	const sourcePath = nodePath !== null && code === 'invalid-widget-config' && path !== undefined
		? [...nodePath, 'config', ...jsonPath(path)]
		: nodePath
	return {
		code,
		message,
		widgetId: location.node.id,
		member: location.type === 'property' || location.type === 'method' ? location.name : null,
		sourcePath: sourcePath === null ? null : [...sourcePath],
	}
}

function invalidRequest(message: string): ResponseResult {
	return { ok: false, diagnostics: [{ code: 'invalid-request', message, widgetId: null, member: null, sourcePath: null }] }
}

export function evaluateResponse(request: ResponseRequest): ResponseResult {
	if (!isPlainObject(request) || !isPlainObject(request.answers) || (request.language !== undefined && typeof request.language !== 'string'))
		return invalidRequest('A request is { survey, language?: string, answers: { [questionId]: answer } }.')
	const blueprint = surveySystem.createBlueprint(request.survey)
	if (blueprint.status !== 'valid')
		return { ok: false, diagnostics: blueprint.diagnostics.map(diagnostic => describeDiagnostic(blueprint, diagnostic)) }
	const runtime = blueprint.createRuntime()
	try {
		const root = runtime.getWidget(blueprint.root.id)
		if (root?.type !== 'Survey')
			throw new TypeError('A valid survey has a Survey root.') // guaranteed by the structure validators
		const rejected: RejectedAnswer[] = []
		if (request.language !== undefined && !root.state.language.set(request.language).ok)
			rejected.push({ questionId: null, reason: 'invalid-language' })
		for (const [questionId, answer] of Object.entries(request.answers)) {
			const widget = runtime.getWidget(questionId)
			let accepted: boolean
			// Narrow on `type`, then write the fixed State member. The casts are type-only: `set` validates.
			switch (widget?.type) {
				case 'ShortAnswer':
				case 'SingleChoice':
					accepted = widget.state.answer.set(answer as string | null).ok
					break
				case 'MultipleChoice':
					accepted = widget.state.answer.set(answer as string[] | null).ok
					break
				case 'Numeric':
					accepted = widget.state.answer.set(answer as number | null).ok
					break
				default:
					rejected.push({ questionId, reason: 'unknown-question' })
					continue
			}
			if (!accepted)
				rejected.push({ questionId, reason: 'invalid-answer' })
		}
		const response = root.properties.response.get()
		const canSubmit = root.properties.canSubmit.get()
		if (!response.ok || !canSubmit.ok)
			throw new Error('The survey plugins failed to evaluate.') // a plugin defect, not an answer problem
		return { ok: true, canSubmit: canSubmit.value, response: response.value, rejected }
	}
	finally {
		runtime.dispose()
	}
}

/** `evaluateResponse` for a host that passes JSON text: unparsable text is an `invalid-request` result. */
export function evaluateResponseJson(input: string): string {
	let request: unknown
	try {
		request = JSON.parse(input)
	}
	catch {
		return JSON.stringify(invalidRequest('The request is not valid JSON.'))
	}
	return JSON.stringify(evaluateResponse(request as ResponseRequest))
}
