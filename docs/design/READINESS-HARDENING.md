# Readiness hardening

The October 7 review found that fixed checks could be bypassed through a newly created pnpm workspace configuration, approved results could survive memory invalidation, and publishing could lose remote identity or use the wrong GitLab target snapshot. This change closes those paths without relaxing human design approval or immutable checks.

## Execution and approval

- Existing tests, dependency manifests and execution configuration remain immutable. New pnpm workspace files, nested package-manager configuration and lockfiles join the protected fingerprint. Discovery fails closed at its traversal limit.
- Conversation-derived memory deactivation invalidates affected approvals and reconciles completed runs as well as queued runs. Publishing checks the current human approval binding and the verified run contract.
- Retrying a failed run preserves the capacity snapshot, including per-stage agent limits, rather than expanding to current defaults.
- Node dependency preparation supports standalone npm/pnpm packages. Workspace layouts and local dependency protocols are refused before model execution, with an actionable diagnostic. Full monorepo dependency mounting is still unsupported. Repository `.npmrc` accompanies standalone preparation.
- Java preparation resolves the compile/test classpaths in a private source copy. Each agent, verification and review container receives its own writable disk cache cloned from the prepared cache. It cannot inherit an implementation agent's cache or consume the shared `/tmp` memory allowance.

## Remote publishing contract

A short workspace transaction validates current approval, run status, termination and frozen execution evidence, then stores a handoff ownership token. Contract-changing commands, memory mutation and environment migration cannot pass while publishing is admitted. Unrelated project commands continue to work. External network I/O does not keep a database transaction open.

Push and create intents are persisted before remote writes. Branch, PR/MR ID and URL survive post-creation verification failures. GitLab draft creation uses the supported `Draft:` title prefix, honors an explicit server `draft: false`, and waits a bounded number of times for `diff_refs`. Target verification uses `start_sha` and the current remote target tip; merge-base `base_sha` cannot substitute for the target commit. Source/target branch and repository identity must also match.

After an interrupted request, the existing change is queried using saved ID or an exact run marker and branch pair. An empty lookup after an uncertain POST is not permission to create again. Duplicate, closed, merged, non-draft or retargeted changes remain unverified. Read-only reconciliation remains available after approval invalidation; it never pushes or creates a change. The UI distinguishes verified publishing from incomplete remote evidence.

Electron's single-instance ownership permits local recovery of stale handoff tokens. A detached Git process or a request already received by a Git host may still finish after process loss. Persisted intents therefore remain uncertain until remote evidence can be reconciled. This contract guarantees approved admission and evidence preservation, not cancellation of a write already accepted externally. Git host checks and human merge approval remain separate.

## Settings and onboarding

Both editors preserve existing timeout, repair count, web-check selection, Git binding and unrepresented profile fields. Runtime settings expose repair limits explicitly. Onboarding saves and resumes credential-free HTTPS endpoints; API keys remain excluded from drafts.

## Validation boundary

Regression coverage includes real PostgreSQL approval guards, real Docker pnpm bypass rejection, and a multi-module Spring Boot project with actual Java compilation, a failing JUnit assertion, repair, fresh verification and read-only review. Agent responses are fixtures, not real provider quality evidence. A warmed 600 MiB cache exercises the disk-cache path beyond the previous 512 MiB `/tmp` allowance.

Actual paid-provider use, disposable enterprise GitLab/SSO/CA connectivity, private Maven credentials, Testcontainers, and signed/notarized clean-Mac distribution remain separate acceptance work. Existing test/config maintenance requires an independently reviewed baseline update before a feature run; this release does not grant agents permission to weaken those files.

Sources: [GitLab merge requests API](https://docs.gitlab.com/api/merge_requests/), [draft merge requests](https://docs.gitlab.com/user/project/merge_requests/drafts/).
