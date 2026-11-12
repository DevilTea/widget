import { describe, expect, it } from 'vitest'
import { corePeerRangeProblem } from './release-package'

describe('corePeerRangeProblem', () => {
	it.each(['0.0.0', '0.0.6', '0.0.99', '0.0.7-beta.1'])('refuses to release a dependent while Core is %s, where `^` pins one exact patch', (coreVersion) => {
		for (const id of ['widget-vue', 'widget-inspector']) {
			const problem = corePeerRangeProblem(id, coreVersion)
			expect(problem)
				.toContain(coreVersion)
			expect(problem)
				.toContain('0.1.0')
			expect(problem)
				.toContain('widget-core')
		}
	})

	it.each(['0.1.0', '0.1.3', '0.2.0', '1.0.0', '2.4.1'])('allows a dependent once Core is %s, where `^` admits later patches', (coreVersion) => {
		expect(corePeerRangeProblem('widget-vue', coreVersion))
			.toBeNull()
		expect(corePeerRangeProblem('widget-inspector', coreVersion))
			.toBeNull()
	})

	it('never blocks Core itself, whatever its version', () => {
		expect(corePeerRangeProblem('widget-core', '0.0.6'))
			.toBeNull()
		expect(corePeerRangeProblem('widget-core', '0.1.0'))
			.toBeNull()
	})

	it('rejects a Core version it cannot read instead of letting the release through', () => {
		expect(corePeerRangeProblem('widget-vue', 'not-a-version'))
			.toContain('not-a-version')
	})
})
