/**
 * Small text helpers for views that mix prose with inline elements (Lab UX phase 2, Explain tab).
 */

export interface ProseSegment {
	readonly text: string
	/** The segment was a Markdown code span (`` `x` ``) and is shown as code. */
	readonly code: boolean
}

/**
 * Splits generated documentation text (JSDoc summaries, schema descriptions) into plain text and Markdown code spans, so a
 * view can draw `` `x` `` as code instead of printing the backticks. Only single-backtick spans with content are read; a lone
 * backtick stays as it is. Nothing else of Markdown is interpreted.
 */
export function splitInlineCode(text: string): readonly ProseSegment[] {
	const segments: ProseSegment[] = []
	let last = 0
	for (const match of text.matchAll(/`([^`\n]+)`/g)) {
		if (match.index > last)
			segments.push({ text: text.slice(last, match.index), code: false })
		segments.push({ text: match[1]!, code: true })
		last = match.index + match[0].length
	}
	if (last < text.length)
		segments.push({ text: text.slice(last), code: false })
	return segments
}

export type TemplatePart = { readonly text: string } | { readonly param: string }

/**
 * Splits a translated message with `{name}` placeholders into its text and its placeholders, so a view can put an element
 * (a code span, a button, a live value) where a placeholder is, in whatever order the language puts them.
 */
export function templateParts(message: string): readonly TemplatePart[] {
	const parts: TemplatePart[] = []
	let last = 0
	for (const match of message.matchAll(/\{([\w-]+)\}/g)) {
		if (match.index > last)
			parts.push({ text: message.slice(last, match.index) })
		parts.push({ param: match[1]! })
		last = match.index + match[0].length
	}
	if (last < message.length)
		parts.push({ text: message.slice(last) })
	return parts
}
