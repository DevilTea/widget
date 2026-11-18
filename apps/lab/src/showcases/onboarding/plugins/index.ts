/**
 * The five onboarding plugins as one tuple for `createWidgetSystem` (see `../system.ts`). `Onboarding` is first:
 * the Implementation catalog marks the first type as the current one.
 */

import { AccountStepPlugin } from './account-step'
import { InductionStepPlugin } from './induction-step'
import { InterestsStepPlugin } from './interests-step'
import { OnboardingPlugin } from './onboarding'
import { SafetyStepPlugin } from './safety-step'

export * from './account-step'
export * from './induction-step'
export * from './interests-step'
export * from './onboarding'
export * from './safety-step'

export const onboardingPlugins = [
	OnboardingPlugin,
	AccountStepPlugin,
	InterestsStepPlugin,
	SafetyStepPlugin,
	InductionStepPlugin,
] as const

export type OnboardingPlugins = typeof onboardingPlugins
