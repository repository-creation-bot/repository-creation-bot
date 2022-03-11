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
      await api.rest.issues.createComment({
        owner: eventData.repository.owner.login,
        repo: eventData.repository.name,
        issue_number: eventData.issue.number,
        body: `[repo-bot] Hey @${orgAdmins} 👋! It seems ${eventData.comment.user.login} is either facing troubles or needs your approval for this request.`
      })
      break
    case 'approve':
      await approve(api, eventData)
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
async function approve(
  api: InstanceType<typeof GitHub>,
  eventData: IssueCommentCreatedEvent
) {
  core.debug(
    `Starting approval process, checking permissions and repo settings again`
  )

  const repositoryInfo = await parseIssueToRepositoryInfo(
    api,
    eventData.repository.owner.login,
    eventData.comment.user.login,
    eventData.issue.body
  )

  core.debug(`Parsed repository information: ${JSON.stringify(repositoryInfo)}`)
  if (!repositoryInfo.canIssueAuthorApproveCreation) {
    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body: `[repo-bot] Sorry but it seems you are not having the required permissions to approve the repository creation 😞.
      Please reach out to one of the administrators of the \`${repositoryInfo.resolvedTemplateName}\` to approve this request, or
      use \`/repo-admin ping-admins\` to ping the organization admins for approval. You might want to reach out to them also separately 
      depending on how urgent and long-running this repository creation might be.`
    })
    return
  }

  if (!repositoryInfo.sanitizedName || !repositoryInfo.resolvedTemplateName) {
    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body:
        `[repo-bot] Sorry, but it seems there are still some issues with your request. These issues need to be resolved before we can create the repository.` +
        buildRepositoryInfoComment(repositoryInfo)
    })
    return
  }

  await api.rest.issues.createComment({
    owner: eventData.repository.owner.login,
    repo: eventData.repository.name,
    issue_number: eventData.issue.number,
    body: `[repo-bot] Great, some work to do 💪! I will start now creation of your repository, this might take a while until it is completed. 
    I will close this issue once the repository was created. `
  })

  try {
    const repositoryUrl = await createRepositoryFromTemplate(
      api,
      eventData.repository.owner.login,
      repositoryInfo.sanitizedName,
      repositoryInfo.resolvedTemplateName
    )

    await api.rest.issues.createComment({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      body: `[repo-bot] 🥳🎉 The repository creation completed without errors. You can now access the repository at ${repositoryUrl}. Happy coding. I will close this issue now.`
    })
    await api.rest.issues.update({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      state: 'closed'
    })
    await api.rest.issues.lock({
      owner: eventData.repository.owner.login,
      repo: eventData.repository.name,
      issue_number: eventData.issue.number,
      lock_reason: 'resolved'
    })
  } catch (e) {
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
  if(Math.random() >= 0.5) {
    throw new Error(
      'Actual creation is not yet implemented. Still some work to do.'
    )
  }
  return 'https://TODO'
}
