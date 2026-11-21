<script setup lang="ts">
/**
 * Presentation only: the repaired board's title and its notices (the `notices` slot). A plain component of the INNER
 * notice board system: it shows what a repaired draft looks like in the app. It stamps no inspect anchor on purpose: its
 * widgets belong to the preview Runtime the repair desk host creates, not to the Runtime the Lab inspects, so a pointer on the
 * board selects the draft widget that contains it.
 */
import { useWidget } from '@deviltea/widget-vue'
import { BoardPlugin } from '../../board/plugins'
import { useRepairText } from '../use-repair-text'

const { useProperties, WidgetSlot, widgetId } = useWidget(BoardPlugin)
const { title } = useProperties()
const { text } = useRepairText()
</script>

<template>
	<section
		class="board"
		data-testid="repair-board"
	>
		<h4 class="board-title">
			{{ title === null ? widgetId : text(title) }}
		</h4>
		<ul class="board-notices">
			<WidgetSlot name="notices">
				<template #default="{ Child }">
					<li class="board-notice-item">
						<component :is="Child" />
					</li>
				</template>
			</WidgetSlot>
		</ul>
	</section>
</template>

<style scoped>
.board {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.board-title {
	margin: 0;
	font-size: 18px;
}

.board-notices {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 0;
	list-style: none;
}
</style>
