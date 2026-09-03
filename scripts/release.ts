import process from 'node:process'
import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts'
import { $ } from 'zx'
import { fail, packageEntry, packageIds, packageVersion, workspaceRoot } from './release-package'

const REPOSITORY = 'DevilTea/widget'
const PUBLISH_WORKFLOW_URL = `https://github.com/${REPOSITORY}/actions/workflows/publish.yml`

$.cwd = workspaceRoot
$.verbose = false

const $$ = $({ nothrow: true })

async function git(...args: string[]) {
	return (await $`git ${args}`).stdout.trim()
}

async function succeeds(command: Promise<{ exitCode: number | null }>) {
	return (await command).exitCode === 0
}

async function assertGitHubCliReady() {
	if (!(await succeeds($$`gh --version`)))
		fail('The GitHub CLI (`gh`) is required. Install it from https://cli.github.com.')
	if (!(await succeeds($$`gh auth status`)))
		fail('The GitHub CLI is not authenticated. Run `gh auth login` first.')
}

async function assertCleanWorktree() {
	if ((await git('status', '--porcelain')) !== '')
		fail('The working tree has uncommitted changes. Commit or stash them first.')
}

async function assertSyncedMain() {
	const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
	if (branch !== 'main')
		fail(`Releases start from \`main\`, but the current branch is \`${branch}\`.`)

	await git('fetch', 'origin', 'main', '--tags')

	if ((await git('rev-parse', 'HEAD')) !== (await git('rev-parse', 'origin/main')))
		fail('Local `main` differs from `origin/main`. Pull or push before releasing.')
}

async function remoteBranchExists(branch: string) {
	return (await git('ls-remote', '--heads', 'origin', branch)) !== ''
}

async function remoteTagExists(tag: string) {
	return (await git('ls-remote', '--tags', 'origin', tag)) !== ''
}

async function localTagExists(tag: string) {
	return (await git('tag', '--list', tag)) !== ''
}

async function askToProceed(message: string, autoConfirm: boolean, onCancel?: () => Promise<void>) {
	if (autoConfirm)
		return

	const answer = await confirm({ message })
	if (isCancel(answer) || answer === false) {
		await onCancel?.()
		cancel('Release cancelled.')
		process.exit(0)
	}
}

async function openReleasePullRequest(id: string, release: string, autoConfirm: boolean) {
	const entry = packageEntry(id)
	const previousVersion = packageVersion(id)

	intro(`Release ${entry.name}`)

	await assertGitHubCliReady()
	await assertCleanWorktree()
	await assertSyncedMain()

	await $`pnpm exec bumpp ${`${entry.directory}/package.json`} --release ${release} --no-commit --no-tag --no-push --yes`

	const restoreBump = async () => {
		await git('restore', '--', `${entry.directory}/package.json`, 'pnpm-lock.yaml')
	}

	let version: string
	let tag: string
	let branch: string
	try {
		version = packageVersion(id)
		if (version === previousVersion)
			fail(`Bumpp left ${entry.name} at ${previousVersion}.`)

		tag = `${id}@${version}`
		branch = `release/${id}/v${version}`

		if (await remoteTagExists(tag))
			fail(`Tag ${tag} already exists on origin; that version is already released.`)
		if (await remoteBranchExists(branch))
			fail(`Release branch already exists on origin: ${branch}`)
	}
	catch (error) {
		await restoreBump()
		throw error
	}

	log.step(`${entry.name}: ${previousVersion} → ${version}`)
	log.info(`Branch \`${branch}\`, release tag \`${tag}\`.`)

	await askToProceed('Open the release pull request?', autoConfirm, restoreBump)

	await git('switch', '--create', branch)
	await git('add', '--', `${entry.directory}/package.json`, 'pnpm-lock.yaml')

	if (await succeeds($$`git diff --cached --quiet`))
		fail('Bumpp did not change the release version.')

	await git('commit', '-m', `chore(${id}): release v${version}`)
	await git('push', '--set-upstream', 'origin', branch)

	const body = [
		`Release candidate for \`${tag}\`.`,
		'',
		`After this pull request is merged, run \`pnpm release:tag ${id}\` to push the annotated tag and trigger the publish workflow.`,
	].join('\n')

	const url = (await $`gh pr create --base main --head ${branch} --title ${`chore(${id}): release v${version}`} --body ${body}`).stdout.trim()

	await $`gh pr merge ${url} --auto --squash --delete-branch`

	await git('switch', 'main')

	outro(`Pull request opened with auto-merge: ${url}`)
	log.info(`It merges once the required checks pass; then run \`pnpm release:tag ${id}\`.`)
}

async function pushReleaseTag(id: string, autoConfirm: boolean) {
	const entry = packageEntry(id)

	intro(`Tag ${entry.name}`)

	await assertCleanWorktree()
	await git('fetch', 'origin', 'main', '--tags')
	await git('switch', 'main')
	await git('merge', '--ff-only', 'origin/main')

	const version = packageVersion(id)
	const tag = `${id}@${version}`

	if (await localTagExists(tag))
		fail(`Tag ${tag} already exists locally.`)
	if (await remoteTagExists(tag))
		fail(`Tag ${tag} already exists on origin; that version is already released.`)

	const head = await git('rev-parse', '--short', 'HEAD')
	const subject = await git('log', '-1', '--pretty=%s')

	log.step(`${entry.name}@${version} → tag \`${tag}\``)
	log.info(`main is at ${head} (${subject}).`)
	log.warn('Pushing this tag publishes the package to npm.')

	await askToProceed(`Push \`${tag}\` and publish ${entry.name}@${version}?`, autoConfirm)

	await git('tag', '--annotate', tag, '--message', tag)
	await git('push', 'origin', tag)

	outro(`Pushed ${tag}. Publish run: ${PUBLISH_WORKFLOW_URL}`)
}

const [command, ...rest] = process.argv.slice(2)
const autoConfirm = rest.includes('--yes') || rest.includes('-y')
const operands = rest.filter(operand => operand.startsWith('-') === false)

function usage(): never {
	fail([
		'Usage:',
		'  pnpm release <package> <release>   Bump a package on a release branch and open its pull request',
		'  pnpm release:tag <package>         Tag merged main and trigger the publish workflow',
		'',
		`Packages: ${packageIds.join(', ')}`,
	].join('\n'))
}

try {
	const [id, release] = operands

	if (id != null)
		packageEntry(id)

	switch (command) {
		case 'open':
			if (id == null || release == null)
				usage()
			await openReleasePullRequest(id, release, autoConfirm)
			break
		case 'tag':
			if (id == null)
				usage()
			await pushReleaseTag(id, autoConfirm)
			break
		default:
			usage()
	}
}
catch (error) {
	cancel(error instanceof Error ? error.message : String(error))
	process.exit(1)
}
