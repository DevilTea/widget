import { defineConfig } from 'vitepress'

export default defineConfig({
	base: '/widget/',
	title: 'DevilTea Widget',
	description: 'Documentation for @deviltea/widget-core, @deviltea/widget-inspector, and @deviltea/widget-vue.',
	ignoreDeadLinks: [/^\/lab\//],
	themeConfig: {
		nav: [
			{ text: 'Packages', link: '/packages/' },
			{ text: 'Migration', link: '/migration/0.3' },
			{ text: 'Widget Lab', link: '/lab/', target: '_self' },
		],
		sidebar: {
			'/packages/': [
				{
					text: 'Packages',
					items: [
						{ text: '@deviltea/widget-core', link: '/packages/widget-core' },
						{ text: '@deviltea/widget-inspector', link: '/packages/widget-inspector' },
						{ text: '@deviltea/widget-vue', link: '/packages/widget-vue' },
					],
				},
			],
			'/migration/': [
				{
					text: 'Migration',
					items: [
						{ text: 'From 0.0.x to 0.1', link: '/migration/0.1' },
						{ text: 'From 0.1 to 0.2', link: '/migration/0.2' },
						{ text: 'From 0.2 to 0.3', link: '/migration/0.3' },
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
