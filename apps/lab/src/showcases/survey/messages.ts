/**
 * The survey renderers' own presentation text, selected by the host's locale (`showcase-host`). It is the
 * Lab-side wording of the survey's frame, not the survey's content: the title, questions, options, errors and
 * the Submit label come from the Document in the survey's own language (State `language`), never from here.
 */
import { defineShowcaseMessages } from '../../showcase-host'

export const surveyMessages = defineShowcaseMessages({
	'en': {
		language: 'Language',
		response: 'Response — what a backend reads',
	},
	'zh-TW': {
		language: '語言',
		response: '回應——後端讀取的內容',
	},
})
