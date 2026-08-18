// @vitest-environment happy-dom
/**
 * Regression coverage for the `@deviltea/widget-core` issue #20 fix (PR #21, "keep sibling property
 * dependents live under issue subscriptions"): before that fix, once something (e.g. Vue's
 * `usePropertyIssues()`) subscribed to an upstream Property's issues channel, a downstream same-widget
 * Property reading the upstream Property's value via `dep.self.properties.get(...)` stopped receiving
 * live updates through its own value subscription after the upstream Property later flipped from
 * success to failure — even a fresh `.get()` pull could remain stale. `TripMetricsRenderer.vue` used to
 * work around this by never calling `usePropertyIssues()` for `tripDays`/`travelerCount`; now that core
 * is fixed, it subscribes to every Property's own issues channel directly (the natural design), and
 * this suite proves — against the real Runtime/Blueprint, no mocked core — that `budgetPerPersonPerDay`/
 * `estimatedBaselineCost` (both downstream of `tripDays`) stay live without any renderer-side workaround.
 * #43 adds a presentation-only locale dependency to the renderer, so this harness supplies an English
 * identity translator without changing any Runtime semantics asserted here.
 */
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { LabI18nKey } from '../../../composables/use-lab-i18n'
import { ConditionalSectionPlugin, SurveySectionPlugin, TripSurveyPlugin } from '../plugins'
import { defaultSurveyPreset } from '../presets'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'
import TripMetricsRenderer from './TripMetricsRenderer.vue'

const NoopRenderer = defineComponent({ setup: () => () => null })

function makeSlotRenderer(plugin: any, slotName: string) {
	return defineComponent({
		setup() {
			const { WidgetSlot } = useWidget(plugin)
			return () => h(WidgetSlot, { name: slotName })
		},
	})
}

const HarnessRenderer = createWidgetVueRenderer(surveySystem, renderers =>
	renderers
		.TripSurvey(makeSlotRenderer(TripSurveyPlugin, 'form'))
		.SurveySection(makeSlotRenderer(SurveySectionPlugin, 'body'))
		.ConditionalSection(defineComponent({
			setup() {
				const { useProperties, WidgetSlot } = useWidget(ConditionalSectionPlugin)
				const { visible } = useProperties()
				return () => visible.value === true ? h(WidgetSlot, { name: 'body' }) : null
			},
		}))
		.SurveyDateQuestion(NoopRenderer)
		.SurveyNumberQuestion(NoopRenderer)
		.SurveyChoiceQuestion(NoopRenderer)
		.TripMetrics(TripMetricsRenderer as unknown as any)
		.TripReadiness(NoopRenderer)
		.TripRecommendation(NoopRenderer))

describe('tripMetricsRenderer', () => {
	it('keeps budgetPerPersonPerDay/estimatedBaselineCost live after tripDays fails, even after an earlier generateResult() pull', async () => {
		const definition = JSON.parse(defaultSurveyPreset.sourceText)
		const blueprint = surveySystem.createBlueprint(definition)
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: {
				config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
				provide: {
					[LabI18nKey as symbol]: {
						locale: { value: 'en' },
						locales: ['en', 'zh-TW'],
						setLocale: () => {},
						t: (source: string) => source,
					},
				},
			},
		})
		await wrapper.vm.$nextTick()
		expect(wrapper.text())
			.toContain('180.00') // 1800 / (2 travelers × 5 days)

		const familyPriority = widgetOfType(runtime, 'family-priority', 'SurveyChoiceQuestion')
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')
		const children = widgetOfType(runtime, 'children', 'SurveyNumberQuestion')
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		// Exercise the exact real-world sequence: reach children > 0, submit, generateResult() — which
		// pulls TripMetrics' properties through TripRecommendation's own dependency reads — and only
		// *then* break the date.
		children.state.answer.set(1)
		await wrapper.vm.$nextTick()
		familyPriority.state.answer.set('easy-transit')
		survey.methods.submit()
		survey.methods.generateResult()
		await wrapper.vm.$nextTick()
		expect(wrapper.text())
			.toContain('120.00') // 1800 / (3 travelers × 5 days)

		returnQuestion.state.answer.set('2027-04-05') // before departure (2027-04-10)
		await wrapper.vm.$nextTick()

		// All three affected Properties (tripDays directly, budgetPerPersonPerDay/estimatedBaselineCost
		// as its downstream dependents) must reflect the failure — no stale value survives, and (issue
		// #26 Finding 2) no fabricated `0.00` stands in for the failed budgetPerPersonPerDay/
		// estimatedBaselineCost values.
		expect(wrapper.text())
			.not.toContain('120.00')
		expect(wrapper.text())
			.not.toContain('0.00')
		expect(wrapper.text())
			.toContain('Unavailable')

		// tripDays' own root-cause message (a `property-result` issue) renders exactly once, under "Trip
		// days" (issue #26 Finding 3: no per-metric flattening/repetition of the wrapped root cause).
		// budgetPerPersonPerDay/estimatedBaselineCost each instead render their own `property-dependency`
		// issue as an attributed "Unavailable because Trip days failed." line — same underlying single
		// root cause, but no longer presented as three duplicate/unrelated errors.
		const rootCauseCount = wrapper.text()
			.split('Return date must be strictly after the departure date.').length - 1
		expect(rootCauseCount)
			.toBe(1)
		const attributedCount = wrapper.text()
			.split('Unavailable because Trip days failed.').length - 1
		expect(attributedCount)
			.toBe(2)
	})
})
