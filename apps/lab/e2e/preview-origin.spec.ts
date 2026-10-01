import { expect, previewFrame, test } from './fixtures'

test('built PreviewPanel uses the configured cross-origin Preview host', async ({ page }) => {
	await page.goto('/')
	await page.getByRole('tab', { name: 'Preview' })
		.click()

	const frame = page.getByTestId('preview-frame')
	await expect(frame)
		.toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:4175\/preview-frame\.html\?/)
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()
})
