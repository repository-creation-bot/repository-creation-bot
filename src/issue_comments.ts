import * as core from '@actions/core'
import {GitHub} from '@actions/github/lib/utils'
import {
  IssueCommentCreatedEvent,
  IssueCommentEvent
} from '@octokit/webhooks-definitions/schema'
import {buildRepositoryInfoComment} from './issues'
import {parseIssueToRepositoryInfo} from './parse'

export async function handleIssueComment(
  api: InstanceType<typeof GitHub>,
  eventData: IssueCommentEvent,
  orgAdmins: string
) {
  switch (eventData.action) {
    case 'created':
      break // proceed
    default:
      return // do not handle
  }
  core.debug(`Handling issue comment ${JSON.stringify(eventData, null, 2)}`)

  const text = eventData.comment.body.trim()
  if (!text.startsWith('/repo-bot')) {
    return // do not handle comment
  }

  const command = text.substring('/repo-bot'.length + 1).toLowerCase()
  switch (command) {
    case 'ping-admins':
      core.info('Admin ping requested, will add comment to issue')
      await api.rest.issues.createComment({
        owner: eventData.repository.owner.login,
        repo: eventData.repository.name,
        issue_number: eventData.issue.number,
        body: `[repo-bot] Hey @${orgAdmins} 👋! It seems ${eventData.comment.user.login} is either facing troubles or needs your approval for this request.`
      })
      core.info('Commented')

      break
    case 'approve':
      await approve(api, eventData)
      break
    default:
      core.info(`Unknown command ${command} by user, will inform user now`)
      await api.rest.issues.createComment({
        owner: eventData.repository.owner.login,
        repo: eventData.repository.name,
        issue_number: eventData.issue.number,
        body: `[repo-bot] I did not understand the command \`${command}\` it is not a known command, known are:
* \`ping-admins\` - will create a comment in this issue which will ping the organization admins
* \`approve\` - approve the request and initiate the repository creation (will fail if user commenting is not allowed to approve) 
        `
      })
      core.info('Commented')
      break
  }

  core.info('Handling comment completed')
}
async function approve(
  api: InstanceType<typeof GitHub>,
  eventData: IssueCommentCreatedEvent
) {
  core.info(
    `Starting approval process, checking permissions and repo settings again`
  )

  const repositoryInfo = await parseIssueToRepositoryInfo(
    api,
    eventData.repository.owner.login,
    eventData.comment.user.login,
    eventData.issue.body
  )

  core.info(
    `Parsed repository info: ${JSON.stringify(repositoryInfo, null, 2)}`
  )

  if (!repositoryInfo.canIssueAuthorApproveCreation) {
    core.info(`User is now allowed to approve, will inform user now`)

    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body: `[repo-bot] Sorry but it seems you are not having the required permissions to approve the repository creation 😞.
      Please reach out to one of the administrators of the \`${repositoryInfo.resolvedTemplateName}\` to approve this request, or
      use \`/repo-admin ping-admins\` to ping the organization admins for approval. You might want to reach out to them also separately 
      depending on how urgent and long-running this repository creation might be.`
    })

    core.info(`Commented`)
    return
  }

  if (
    repositoryInfo.alreadyExists ||
    !repositoryInfo.sanitizedName ||
    !repositoryInfo.resolvedTemplateName
  ) {
    core.info(
      `There are unresolved issues with the request, will inform user now`
    )

    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body:
        `[repo-bot] Sorry, but it seems there are still some issues with your request. These issues need to be resolved before we can create the repository.` +
        buildRepositoryInfoComment(repositoryInfo)
    })

    core.info(`Commented`)

    return
  }

  core.info(`Input is OK, will inform user about creation`)
  await api.rest.issues.createComment({
    owner: eventData.repository.owner.login,
    repo: eventData.repository.name,
    issue_number: eventData.issue.number,
    body: `[repo-bot] Great, some work to do 💪! I will start now creation of your repository, this might take a while until it is completed. 
    I will close this issue once the repository was created. `
  })
  core.info(`User informed, starting creation`)

  try {
    const repositoryUrl = await createRepositoryFromTemplate(
      api,
      eventData.repository.owner.login,
      repositoryInfo.sanitizedName,
      repositoryInfo.resolvedTemplateName
    )

    core.info(`Repo creation completed, informing user`)
    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body: `[repo-bot] 🥳🎉 The repository creation completed without errors. You can now access the repository at ${repositoryUrl}. Happy coding. I will close this issue now.`
    })
    core.info(`User informed, closing issue`)
    await api.rest.issues.update({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      state: 'closed'
    })
    core.info(`Issue closed, locking issue as resolved`)
    await api.rest.issues.lock({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      lock_reason: 'resolved'
    })
    core.info(`Issue locked`)
  } catch (e) {
    core.error('Repository creation failed, will inform user')
    if (e instanceof Error) {
      core.error(e)
    } else {
      core.error((e as object).toString())
    }

    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body: `[repo-bot] Aw, snap! It something went wrong during creation of the repository 😱. I recommend reaching out to the organization administrators to resolve this issue!
      The repository might have been partially created but better try to let the admins double check. Sorry for the circumstances!
      The error was: 
      \`\`\`
      ${e}
      \`\`\`
      `
    })
  }
}

