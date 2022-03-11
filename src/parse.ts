import {marked} from 'marked'
import {GitHub} from '@actions/github/lib/utils'
import * as core from '@actions/core'

export interface RepositoryInfo {
  parsedName?: string
  sanitizedName?: string
  templateName?: string
  resolvedTemplateName?: string
  canIssueAuthorRequestCreation: boolean
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
    canIssueAuthorRequestCreation: false
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
            sanitizeRepositoryName(repositoryInfo.templateName)
          )

          if (repositoryInfo.resolvedTemplateName) {
            repositoryInfo.canIssueAuthorRequestCreation =
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

  return repositoryInfo
}

async function tryResolveTemplate(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  repositoryName: string
): Promise<string | undefined> {
  const response = await api.rest.repos.get({
    owner: organizationName,
    repo: repositoryName
  })

  if (response.status === 200) {
    return response.data.name
  }

  return undefined
}
async function isUserAdminInRepository(
  api: InstanceType<typeof GitHub>,
  organizationName: string,
  templateName: string,
  issueAuthorUsername: string
): Promise<boolean> {
  // https://docs.github.com/en/rest/reference/collaborators#get-repository-permissions-for-a-user

  const permissionLevel = await api.rest.repos.getCollaboratorPermissionLevel({
    owner: organizationName,
    repo: templateName,
    username: issueAuthorUsername
  })

  if (permissionLevel.status !== 200) {
    return false
  }

  return permissionLevel.data.permission === 'admin'
}
function nextToken(tokens: marked.TokensList): marked.Token | undefined {
  do {
    const token = tokens.shift()
    if (!token) {
      return token
    }

    if (token.type === 'html' && token.text.trimStart().indexOf('<!--')) {
      continue
    }

    return token
  } while (true)
}
