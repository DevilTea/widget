/**
 * The overlay container of the Nuxt UI pack. `NuiSettingsPage.vue` renders an empty element with this attribute inside the pack's
 * root, and the pack's `UApp` is given `PORTAL_SELECTOR` as its `portal`: Nuxt UI overlays (modals, select menus) are teleported
 * into that element instead of the frame's `<body>`, so they stay inside the pack's root, with its tokens and its `dark` class.
 */

export const PORTAL_ATTRIBUTE = 'data-packs-portal'
export const PORTAL_SELECTOR = `[${PORTAL_ATTRIBUTE}]`
