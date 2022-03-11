import * as core from '@actions/core'
import github from '@actions/github'
import {handleIssues} from './issues'
import {handleIssueComment} from './issue_comments'
import {
  IssuesEvent,
  IssueCommentEvent
} from '@octokit/webhooks-definitions/schema'
import {OctokitOptions} from '@octokit/core/dist-types/types'

async function run(): Promise<void> {
  try {
    const token = core.getInput('token')
    const orgAdmins = core.getInput('org_admins')
    const apiUrl = core.getInput('api_url')

    const options: OctokitOptions = apiUrl ? {baseUrl: apiUrl} : {}
    const octokit = github.getOctokit(token, options)

    switch (github.context.eventName) {
      case 'issues':
        await handleIssues(octokit, github.context.payload as IssuesEvent)
        break
      case 'issue_comment':
        await handleIssueComment(
          octokit,
          github.context.payload as IssueCommentEvent,
          orgAdmins
        )
        break
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
