import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts'
import { $ } from 'zx'
import { assertUnifiedVersion, fail, packageEntry, packageIds, releaseBranch, releaseCommitMessage, releaseTag, releaseTagNames, sharedVersion, unifiedVersionProblem, workspaceRoot } from './release-package'

const REPOSITORY = 'DevilTea/widget'
const PUBLISH_WORKFLOW_URL = `https://github.com/${REPOSITORY}/actions/workflows/publish.yml`

$.cwd = workspaceRoot
$.verbose = false

const $$ = $({ nothrow: true })

const packageFiles = packageIds.map(id => `${packageEntry(id).directory}/package.json`)
const packageNames = packageIds.map(id => packageEntry(id).name)

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

/** Which of the tags that would mean `version` is released (`v<version>` and the old per-package tags) exist on origin. */
async function remoteReleaseTags(version: string) {
	const found: string[] = []
	for (const tag of releaseTagNames(version)) {
		if ((await git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) !== '')
			found.push(tag)
	}
	return found
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

function readVersion(id: string) {
	const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, packageEntry(id).directory, 'package.json'), 'utf8')) as { version?: string }
	return manifest.version ?? ''
}

async function openReleasePullRequest(release: string, autoConfirm: boolean) {
	intro('Release the Widget packages')

	const previousVersion = assertUnifiedVersion()
	await assertGitHubCliReady()
	await assertCleanWorktree()
	await assertSyncedMain()

	await $`pnpm exec bumpp ${packageFiles} --release ${release} --no-commit --no-tag --no-push --yes`

	const restoreBump = async () => {
		await git('restore', '--', ...packageFiles, 'pnpm-lock.yaml')
	}

	let version: string
	let tag: string
	let branch: string
	try {
		const versions = Object.fromEntries(packageIds.map(id => [id, readVersion(id)]))
		const problem = unifiedVersionProblem(versions)
		if (problem !== null)
			fail(`Bumpp did not leave one releasable version: ${problem}`)
		version = sharedVersion(versions)
		if (version === previousVersion)
			fail(`Bumpp left the packages at ${previousVersion}.`)

		tag = releaseTag(version)
		branch = releaseBranch(version)

		const released = await remoteReleaseTags(version)
		if (released.length > 0)
			fail(`Tag ${released.join(', ')} already exists on origin; that version is already released.`)
		if (await remoteBranchExists(branch))
			fail(`Release branch already exists on origin: ${branch}`)
	}
	catch (error) {
		await restoreBump()
		throw error
	}

	log.step(`${packageNames.join(', ')}: ${previousVersion} → ${version}`)
	log.info(`Branch \`${branch}\`, release tag \`${tag}\`.`)

	await askToProceed('Open the release pull request?', autoConfirm, restoreBump)

	await git('switch', '--create', branch)
	await git('add', '--', ...packageFiles, 'pnpm-lock.yaml')

	if (await succeeds($$`git diff --cached --quiet`))
		fail('Bumpp did not change the release version.')

	const title = releaseCommitMessage(version)
	await git('commit', '-m', title)
	await git('push', '--set-upstream', 'origin', branch)

	const body = [
		`Release candidate for \`${tag}\`: ${packageNames.map(name => `\`${name}\``)
			.join(', ')} all move from \`${previousVersion}\` to \`${version}\`.`,
		'',
		`After this pull request is merged, run \`pnpm release:tag\` to push the annotated tag \`${tag}\` and trigger the publish workflow, which publishes all of them (Core first).`,
	].join('\n')

	const url = (await $`gh pr create --base main --head ${branch} --title ${title} --body ${body}`).stdout.trim()

	await git('switch', 'main')

	outro(`Pull request opened: ${url}`)
	log.info('Merge it after the required checks pass; then run `pnpm release:tag`.')
}

async function pushReleaseTag(autoConfirm: boolean) {
	intro('Tag the Widget release')

	await assertCleanWorktree()
	await git('fetch', 'origin', 'main', '--tags')
	await git('switch', 'main')
	await git('merge', '--ff-only', 'origin/main')

	const version = assertUnifiedVersion()
	const tag = releaseTag(version)

	if (await localTagExists(tag))
		fail(`Tag ${tag} already exists locally.`)
	const released = await remoteReleaseTags(version)
	if (released.length > 0)
		fail(`Tag ${released.join(', ')} already exists on origin; that version is already released.`)

	const head = await git('rev-parse', '--short', 'HEAD')
	const subject = await git('log', '-1', '--pretty=%s')

	log.step(`${packageNames.join(', ')} ${version} → tag \`${tag}\``)
	log.info(`main is at ${head} (${subject}).`)
	log.warn('Pushing this tag publishes all the Widget packages to npm.')

	await askToProceed(`Push \`${tag}\` and publish ${version}?`, autoConfirm)

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
		'  pnpm release <release>   Bump all Widget packages to one version on a release branch and open one pull request',
		'                           (<release> is patch, minor, major, prerelease or an explicit version)',
		'  pnpm release:tag         Tag merged main as v<version> and trigger the publish workflow',
		'',
		`The packages are released together: ${packageNames.join(', ')}.`,
	].join('\n'))
}

try {
	switch (command) {
		case 'open':
			if (operands.length !== 1)
				usage()
			await openReleasePullRequest(operands[0] ?? '', autoConfirm)
			break
		case 'tag':
			if (operands.length !== 0)
				usage()
			await pushReleaseTag(autoConfirm)
			break
		default:
			usage()
	}
}
catch (error) {
	cancel(error instanceof Error ? error.message : String(error))
	process.exit(1)
}
