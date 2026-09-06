/** Structural widgets for the Vuetify task application. */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TaskMessages } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject, isTaskMessages, taskMessages } from '../domain'

export interface TaskAppShellConfig {
	readonly i18nId: string
}

export interface TaskAppShellInterfaces extends WidgetInterfaces {
	config: {
		raw: TaskAppShellConfig
		resolved: TaskAppShellConfig
	}
	slots: 'toolbar' | 'main' | 'overlay'
	properties: {
		messages: TaskMessages
	}
}

export const TaskAppShellPlugin = createWidgetPlugin('TaskAppShell')
	.description('Vuetify task application shell')
	.interfaces<TaskAppShellInterfaces>()
	.config({
		description: 'Application-shell dependencies',
		validate: (input): input is TaskAppShellConfig => isPlainObject(input) && typeof input.i18nId === 'string',
		resolve: raw => ({ i18nId: raw?.i18nId ?? '' }),
	})
	.slots({
		toolbar: { description: 'Application-bar actions' },
		main: { description: 'Task application body' },
		overlay: { description: 'Dialogs and overlays' },
	})
	.properties(properties =>
		properties.messages({
			registerDeps: ({ dep, config }) => dep.widget(config.i18nId).properties.get('messages')
				.validate(isTaskMessages),
			compute: ({ deps }) => {
				const result = deps()
				return result.ok ? result.value : taskMessages.en
			},
		}))
	.done()
