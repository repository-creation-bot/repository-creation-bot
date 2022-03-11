import * as core from '@actions/core'

export async function handleIssues(eventData: any) {
  core.debug(`Handling issues ${JSON.stringify(eventData, null, 2)}`)
}
