import * as core from '@actions/core'
import {GitHub} from '@actions/github/lib/utils'
import {IssueCommentEvent} from '@octokit/webhooks-definitions/schema'

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
      await api.rest.issues.createComment({
        owner: eventData.repository.owner.login,
        repo: eventData.repository.name,
        issue_number: eventData.issue.number,
        body: `[repo-bot] Hey @${orgAdmins} 👋! It seems ${eventData.comment.user.login} is either facing troubles or needs your approval for this request.`
      })
      break
    case 'approve':
      // TODO
      break
    default:
      await api.rest.issues.createComment({
        owner: eventData.repository.owner.login,
        repo: eventData.repository.name,
        issue_number: eventData.issue.number,
        body: `[repo-bot] I did not understand the command \`${command}\` it is not a known command, known are:
* \`ping-admins\` - will create a comment in this issue which will ping the organization admins
* \`approve\` - approve the request and initiate the repository creation (will fail if user commenting is not allowed to approve) 
        `
      })
      break
  }
}
