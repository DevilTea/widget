/**
 * Survey-form curated Implementation-explorer registry: one entry per `surveyPlugins` type
 * (`./plugins/index.ts`) with the plugin file, the Vue renderer file and `domain.ts`, where the
 * condition grammar, its evaluation and the built-in answer messages live. The four question types also
 * list `plugins/question-members.ts`, where `visible`, `required`, the option states and `errors` are
 * computed. Every file is a lazy `?raw` thunk (see `../../implementation/types.ts`), so this module
 * stays small and pulls no source text into the shell's initial chunks.
 */

import type { SourcesRegistry } from '../../implementation/types'

const ROOT = 'apps/lab/src/showcases/survey'

const domain = {
	kind: 'domain',
	title: 'domain.ts',
	path: `${ROOT}/domain.ts`,
	load: () => import('./domain.ts?raw').then(module => module.default),
} as const

const questionMembers = {
	kind: 'domain',
	title: 'question-members.ts',
	path: `${ROOT}/plugins/question-members.ts`,
	load: () => import('./plugins/question-members.ts?raw').then(module => module.default),
} as const

export const surveySources: SourcesRegistry = {
	Survey: {
		files: [
			{ kind: 'plugin', title: 'survey.ts', path: `${ROOT}/plugins/survey.ts`, load: () => import('./plugins/survey.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'SurveyRootRenderer.vue', path: `${ROOT}/renderers/SurveyRootRenderer.vue`, load: () => import('./renderers/SurveyRootRenderer.vue?raw').then(m => m.default) },
			domain,
		],
	},
	SingleChoice: {
		files: [
			{ kind: 'plugin', title: 'single-choice.ts', path: `${ROOT}/plugins/single-choice.ts`, load: () => import('./plugins/single-choice.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'SingleChoiceRenderer.vue', path: `${ROOT}/renderers/SingleChoiceRenderer.vue`, load: () => import('./renderers/SingleChoiceRenderer.vue?raw').then(m => m.default) },
			questionMembers,
			domain,
		],
	},
	MultipleChoice: {
		files: [
			{ kind: 'plugin', title: 'multiple-choice.ts', path: `${ROOT}/plugins/multiple-choice.ts`, load: () => import('./plugins/multiple-choice.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'MultipleChoiceRenderer.vue', path: `${ROOT}/renderers/MultipleChoiceRenderer.vue`, load: () => import('./renderers/MultipleChoiceRenderer.vue?raw').then(m => m.default) },
			questionMembers,
			domain,
		],
	},
	Numeric: {
		files: [
			{ kind: 'plugin', title: 'numeric.ts', path: `${ROOT}/plugins/numeric.ts`, load: () => import('./plugins/numeric.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NumericRenderer.vue', path: `${ROOT}/renderers/NumericRenderer.vue`, load: () => import('./renderers/NumericRenderer.vue?raw').then(m => m.default) },
			questionMembers,
			domain,
		],
	},
	ShortAnswer: {
		files: [
			{ kind: 'plugin', title: 'short-answer.ts', path: `${ROOT}/plugins/short-answer.ts`, load: () => import('./plugins/short-answer.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'ShortAnswerRenderer.vue', path: `${ROOT}/renderers/ShortAnswerRenderer.vue`, load: () => import('./renderers/ShortAnswerRenderer.vue?raw').then(m => m.default) },
			questionMembers,
			domain,
		],
	},
}
