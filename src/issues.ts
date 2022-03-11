import * as core from '@actions/core'
import {context, GitHub} from '@actions/github/lib/utils'
import {parseIssueToRepositoryInfo, RepositoryInfo} from './parse'
import {IssuesEvent} from '@octokit/webhooks-definitions/schema'

export async function handleIssues(
  api: InstanceType<typeof GitHub>,
  eventData: IssuesEvent
) {
  switch (eventData.action) {
    case 'opened':
    case 'edited':
      break // proceed
    default:
      return // do not handle
  }
  core.debug(`Handling issues ${JSON.stringify(eventData, null, 2)}`)
  const repositoryInfo = await parseIssueToRepositoryInfo(
    api,
    eventData.repository.owner.login,
    eventData.issue.user.login,
    eventData.issue.body
  )

  core.debug(`Parsed info ${repositoryInfo}, commenting`)

  await api.rest.issues.createComment({
    owner: eventData.repository.owner.login,
    repo: eventData.repository.name,
    issue_number: eventData.issue.number,
    body: buildRepositoryInfoComment(repositoryInfo)
  })
}

function buildRepositoryInfoComment(repositoryInfo: RepositoryInfo): string {
  const base = `[repo-bot] This is the information I understood:
\`\`\`
Parsed Repository Name: '${repositoryInfo.parsedName}'
Sanitized Repository Name: '${repositoryInfo.sanitizedName}'
Parsed Template Repository: '${repositoryInfo.templateName}'
Resolved Template Repository: '${repositoryInfo.resolvedTemplateName}'
Issue Author is Template Admin: '${repositoryInfo.isIssueAuthorAdminInTemplate}'
Common Prefix: '${repositoryInfo.commonPrefix}'
Issue Author can approve: '${repositoryInfo.canIssueAuthorApproveCreation}'
\`\`\`
`

  if (!repositoryInfo.parsedName) {
    return `${base} ⚠️ I could not understand this request: The repository name seems missing. Did you properly follow the template?
    You can either correct the issue by editing your original request or comment \`/repo-bot ping-admins\` on this issue to ping the organization administators for assistance.`
  }

  if (!repositoryInfo.templateName) {
    return `${base} ⚠️ I could not understand this request: The template repository name seems missing. Did you properly follow the template?
    You can either correct the issue by editing your original request or comment \`/repo-bot ping-admins\` on this issue to ping the organization administators for assistance.`
  }

  if (!repositoryInfo.resolvedTemplateName) {
    return `${base} ⚠️ I could not find any repository with the name \`${repositoryInfo.templateName}\`. Did you mention an existing repository in this organization?
    You can either correct the issue by editing your original request or comment \`/repo-bot ping-admins\` on this issue to ping the organization administators for assistance.`
  }

  if (!repositoryInfo.canIssueAuthorApproveCreation) {
    return `${base} ✅ The information about the repository is looks good. But as you are not an admin of the template repository, either a repository or organization admin needs to approve your request. 
    You can either ask any repository or organization admin to approve your request by commenting \`/repo-bot approve\` or comment \`/repo-bot ping-admins\` to ping the organization administrators.`
  }

  return `${base} ✅ The information about the repository is looks good. You are only one step ahead from the repository being created. 
  Comment \`/repo-bot approve\` on this issue to initiate the repository creation`
}
