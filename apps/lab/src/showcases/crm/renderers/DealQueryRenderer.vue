<script lang="ts">
import { defineComponent } from 'vue'

/**
 * `DealQuery` is a CRM-domain semantic widget with no visual presentation of its own (checkpoint §3):
 * it renders real empty/null DOM output — not a hidden element — but this is still a real registered
 * Vue component; the renderer registry entry is never `null`/omitted/optional (PR #22 review 4941241562
 * finding 4: a `display:none` `<span>` is still a DOM element, so this renders no element at all). All
 * search/filter/aggregation semantics live in its Properties and stay fully evaluable through the
 * Runtime regardless of this component's mount state.
 */
export default defineComponent({
	name: 'DealQueryRenderer',
	setup: () => () => null,
})
</script>
