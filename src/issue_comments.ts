import * as core from '@actions/core'
import {GitHub} from '@actions/github/lib/utils'
import {IssueCommentEvent} from '@octokit/webhooks-definitions/schema'

export async function handleIssueComment(
  api: InstanceType<typeof GitHub>,
  eventData: IssueCommentEvent,
  orgAdmins: string
) {
  core.debug(`Handling issue comment ${JSON.stringify(eventData, null, 2)}`)
}
