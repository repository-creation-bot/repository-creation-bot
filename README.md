# repository-creation-bot

A bot for creating repositories in a GitHub Organization through Issues and GitHub Actions. The primary use case if for GitHub Enterprise environments where usually only elected people/teams can create repositories. To reduce load on the organization administrator, this bot helps auto creating repositories through a (semi-)automatic workflow considering following a certain process and rules.

## Setup

1. Create an issue template for the user inputs. The values are parsed by special headings which have the corresponding value as body. The nesting of the heading is not relevant. This theoretically allows the usage of issue forms too.

```markdown
---
name: Request a new repository.
about: Request the creation of a new repository within the organization.

---
Fill out the request form by replacing the values below with your requested values. 
This template will be parsed by our automatic repo creation bot.
Keep the structure as it is otherwise the bot will not work.

### Repository Name
<!-- The name of the repository you want to have, keep existing naming conventions. -->
repository-name

### Template Repository
<!-- The repository that should act as template for the new one -->
template-repository
```

2. Create a new GitHub Actions workflow file in the repository in which the bot should listen for issues. The workflow needs to listen for the events `issues.opened`, `issues.edited` and `issue_comment.created` to get activated correctly.

3. Add this action to a job in you workflow steps `repository-creation-bot/repository-creation-bot@v1` and configure it. 

### Step Input parameters

* `org_admins` The name of the team which will be pinged if admin level approval is needed.
* `token` A personal access token which has access to all repos as admin and can create new repos. Will be used for all API interactions to create the repository and comment on the issues.
* `event_name` Needs to be set to `${{ github.event_name }}` so that the action can decide what to do. 
* `event` Needs to be set to `${{ github.event }}` so that all data of the event is available and the action can do what it should do. 

### Full workflow example

```yml
on:
  issues:
    types: [opened, edited]
  issue_comment:
    types: [created]
jobs: 
  repo_bot:
    runs-on: ubuntu-latest
    steps:
      - uses: repository-creation-bot/repository-creation-bot@v1
        with:
          org_admins: repository-creation-bot/org-admins
          token: ${{ secrets.org-token }}
          event_name: ${{ github.event_name }}
          event: ${{ toJSON(github.event) }}

```

## User Journey

1. Any organization member can open a new issue in a repository within the organization following a certain template which provides the name of the repository to create and a template which should act as template for the new repository. 
2. The bot will get activated by the opening of these issues. It will validate and parse the user input and then ask for confirmation on the request. Following conventions are applied: 

    * The repository name is converted to kebab-case.

3. The user who opened the request, needs to reply and confirm the understanding of the bot. If it is not correct, he can edit the original text of the issue.

4. If the issue author has administrator privileges in the template repository and the name of the new starts with a substring of the template repository name the bot will automatically proceed with creation of the repository and close the issue. (e.g. an admin of the repository `team01-module01` requests a new repository named `team01-module02` based on `team01-module01`). 

5. If the issue author is not privileged, a preconfigured organization administrator (user or team) is pinged to approve the request. 

## Supported settings
Following settings of will be taken over from the template to the new repository: 

* General repository settings like enabled features, pull request settings, etc. 
* Assigned collaborators and teams with their corresponding privileges.
* Branch protections
* Actions permissions
* Labels
* Autolink References
* Issue templates if existing
* Codeowners file if existing

## Thoughts behind this ruleset

* Usually organization administrators decide which repositories can be created to ensure correct naming conventions and rules to be followed. Then admins are assigned to the repo to actually use it. 
* By this repo admins are considered as responsible leads for a certain set of repositories and are thereby granted to request further repositories for their needs based on repos they already "own". 
* Organization administrators might only need to step in if somebody requests a repository outside their responsibility. This way naming conventions are followed.