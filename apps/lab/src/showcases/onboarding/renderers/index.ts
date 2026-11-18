/**
 * Onboarding Vue renderer registry, registered against `onboardingSystem` through the public `@deviltea/widget-vue`
 * contract only (`createWidgetVueRenderer`). Every plugin has exactly one renderer registration (the registry is
 * exhaustive by construction).
 *
 * `OnboardingRenderer` is the component the Lab mounts: the registry's own renderer wrapped in the **host** that owns
 * the Runtime (`./onboarding-host.ts`). The host listens to the widgets' Events, does the waiting for the booking
 * office, writes the answers back and provides itself to the renderers below it; it cancels everything when the Preview
 * unmounts the page.
 */

import type { InjectionKey, PropType } from 'vue'
import type { Scheduler } from '../booking-office'
import type { OnboardingRuntime } from '../system'
import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { defineComponent, h, inject, onScopeDispose, provide } from 'vue'
import { onboardingSystem } from '../system'
import AccountStepRenderer from './AccountStepRenderer.vue'
import InductionStepRenderer from './InductionStepRenderer.vue'
import InterestsStepRenderer from './InterestsStepRenderer.vue'
import { createOnboardingHost, OnboardingHostKey } from './onboarding-host'
import OnboardingRootRenderer from './OnboardingRootRenderer.vue'
import SafetyStepRenderer from './SafetyStepRenderer.vue'

export const OnboardingWidgetRenderer = createWidgetVueRenderer(onboardingSystem, renderers =>
	renderers
		.Onboarding(OnboardingRootRenderer)
		.AccountStep(AccountStepRenderer)
		.InterestsStep(InterestsStepRenderer)
		.SafetyStep(SafetyStepRenderer)
		.InductionStep(InductionStepRenderer))

/** How the host waits: a test provides a scheduler it fires by hand. The Preview uses timers. */
export const OnboardingSchedulerKey = Symbol('widget-lab:onboarding-scheduler') as InjectionKey<Scheduler>

/** One host for one Runtime: created when it mounts, disposed when it unmounts. */
const OnboardingHostScope = defineComponent({
	name: 'OnboardingHostScope',
	props: {
		runtime: { type: Object as PropType<OnboardingRuntime>, required: true },
	},
	setup(props) {
		const scheduler = inject(OnboardingSchedulerKey, undefined)
		const { host, dispose } = createOnboardingHost(props.runtime, { scheduler })
		provide(OnboardingHostKey, host)
		onScopeDispose(dispose)
		return () => h(OnboardingWidgetRenderer, { runtime: props.runtime })
	},
})

const hostKeys = new WeakMap<object, number>()
let nextHostKey = 1

export const OnboardingRenderer = defineComponent({
	name: 'OnboardingRenderer',
	props: {
		runtime: { type: Object as PropType<OnboardingRuntime>, required: true },
	},
	setup(props) {
		// A different Runtime is a different wizard: it gets its own host (and pending work), not a re-pointed one.
		return () => {
			if (!hostKeys.has(props.runtime))
				hostKeys.set(props.runtime, nextHostKey++)
			return h(OnboardingHostScope, { runtime: props.runtime, key: hostKeys.get(props.runtime) })
		}
	},
})
