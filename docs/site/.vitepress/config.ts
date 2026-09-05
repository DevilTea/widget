import { defineConfig } from 'vitepress'

export default defineConfig({
	base: '/widget/',
	title: 'DevilTea Widget',
	description: 'Documentation for @deviltea/widget-core and @deviltea/widget-vue.',
	ignoreDeadLinks: [/^\/lab\//],
	themeConfig: {
		nav: [
			{ text: 'Packages', link: '/packages/' },
			{ text: 'Widget Lab', link: '/lab/', target: '_self' },
		],
		sidebar: {
			'/packages/': [
				{
					text: 'Packages',
					items: [
						{ text: '@deviltea/widget-core', link: '/packages/widget-core' },
						{ text: '@deviltea/widget-vue', link: '/packages/widget-vue' },
					],
				},
			],
		},
		socialLinks: [
			{ icon: 'github', link: 'https://github.com/DevilTea/widget' },
		],
		footer: {
			message: 'Released under the MIT License.',
			copyright: 'Copyright © 2023-PRESENT DevilTea',
		},
	},
})
