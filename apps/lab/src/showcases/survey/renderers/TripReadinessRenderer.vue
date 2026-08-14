<script setup lang="ts">
/**
 * `TripReadiness` lives only in `TripSurvey`'s semantic-only `semantics` slot, which
 * `TripSurveyRenderer` intentionally never renders (checkpoint §2). This component exists solely so
 * `createWidgetVueRenderer`'s exhaustive registry coverage check is satisfied; it renders nothing.
 */
</script>

<template>
	<!-- semantics-only widget: never mounted in practice, since TripSurveyRenderer does not render the "semantics" slot -->
	<span
		v-once
		:style="{ display: 'none' }"
	/>
</template>
