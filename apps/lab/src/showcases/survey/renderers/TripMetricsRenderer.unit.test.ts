// @vitest-environment happy-dom
/**
 * Regression coverage for a reactivity interaction discovered while manually verifying the dev server
 * (see the implementation report): once something (e.g. Vue's `usePropertyIssues()`) subscribes to an
 * upstream* Property's issues channel, a *downstream* same-widget Property that reads the upstream
 * Property's value via `dep.self.properties.get(...)` stopped receiving live updates through its own
 * value* subscription after the upstream Property later flipped from success to failure — even though
 * a fresh `.get()` pull always returned the correct (failing) result. `TripMetricsRenderer.vue` works
 * around this by never calling `usePropertyIssues()` for `tripDays`/`travelerCount` (both have
 * `budgetPerPersonPerDay`/`estimatedBaselineCost` as downstream dependents); it only subscribes to the
 * downstream Properties' own issues, which already carry the same message via `property-dependency`
 * wrapping (issue #10 §12, "message preserved 1:1"). This suite exercises the real component end to end
 * against a real Runtime/Blueprint (no mocked core) to guard the workaround — see the widget-lab
 * implementation report for the isolated core-level repro this was root-caused with.
 */
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
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
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
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

		expect(wrapper.text())
			.not.toContain('120.00')
		expect(wrapper.text())
			.toContain('0.00')
		const diagnosticCount = wrapper.text()
			.split('Return date must be strictly after the departure date.').length - 1
		expect(diagnosticCount)
			.toBe(1)
	})
})
