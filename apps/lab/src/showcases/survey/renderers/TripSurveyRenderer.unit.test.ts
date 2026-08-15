// @vitest-environment happy-dom
/**
 * Issue #26 Finding 1/4: `TripSurveyRenderer`'s stale-result presentation, against the real
 * `resultFresh` Property (`../plugins/trip-survey.ts`) and a real Runtime/Blueprint — no mocked core.
 * Harness style follows `TripMetricsRenderer.unit.test.ts`: every other widget in the tree is a no-op
 * stub so this suite stays focused on `TripSurveyRenderer` itself.
 */
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { ConditionalSectionPlugin, SurveySectionPlugin } from '../plugins'
import { defaultSurveyPreset } from '../presets'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'
import TripSurveyRenderer from './TripSurveyRenderer.vue'

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
		.TripSurvey(TripSurveyRenderer)
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
		.TripMetrics(NoopRenderer)
		.TripReadiness(NoopRenderer)
		.TripRecommendation(NoopRenderer))

function mountSurvey() {
	const definition = JSON.parse(defaultSurveyPreset.sourceText)
	const blueprint = surveySystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()

	const wrapper = mount(HarnessRenderer, {
		props: { runtime },
		global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
	})

	return { wrapper, runtime }
}

describe('tripSurveyRenderer stale-result presentation (issue #26)', () => {
	it('shows no stale copy/badge for a freshly generated result', async () => {
		const { wrapper, runtime } = mountSurvey()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		survey.methods.submit()
		survey.methods.generateResult()
		await wrapper.vm.$nextTick()

		expect(wrapper.text())
			.toContain('Recommendation')
		expect(wrapper.text())
			.not.toContain('Stale')
		expect(wrapper.text())
			.not.toContain('Generated from previous answers')
		expect(wrapper.text())
			.toContain('Trip days: 5')
	})

	it('shows the stale copy/badge once a tracked answer changes, while the old result stays visible', async () => {
		const { wrapper, runtime } = mountSurvey()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')

		survey.methods.submit()
		survey.methods.generateResult()
		await wrapper.vm.$nextTick()

		returnQuestion.state.answer.set('2027-04-20')
		await wrapper.vm.$nextTick()

		expect(wrapper.text())
			.toContain('Stale')
		expect(wrapper.text())
			.toContain('Generated from previous answers')
		// The old snapshot is retained, not cleared — its stale figures stay on screen.
		expect(wrapper.text())
			.toContain('Trip days: 5')
	})

	it('recovers freshness after re-submitting and regenerating the result', async () => {
		const { wrapper, runtime } = mountSurvey()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')

		survey.methods.submit()
		survey.methods.generateResult()
		await wrapper.vm.$nextTick()

		returnQuestion.state.answer.set('2027-04-20')
		await wrapper.vm.$nextTick()
		expect(wrapper.text())
			.toContain('Stale')

		survey.methods.submit()
		survey.methods.generateResult()
		await wrapper.vm.$nextTick()

		expect(wrapper.text())
			.not.toContain('Stale')
		expect(wrapper.text())
			.not.toContain('Generated from previous answers')
		// computeTripDays('2027-04-10', '2027-04-20') === 11 (survey/domain.ts).
		expect(wrapper.text())
			.toContain('Trip days: 11')
	})
})