async function createRepositoryFromTemplate(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  repositoryName: string,
  templateName: string
): Promise<string> {
  core.info(`Loading template repo.`)
  const template = await api.rest.repos.get({
    owner: organizationName,
    repo: templateName
  })

  core.info(`Creating empty repository with right base settings.`)
  const repository = await api.rest.repos.createInOrg({
    org: organizationName,
    name: repositoryName,
    allow_auto_merge: template.data.allow_auto_merge,
    allow_merge_commit: template.data.allow_merge_commit,
    allow_rebase_merge: template.data.allow_rebase_merge,
    allow_squash_merge: template.data.allow_squash_merge,
    auto_init: true,
    delete_branch_on_merge: template.data.delete_branch_on_merge,
    baseUrl: undefined,
    description: undefined,
    gitignore_template: undefined,
    has_issues: template.data.has_issues,
    has_projects: template.data.has_projects,
    has_wiki: template.data.has_wiki,
    private: template.data.private,
    visibility: template.data.visibility as any,
    homepage: undefined,
    is_template: false,
    license_template: undefined
  })
  core.info(`Repository created.`)

  await commitCodeowners(api, repository.data, template)
  await cloneTeamsAndCollaborators(api, repository.data, template)
  await cloneBranchProtections(api, repository.data, template)
  await cloneActionPermissions(api, repository.data, template)
  await cloneLabels(api, repository.data, template)
  await cloneAutolinkReferences(api, repository.data, template)

  return repository.data.url
}

async function commitCodeowners(
  api: InstanceType<typeof GitHub>,
  repository: any /* TODO */,
  template: any /* TODO */
): Promise<void> {
  core.info('Adding codeowners')
  core.info('Codeowners added')
}

async function cloneTeamsAndCollaborators(
  api: InstanceType<typeof GitHub>,
  repository: any /* TODO */,
  template: any /* TODO */
): Promise<void> {
  core.info('Adding teams and collaborators')
  core.info('teams and collaborators added')
}

async function cloneBranchProtections(
  api: InstanceType<typeof GitHub>,
  repository: any /* TODO */,
  template: any /* TODO */
): Promise<void> {
  core.info('Adding branch protections')
  core.info('branch protections added')
}

async function cloneActionPermissions(
  api: InstanceType<typeof GitHub>,
  repository: any /* TODO */,
  template: any /* TODO */
): Promise<void> {
  core.info('Setting GitHub Actions permissions')
  core.info('GitHub Actions permissions set')
}

async function cloneLabels(
  api: InstanceType<typeof GitHub>,
  repository: any /* TODO */,
  template: any /* TODO */
): Promise<void> {
  core.info('Adding labels')
  core.info('labels added')
}

async function cloneAutolinkReferences(
  api: InstanceType<typeof GitHub>,
  repository: any /* TODO */,
  template: any /* TODO */
): Promise<void> {
  core.info('Autolink references')
}
