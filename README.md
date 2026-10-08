<img src="resources/icon.png" width="96" height="96" alt="Roopre icon" />

# Roopre

An Agentic Development Environment for macOS. Define intent, approve a design, and supervise agents as they implement, verify and review the work.

Roopre standardizes how developers work, while each developer owns their local projects and approvals. **The current beta is a local workspace, not a shared team server or SSO product.** New installations contain no sample projects, fictional teammates or fabricated results.

[Design](docs/design/PRODUCT-DESIGN-v0.2.md) · [English workspace](docs/design/ENGLISH-WORKSPACE.md) · [Architecture](docs/ARCHITECTURE.md) · [Verification](docs/VERIFICATION.md) · [Distribution](docs/DISTRIBUTION.md) · [Changelog](CHANGELOG.md)

## Start from source

Requires Apple Silicon macOS, Node.js 24, pnpm 11.0.4, Xcode Command Line Tools, Git and Docker Desktop. For packaged installations, see the [setup and recovery guide](resources/setup/README.md).

```bash
git clone https://github.com/benny1020/roopre.git
cd roopre
pnpm install --frozen-lockfile
pnpm db:start
pnpm runner:image
pnpm dev
```

The Electron app connects directly to PostgreSQL. `pnpm dev` also starts a separate local development API on `127.0.0.1:4318` and browser preview on `4317`. The preview uses a separate workspace. Existing database volumes and history are preserved; stop the development database with `pnpm db:stop`.

`0.4.0-beta.1` remains a beta candidate. Builds and fixture tests do not establish public release readiness, signing, notarization or successful execution against a real model provider.

## Development loop

1. **Connect.** Getting started prepares the environment and repository. In **Settings → Standards, connections & runtime**, register an HTTPS endpoint, model ID and API key or bearer token. Only Anthropic Messages-compatible connections are currently supported. Connection tests make a small paid model request.
2. **Define intent.** Create a feature with measurable acceptance criteria such as `AC01`. Planning agents can inspect the repository and prepare requirements and a design without writing source code.
3. **Review the plan.** Publish the design, read its review brief and select **Approve design** or **Request changes**. No macOS password or Touch ID is required. Existing Korean documents and English documents both work.
4. **Build.** Select **Build & verify → Start implementation**. The approved design, instructions, environment and checks are pinned for the run.
5. **Verify and review.** Inspect changed files, fixed-check exit codes, current-attempt evidence, independent review and artifacts. Retry preserves changes; earlier passes never substitute for current evidence.
6. **Integrate.** Review the verified result and explicitly publish a branch or create a draft PR/MR. Follow your existing merge and deployment process.

**Home** prioritizes decisions, live agents and project progress. **Work** opens features in a list or stage board. **Agents** shows execution, and **Quality** compares recorded results, attempts, evidence and reported costs. Search commands, projects and features with `⌘K`.

## Agents and shared standards

In **Settings → Agents & workflow**, define global or project agents using Markdown, import/export roles and assign multiple agents to each stage. A role description can be refined with AI before you review and apply the suggestion. Stages run in parallel by default; choose sequential execution when one role needs another's result.

In **Settings → Harness standards**, import a local folder or HTTPS Git repository, edit Markdown, compare changes, map local connections and apply a versioned standard. Export the folder to maintain company standards in a dedicated Git repository. Keys, local repository paths, user data and approval records are excluded. See the [Harness v1 specification](docs/specs/HARNESS-V1.md).

Contextual agent consultations are read-only. Conversations preserve raw messages, bounded summaries and source references. Only explicitly confirmed work memories enter future approved execution inputs; changing them requires affected designs to be reviewed again. See [agent conversations and memory](docs/AGENT-CONVERSATIONS.md).

## Execution and security boundaries

- Independent feature worktrees and Docker isolation. Defaults: 3 workspace runs, 2 per project and 3 parallel agents per stage, configurable in Settings. Same-project tasks can run concurrently.
- API keys and Git tokens are encrypted locally. Model credentials remain in the host broker rather than agent containers.
- Repository profiles support standalone locked npm/pnpm projects and Java 21 / Gradle 8 / Spring Boot checks. Node workspaces/local dependencies are rejected before model execution; they need workspace-aware preparation. Web changes can require configured e2e commands.
- GitHub, GitHub Enterprise, GitLab, self-managed GitLab and generic Git support. Draft PR/MR handoff locks the current approved contract, verifies remote branch/SHA identity and preserves uncertain outcomes for read-only reconciliation; it does not merge automatically.
- Required implementation/review roles, fixed checks and design approval gates cannot be bypassed through project settings. Cancellation, retry and termination confirmation preserve evidence.
- English product UI, dark/light/system appearance, keyboard commands, resizable panels, workflow graphs, diffs and execution logs. User-authored content is preserved in its original language.

Docker and PostgreSQL must be available. App exit or Mac sleep can interrupt local work; inspect preserved state before retrying. There is no always-on cloud executor, shared team authentication or automatic update service in this beta.

## Development commands

| Command                                  | Purpose                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`                               | Local API and Electron development workspace                                                    |
| `pnpm dev:desktop`                       | Electron development workspace only                                                             |
| `pnpm server` / `pnpm dev:web`           | Local API / browser preview                                                                     |
| `pnpm check`                             | Formatting, document integrity, types, build and tests; PostgreSQL required                     |
| `pnpm test:web`                          | Renderer workflows, keyboard and accessibility checks                                           |
| `pnpm test:desktop`                      | Native Electron startup, persistence and recovery fixtures                                      |
| `pnpm test:conversation`                 | Native conversation integration fixtures                                                        |
| `pnpm runner:image` / `pnpm test:runner` | Runner image / Docker integration with fixture agents                                           |
| `pnpm check:mac`                         | Temporary macOS packaging and integrity check; no ZIP                                           |
| `pnpm build:mac`                         | Development app, ZIP and checksums in `release/<version>/`                                      |
| `pnpm start`                             | Launch the built Electron app                                                                   |
| `pnpm verify:mac`                        | Package contents, fuses and signing integrity                                                   |
| `pnpm release:mac`                       | Requires Developer ID and notarization profiles; creates but does not publish a release archive |

Use an independent [PR reviewer](docs/PR-REVIEW-PROCESS.md), preserve test and approval gates, and distinguish agent claims from reproducible execution evidence. Contributor instructions are in [CONTRIBUTING](CONTRIBUTING.md) and [AGENTS](AGENTS.md).
