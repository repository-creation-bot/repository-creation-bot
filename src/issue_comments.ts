import * as core from '@actions/core'
import {GitHub} from '@actions/github/lib/utils'
import {
  IssueCommentCreatedEvent,
  IssueCommentEvent
} from '@octokit/webhooks-definitions/schema'
import {buildRepositoryInfoComment} from './issues'
import {parseIssueToRepositoryInfo} from './parse'
import {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types'
import {OctokitResponse} from '@octokit/types'

type RepoGetResponse =
  RestEndpointMethodTypes['repos']['get']['response']['data']
type RepoCreateInOrgResponse =
  RestEndpointMethodTypes['repos']['createInOrg']['response']['data']
type RepoGetContentResponse =
  RestEndpointMethodTypes['repos']['getContent']['response']['data']

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
    body: `[repo-bot] Great, got some work to do 💪! I will start now creation of your repository, this might take a while until it is completed. 
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

  await commitCodeowners(api, repository.data, template.data)
  await cloneTeams(api, repository.data, template.data)
  await cloneBranchProtections(api, repository.data, template.data)
  await cloneLabels(api, repository.data, template.data)
  await cloneAutolinkReferences(api, repository.data, template.data)

  return repository.data.html_url
}

async function commitCodeowners(
  api: InstanceType<typeof GitHub>,
  repository: RepoCreateInOrgResponse,
  template: RepoGetResponse
): Promise<void> {
  let codeOwnersFile: OctokitResponse<RepoGetContentResponse> | undefined =
    undefined
  // https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-file-location
  const codeOwnersLocations = [
    'CODEOWNERS',
    '.github/CODEOWNERS',
    'docs/CODEOWNERS'
  ]
  for (const location of codeOwnersLocations) {
    try {
      const result = await api.rest.repos.getContent({
        owner: template.owner.login,
        repo: template.name,
        path: location
      })
      if (
        result.status === 200 &&
        'type' in result.data &&
        result.data.type === 'file'
      ) {
        codeOwnersFile = result
        break
      }
    } catch (e) {
      // skip
    }
  }

  if (!codeOwnersFile) {
    core.info('No CODEOWNERS file founds skipping')
    return
  }

  if ('type' in codeOwnersFile.data && codeOwnersFile.data.type === 'file') {
    core.info('Adding codeowners')

    await api.rest.repos.createOrUpdateFileContents({
      owner: repository.owner.login,
      repo: repository.name,
      path: codeOwnersFile.data.path,
      message: '[repo-bot] Adding CODEOWNERS',
      content: (codeOwnersFile.data as any).content
    })

    core.info('Codeowners added')
  }
}

async function cloneTeams(
  api: InstanceType<typeof GitHub>,
  repository: RepoCreateInOrgResponse,
  template: RepoGetResponse
): Promise<void> {
  const teams = await api.paginate(api.rest.repos.listTeams, {
    owner: template.owner.login,
    repo: template.name,
    per_page: 100
  })

  core.info('Adding teams')
  for (const team of teams) {
    await api.rest.teams.addOrUpdateRepoPermissionsInOrg({
      org: template.owner.login,
      team_slug: team.slug,
      owner: repository.owner.login,
      repo: repository.name,
      permission: team.permission as any
    })
  }
  core.info('teams added')
}

interface BranchProtectionNode {
  id: string
  allowsDeletions: boolean
  allowsForcePushes: boolean
  dismissesStaleReviews: boolean
  isAdminEnforced: boolean
  pattern: string
  requiredApprovingReviewCount: number
  requiresApprovingReviews: boolean
  requiresCodeOwnerReviews: boolean
  requiresCommitSignatures: boolean
  requiresConversationResolution: boolean
  requiresLinearHistory: boolean
  requiresStatusChecks: boolean
  requiresStrictStatusChecks: boolean
  restrictsPushes: boolean
  restrictsReviewDismissals: boolean
}

interface GetBranchProtectionsReponse {
  repository: {
    id: string
    branchProtectionRules: {
      nodes: BranchProtectionNode[]
    }
  }
}

interface CreateBranchProtectionRuleInput {
  repositoryId: string
  allowsDeletions: boolean
  allowsForcePushes: boolean
  dismissesStaleReviews: boolean
  isAdminEnforced: boolean
  pattern: string
  requiredApprovingReviewCount: number
  requiresApprovingReviews: boolean
  requiresCodeOwnerReviews: boolean
  requiresCommitSignatures: boolean
  requiresConversationResolution: boolean
  requiresLinearHistory: boolean
  requiresStatusChecks: boolean
  requiresStrictStatusChecks: boolean
  restrictsPushes: boolean
  restrictsReviewDismissals: boolean
}

async function cloneBranchProtections(
  api: InstanceType<typeof GitHub>,
  repository: RepoCreateInOrgResponse,
  template: RepoGetResponse
): Promise<void> {
  core.info('Adding branch protections')

  const branchProtections = await api.graphql<GetBranchProtectionsReponse>(
    `
        query getBranchProtections($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
                id,
                branchProtectionRules(first: 50) {
                    nodes {
                        id,
                        allowsDeletions,
                        allowsForcePushes,
                        dismissesStaleReviews,
                        isAdminEnforced,
                        pattern,
                        requiredApprovingReviewCount,
                        requiresApprovingReviews,
                        requiresCodeOwnerReviews,
                        requiresCommitSignatures,
                        requiresConversationResolution,
                        requiresLinearHistory,
                        requiresStatusChecks,
                        requiresStrictStatusChecks,
                        restrictsPushes,
                        restrictsReviewDismissals
                    }
                }
            }
        }    
    `,
    {
      owner: template.owner.login,
      name: template.name
    }
  )
  const graphQLTargetRepository =
    await api.graphql<GetBranchProtectionsReponse>(
      `
        query get($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
                id
            }
        }    
    `,
      {
        owner: repository.owner.login,
        name: repository.name
      }
    )

  for (const protection of branchProtections.repository.branchProtectionRules
    .nodes) {
    const input: CreateBranchProtectionRuleInput = {
      repositoryId: graphQLTargetRepository.repository.id,
      allowsDeletions: protection.allowsDeletions,
      allowsForcePushes: protection.allowsForcePushes,
      dismissesStaleReviews: protection.dismissesStaleReviews,
      isAdminEnforced: protection.isAdminEnforced,
      pattern: protection.pattern,
      requiredApprovingReviewCount: protection.requiredApprovingReviewCount,
      requiresApprovingReviews: protection.requiresApprovingReviews,
      requiresCodeOwnerReviews: protection.requiresCodeOwnerReviews,
      requiresCommitSignatures: protection.requiresCommitSignatures,
      requiresConversationResolution: protection.requiresConversationResolution,
      requiresLinearHistory: protection.requiresLinearHistory,
      requiresStatusChecks: protection.requiresStrictStatusChecks,
      requiresStrictStatusChecks: protection.requiresStrictStatusChecks,
      restrictsPushes: protection.restrictsPushes,
      restrictsReviewDismissals: protection.restrictsReviewDismissals
    }

    await api.graphql(
      `
            mutation($input:CreateBranchProtectionRuleInput!) {
                createBranchProtectionRule(input:$input) {
                    branchProtectionRule {
                        id
                    }
                }
            }
        `,
      {
        input: input
      }
    )
  }

  core.info('branch protections added')
}

async function cloneLabels(
  api: InstanceType<typeof GitHub>,
  repository: RepoCreateInOrgResponse,
  template: RepoGetResponse
): Promise<void> {
  await deleteOldLabels(api, repository)

  core.info('Adding new labels')
  const templateLabels = await api.paginate(api.rest.issues.listLabelsForRepo, {
    owner: template.owner.login,
    repo: template.name
  })
  for (const label of templateLabels) {
    await api.rest.issues.createLabel({
      owner: repository.owner.login,
      repo: repository.name,
      name: label.name,
      description: label.description ?? '',
      color: label.color
    })
  }
  core.info('Labels added')
}

async function deleteOldLabels(
  api: InstanceType<typeof GitHub>,
  repository: RepoCreateInOrgResponse
) {
  const repoLabels = await api.paginate(api.rest.issues.listLabelsForRepo, {
    owner: repository.owner.login,
    repo: repository.name
  })

  core.info('Deleting old labels')
  for (const existingLabel of repoLabels) {
    await api.rest.issues.deleteLabel({
      owner: repository.owner.login,
      repo: repository.name,
      name: existingLabel.name
    })
  }
  core.info('Deleted')
}

async function cloneAutolinkReferences(
  api: InstanceType<typeof GitHub>,
  repository: RepoCreateInOrgResponse,
  template: RepoGetResponse
): Promise<void> {
  const templateReferences = await api.paginate(api.rest.repos.listAutolinks, {
    owner: template.owner.login,
    repo: template.name
  })
  core.info('Adding new Autolink References')
  for (const reference of templateReferences) {
    await api.rest.repos.createAutolink({
      owner: repository.owner.login,
      repo: repository.name,
      key_prefix: reference.key_prefix,
      url_template: reference.url_template
    })
  }
  core.info('Autolink References added')
}
