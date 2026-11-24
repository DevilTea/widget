/**
 * The two plugins of the notice board, the application's document format v3:
 * - `Board` (root, slot `notices`): the board's title;
 * - `Notice` (child of a Board): title, body, `until` (a `YYYY-MM-DD` date) and a `tone`.
 *
 * Both only project their resolved config into Properties so a renderer can show it. The system is NOT a Lab showcase: it is
 * the format the repair desk's drafts are compiled with (`../plugins/findings.ts`), opened as a `WidgetDocument`
 * (`../renderers/repair-host.ts`) and, once repaired, previewed with the plain components of `../renderers/board/`.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { I18nText, Tone } from '../domain'
import type { BoardConfig, BoardRawConfig, NoticeConfig, NoticeRawConfig } from './config'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { boardConfigDocs, boardRawConfigDocs, checkBoardConfig, checkNoticeConfig, noticeConfigDocs, noticeRawConfigDocs, resolveBoardConfig, resolveNoticeConfig } from './config'

export interface BoardInterfaces extends WidgetInterfaces {
	config: { raw: BoardRawConfig, resolved: BoardConfig }
	slots: {
		notices: 'Notice'
	}
	properties: {
		title: I18nText
	}
}

export interface NoticeInterfaces extends WidgetInterfaces {
	config: { raw: NoticeRawConfig, resolved: NoticeConfig }
	properties: {
		title: string
		body: string
		until: string
		tone: Tone
	}
}

export const BoardPlugin = createWidgetPlugin('Board')
	.description('The root of a notice board (format v3). Slot `notices` holds the Notice widgets; Property `title` is the board title per language.')
	.interfaces<BoardInterfaces>()
	.config({
		description: 'The board title per language.',
		raw: boardRawConfigDocs,
		resolved: boardConfigDocs,
		validate: (input, ctx): input is BoardRawConfig => {
			checkBoardConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveBoardConfig,
	})
	.slots({
		notices: {
			description: 'The notices, in order. Only Notice widgets.',
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Notice')
						addDiagnostic({ message: `"${child.type}" is not a notice.`, index, reason: 'not-a-notice' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'A Board must be the root widget.', reason: 'board-not-root' })
	})
	.properties(properties => properties
		.title({ description: 'The board title per language.', compute: ({ config }) => config.title }))
	.done()

export const NoticePlugin = createWidgetPlugin('Notice')
	.description('One notice of a board (format v3): `title`, `body`, `until` (the last day it is shown, YYYY-MM-DD) and `tone` (`info` or `warning`), each also a Property.')
	.interfaces<NoticeInterfaces>()
	.config({
		description: 'The notice text, the last day it is shown and its tone.',
		raw: noticeRawConfigDocs,
		resolved: noticeConfigDocs,
		validate: (input, ctx): input is NoticeRawConfig => {
			checkNoticeConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveNoticeConfig,
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		const parent = blueprint.getParent(widget)
		if (parent === null || (parent.resolved && parent.type !== 'Board'))
			addDiagnostic({ message: 'A Notice must be placed in the notices of a Board.', reason: 'outside-board' })
	})
	.properties(properties => properties
		.title({ description: 'The notice title.', compute: ({ config }) => config.title })
		.body({ description: 'The notice text.', compute: ({ config }) => config.body })
		.until({ description: 'The last day the notice is shown, YYYY-MM-DD.', compute: ({ config }) => config.until })
		.tone({ description: '`info` or `warning`.', compute: ({ config }) => config.tone }))
	.done()

export const boardPlugins = [BoardPlugin, NoticePlugin] as const
export type BoardPlugins = typeof boardPlugins
