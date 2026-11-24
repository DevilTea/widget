/**
 * `AccountStep`: step 1 of the wizard, the visitor's name and e-mail address.
 *
 * State `name` and `email` are plain text: a keystroke is never refused, so the form stays typeable. What is
 * missing is a derived fact (Property `missing`: `name`, `email`), and the wizard's Next Method reads it: it is the
 * Method, not the input, that says "not yet". Every step has the same four Properties (`title`, `missing`,
 * `complete`, `answers`), which is all the root knows about a step.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { AccountConfig, AccountRawConfig } from '../config'
import type { AccountAnswers, I18nText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkAccountConfig, resolveAccountConfig } from '../config'
import { accountAnswersDocs, accountConfigDocs, accountRawConfigDocs } from '../docs'
import { isEmail, isString } from '../domain'
import { checkInsideOnboarding } from './structure'

export interface AccountInterfaces extends WidgetInterfaces {
	config: { raw: AccountRawConfig, resolved: AccountConfig }
	state: {
		name: string
		email: string
	}
	properties: {
		title: I18nText
		missing: readonly string[]
		complete: boolean
		answers: AccountAnswers
	}
}

export const AccountStepPlugin = createWidgetPlugin('AccountStep')
	.description('Step 1 of the onboarding wizard: the visitor\'s name and e-mail address (State `name` and `email`, filled in as they type). Properties: `title`, `missing` (`name` and/or `email` while they are empty or not an address), `complete` and `answers`.')
	.interfaces<AccountInterfaces>()
	.config({
		description: 'The step title per language and, optionally, the name and e-mail address filled in at the start.',
		raw: accountRawConfigDocs,
		resolved: accountConfigDocs,
		validate: (input, ctx): input is AccountRawConfig => {
			checkAccountConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveAccountConfig,
	})
	.structure(ctx => checkInsideOnboarding(ctx, 'AccountStep'))
	.state(state => state
		.name({
			description: 'The visitor\'s name, as typed. Any text: a keystroke is never refused.',
			validate: (input): input is string => isString(input),
			default: ({ config }) => config.name,
		})
		.email({
			description: 'The visitor\'s e-mail address, as typed. Any text: a keystroke is never refused.',
			validate: (input): input is string => isString(input),
			default: ({ config }) => config.email,
		}))
	.properties(properties => properties
		.title({ description: 'The step title per language.', compute: ({ config }) => config.title })
		.missing({
			description: '`name` and/or `email` while they are empty or not an address.',
			registerDeps: ({ dep }) => ({ name: dep.self.state.get('name'), email: dep.self.state.get('email') }),
			compute: ({ deps }) => {
				const name = deps.name()
				const email = deps.email()
				const missing: string[] = []
				if (!name.ok || (name.value ?? '').trim() === '')
					missing.push('name')
				if (!email.ok || !isEmail(email.value ?? ''))
					missing.push('email')
				return missing
			},
		})
		.complete({
			description: 'Whether nothing is missing.',
			registerDeps: ({ dep }) => ({ missing: dep.self.properties.get('missing') }),
			compute: ({ deps }) => {
				const missing = deps.missing()
				return missing.ok && missing.value.length === 0
			},
		})
		.answers({
			description: 'The trimmed name and e-mail address.',
			ref: accountAnswersDocs,
			registerDeps: ({ dep }) => ({ name: dep.self.state.get('name'), email: dep.self.state.get('email') }),
			compute: ({ deps }) => {
				const name = deps.name()
				const email = deps.email()
				return { name: name.ok ? (name.value ?? '').trim() : '', email: email.ok ? (email.value ?? '').trim() : '' }
			},
		}))
	.done()
