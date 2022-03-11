import * as core from '@actions/core'
import {handleIssues} from './issues'
import {handleIssueComment} from './issue_comments'

async function run(): Promise<void> {
  try {
    const eventName = core.getInput('event_name')
    const eventData = JSON.parse(core.getInput('event'))
    const token = core.getInput('token')
    const orgAdmins = core.getInput('org_admins')

    switch (eventName) {
      case 'issues':
        await handleIssues(eventData)
        break
      case 'issue_comment':
        await handleIssueComment(eventData, token, orgAdmins)
        break
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
