/**
 * Onboarding curated Implementation-explorer registry: one entry per `onboardingPlugins` type (`./plugins/index.ts`)
 * with the plugin file, the Vue renderer file(s) and the files that carry the interesting part: `onboarding-host.ts`
 * (where the host listens to Events and does the waiting), `booking-office.ts` (the simulated backend) and `domain.ts`
 * (the shapes that cross Event and Method boundaries). Every file is a lazy `?raw` thunk (see
 * `../../showcase-host/sources.ts`), so this module stays small and pulls no source text into the shell's initial chunks.
 */

import type { SourcesRegistry } from '../../showcase-host'

const ROOT = 'apps/lab/src/showcases/onboarding'

const domain = {
	kind: 'domain',
	title: 'domain.ts',
	path: `${ROOT}/domain.ts`,
	load: () => import('./domain.ts?raw').then(module => module.default),
} as const

const reads = {
	kind: 'domain',
	title: 'reads.ts',
	path: `${ROOT}/plugins/reads.ts`,
	load: () => import('./plugins/reads.ts?raw').then(module => module.default),
} as const

const structure = {
	kind: 'domain',
	title: 'structure.ts',
	path: `${ROOT}/plugins/structure.ts`,
	load: () => import('./plugins/structure.ts?raw').then(module => module.default),
} as const

const host = {
	kind: 'renderer',
	title: 'onboarding-host.ts',
	path: `${ROOT}/renderers/onboarding-host.ts`,
	load: () => import('./renderers/onboarding-host.ts?raw').then(module => module.default),
} as const

const office = {
	kind: 'domain',
	title: 'booking-office.ts',
	path: `${ROOT}/booking-office.ts`,
	load: () => import('./booking-office.ts?raw').then(module => module.default),
} as const

const stepFrame = {
	kind: 'renderer',
	title: 'StepFrame.vue',
	path: `${ROOT}/renderers/StepFrame.vue`,
	load: () => import('./renderers/StepFrame.vue?raw').then(module => module.default),
} as const

export const onboardingSources: SourcesRegistry = {
	Onboarding: {
		files: [
			{ kind: 'plugin', title: 'onboarding.ts', path: `${ROOT}/plugins/onboarding.ts`, load: () => import('./plugins/onboarding.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'OnboardingRootRenderer.vue', path: `${ROOT}/renderers/OnboardingRootRenderer.vue`, load: () => import('./renderers/OnboardingRootRenderer.vue?raw').then(m => m.default) },
			host,
			{ kind: 'renderer', title: 'HostActivity.vue', path: `${ROOT}/renderers/HostActivity.vue`, load: () => import('./renderers/HostActivity.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'problem-board.ts', path: `${ROOT}/renderers/problem-board.ts`, load: () => import('./renderers/problem-board.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'index.ts', path: `${ROOT}/renderers/index.ts`, load: () => import('./renderers/index.ts?raw').then(m => m.default) },
			reads,
			structure,
			domain,
		],
	},
	AccountStep: {
		files: [
			{ kind: 'plugin', title: 'account-step.ts', path: `${ROOT}/plugins/account-step.ts`, load: () => import('./plugins/account-step.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'AccountStepRenderer.vue', path: `${ROOT}/renderers/AccountStepRenderer.vue`, load: () => import('./renderers/AccountStepRenderer.vue?raw').then(m => m.default) },
			stepFrame,
			structure,
			domain,
		],
	},
	InterestsStep: {
		files: [
			{ kind: 'plugin', title: 'interests-step.ts', path: `${ROOT}/plugins/interests-step.ts`, load: () => import('./plugins/interests-step.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'InterestsStepRenderer.vue', path: `${ROOT}/renderers/InterestsStepRenderer.vue`, load: () => import('./renderers/InterestsStepRenderer.vue?raw').then(m => m.default) },
			stepFrame,
			structure,
			domain,
		],
	},
	SafetyStep: {
		files: [
			{ kind: 'plugin', title: 'safety-step.ts', path: `${ROOT}/plugins/safety-step.ts`, load: () => import('./plugins/safety-step.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'SafetyStepRenderer.vue', path: `${ROOT}/renderers/SafetyStepRenderer.vue`, load: () => import('./renderers/SafetyStepRenderer.vue?raw').then(m => m.default) },
			stepFrame,
			structure,
			domain,
		],
	},
	InductionStep: {
		files: [
			{ kind: 'plugin', title: 'induction-step.ts', path: `${ROOT}/plugins/induction-step.ts`, load: () => import('./plugins/induction-step.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'InductionStepRenderer.vue', path: `${ROOT}/renderers/InductionStepRenderer.vue`, load: () => import('./renderers/InductionStepRenderer.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'OfficeDesk.vue', path: `${ROOT}/renderers/OfficeDesk.vue`, load: () => import('./renderers/OfficeDesk.vue?raw').then(m => m.default) },
			host,
			office,
			stepFrame,
			structure,
			domain,
		],
	},
}
