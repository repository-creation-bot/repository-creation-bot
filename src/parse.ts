import {marked} from 'marked'
import {GitHub} from '@actions/github/lib/utils'
import * as core from '@actions/core'
import {isatty} from 'tty'

export interface RepositoryInfo {
  parsedName?: string
  sanitizedName?: string
  templateName?: string
  resolvedTemplateName?: string
  isIssueAuthorAdminInTemplate: boolean
  commonPrefix?: string
  canIssueAuthorApproveCreation: boolean
}

function toKebabCase(str: string): string {
  return str
    .split('')
    .map((letter, idx) => {
      if (
        letter === ' ' ||
        letter === '\t' ||
        letter === '\r' ||
        letter === '\n'
      ) {
        return ''
      }
      if (letter === '-') {
        return '-'
      }
      return letter.toUpperCase() === letter
        ? `${idx !== 0 ? '-' : ''}${letter.toLowerCase()}`
        : letter
    })
    .join('')
}

function sanitizeRepositoryName(templateName: string): string {
  templateName = toKebabCase(templateName)
  return templateName
}

export async function parseIssueToRepositoryInfo(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  issueAuthorUsername: string,
  issueBody: string
): Promise<RepositoryInfo> {
  const tokens = marked.lexer(issueBody)

  core.debug(`Parsed markdown to ${JSON.stringify(tokens, null, 2)}`)

  const repositoryInfo: RepositoryInfo = {
    canIssueAuthorApproveCreation: false,
    isIssueAuthorAdminInTemplate: false
  }

  while (tokens.length > 0) {
    let token = nextToken(tokens)
    if (token?.type === 'heading') {
      switch (token.text.trim().toLowerCase()) {
        case 'repository name':
          token = nextToken(tokens)
          if (token?.type !== 'paragraph') {
            throw new Error(
              'Could not parse repository name, no paragraph after repository name heading'
            )
          }
          repositoryInfo.parsedName = token.text.trim()
          repositoryInfo.sanitizedName = sanitizeRepositoryName(
            repositoryInfo.parsedName
          )
          break
        case 'template repository':
          token = nextToken(tokens)
          if (token?.type !== 'paragraph') {
            throw new Error(
              'Could not parse template repository name, no paragraph after template repository heading'
            )
          }
          repositoryInfo.templateName = token.text.trim()
          repositoryInfo.resolvedTemplateName = await tryResolveTemplate(
            api,
            organizationName,
            repositoryInfo.templateName
          )

          if (repositoryInfo.resolvedTemplateName) {
            repositoryInfo.isIssueAuthorAdminInTemplate =
              await isUserAdminInRepository(
                api,
                organizationName,
                repositoryInfo.resolvedTemplateName,
                issueAuthorUsername
              )
          }

          break
      }
    }
  }

  if (repositoryInfo.sanitizedName && repositoryInfo.resolvedTemplateName) {
    repositoryInfo.commonPrefix = detectCommonPrefix(
      repositoryInfo.sanitizedName,
      repositoryInfo.resolvedTemplateName
    )
    repositoryInfo.canIssueAuthorApproveCreation =
      (repositoryInfo.isIssueAuthorAdminInTemplate &&
        !!repositoryInfo.commonPrefix) ||
      (await canUserCreateOrgRepositories(
        api,
        organizationName,
        issueAuthorUsername
      ))
  }

  return repositoryInfo
}

async function tryResolveTemplate(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  repositoryName: string
): Promise<string | undefined> {
  try {
    core.debug(
      `Resolving template repo with owner=${organizationName} and repo=${repositoryName}`
    )

    const response = await api.rest.repos.get({
      owner: organizationName,
      repo: repositoryName
    })

    if (response.status === 200) {
      return response.data.name
    }

    return undefined
  } catch (e) {
    return undefined
  }
}
async function isUserAdminInRepository(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  templateName: string,
  issueAuthorUsername: string
): Promise<boolean> {
  try {
    const permissionLevel = await api.rest.repos.getCollaboratorPermissionLevel(
      {
        owner: organizationName,
        repo: templateName,
        username: issueAuthorUsername
      }
    )

    if (permissionLevel.status !== 200) {
      return false
    }

    return permissionLevel.data.permission === 'admin'
  } catch (e) {
    return false
  }
}
function nextToken(tokens: marked.TokensList): marked.Token | undefined {
  do {
    const token = tokens.shift()
    if (!token) {
      return token
    }

    if (token.type === 'html' && token.text.trimStart().startsWith('<!--')) {
      continue
    }

    return token
  } while (true)
}

function detectCommonPrefix(
  repoName: string,
  templateName: string
): string | undefined {
  // we assume kebab-case
  const repoNameParts = repoName.split('-')
  const templateNameParts = templateName.split('-')
  const matchingParts: string[] = []

  let i = 0
  while (i < repoNameParts.length) {
    if (repoNameParts[i] == templateNameParts[i]) {
      matchingParts.push(repoNameParts[i])
      i++
    } else {
      break
    }
  }

  return matchingParts.length > 0 ? matchingParts.join('-') : undefined
}

async function canUserCreateOrgRepositories(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  username: string
): Promise<boolean> {
  try {
    const membership = await api.rest.orgs.getMembershipForUser({
      org: organizationName,
      username: username
    })

    return (
      membership.data.permissions?.can_create_repository ??
      membership.data.role === 'admin'
    )
  } catch (e) {
    return false
  }
}
