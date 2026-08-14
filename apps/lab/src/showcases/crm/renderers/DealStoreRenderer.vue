<script lang="ts">
import { defineComponent } from 'vue'

/**
 * `DealStore` is a CRM-domain semantic widget with no visual presentation of its own (checkpoint §3):
 * it renders real empty/null DOM output — not a hidden element — but this is still a real registered
 * Vue component; the renderer registry entry is never `null`/omitted/optional (PR #22 review 4941241562
 * finding 4: a `display:none` `<span>` is still a DOM element, so this renders no element at all).
 * `DealStore.updateStage`/`reset` remain fully callable through the Runtime regardless of this
 * component ever being mounted (it always is, since it lives directly under `AppShell#crm-app`'s `main`
 * slot, but its Method/State semantics do not depend on that).
 */
export default defineComponent({
	name: 'DealStoreRenderer',
	setup: () => () => null,
})
</script>
