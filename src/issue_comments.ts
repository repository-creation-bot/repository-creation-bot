import * as core from '@actions/core'

export async function handleIssueComment(
  eventData: any,
  token: string,
  orgAdmins: string
) {
    core.debug(`Handling issue comment ${JSON.stringify(eventData, null, 2)}`)
}
