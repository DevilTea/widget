/**
 * Vue renderers of the INNER notice board system, registered through the public `@deviltea/widget-vue` contract only. They
 * are plain components used by `../BoardPreview.vue` to show a repaired draft; the Lab never mounts this system itself.
 */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { boardSystem } from '../../board/system'
import BoardRenderer from './BoardRenderer.vue'
import NoticeRenderer from './NoticeRenderer.vue'

export const BoardWidgetRenderer = createWidgetVueRenderer(boardSystem, renderers =>
	renderers
		.Board(BoardRenderer)
		.Notice(NoticeRenderer))
