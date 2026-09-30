/**
 * Resolve the actual embedding parent's origin from browser-owned navigation metadata.
 * Empty, malformed, and opaque referrers cannot authorize a Preview bootstrap.
 */
export function derivePreviewParentOrigin(referrer: string): string | null {
	if (referrer.length === 0)
		return null
	try {
		const origin = new URL(referrer).origin
		return origin === 'null' ? null : origin
	}
	catch {
		return null
	}
}
