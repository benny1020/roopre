import {
  gitlabApiUrl,
  validateGitHostEndpoint,
  type GitHostConnectionInfo,
  type GitRemote,
} from "../../shared/git-host.ts";
import { setTimeout as pause } from "node:timers/promises";

export type ChangeSnapshot = {
  id: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  sameRepository: boolean;
  mergeable?: boolean;
};
export type DraftChangeInput = {
  remote: GitRemote;
  head: string;
  base: string;
  title: string;
  body: string;
};
type Fetcher = typeof fetch;

function apiError(status: number) {
  return (
    (
      {
        401: "Git host authentication failed.",
        403: "Insufficient Git host permissions.",
        404: "Repository or API endpoint not found.",
      } as Record<number, string>
    )[status] ?? `Git host request failed (HTTP ${status})`
  );
}
function slug(remote: GitRemote) {
  return `${remote.namespace}/${remote.repository}`;
}

/** Provider API boundary. It never receives or returns a token to the renderer. */
export class GitHostAdapter {
  constructor(
    private info: GitHostConnectionInfo,
    private token: string,
    private request: Fetcher = fetch,
  ) {}
  private headers() {
    return this.info.kind === "github"
      ? {
          authorization: `Bearer ${this.token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        }
      : { "private-token": this.token, "content-type": "application/json" };
  }
  private url(path: string) {
    return this.info.kind === "github"
      ? `${validateGitHostEndpoint(this.info.endpoint)}${path}`
      : gitlabApiUrl(this.info.endpoint, path);
  }
  private async json(path: string, init?: RequestInit) {
    const response = await this.request(this.url(path), {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(apiError(response.status));
    }
    return response.json() as Promise<any>;
  }
  async getRepository(remote: GitRemote) {
    if (remote.host !== this.info.host)
      throw Error(
        "Selected Git host connection does not match the remote host.",
      );
    const path =
      this.info.kind === "github"
        ? `/repos/${slug(remote)}`
        : `/projects/${encodeURIComponent(slug(remote))}`;
    const result = await this.json(path);
    return {
      id: String(result.id),
      name: result.full_name ?? result.path_with_namespace,
      url: result.html_url ?? result.web_url,
    };
  }
  async createDraftChange(input: DraftChangeInput): Promise<ChangeSnapshot> {
    const repository = await this.getRepository(input.remote);
    const result =
      this.info.kind === "github"
        ? await this.json(`/repos/${slug(input.remote)}/pulls`, {
            method: "POST",
            body: JSON.stringify({
              title: input.title,
              body: input.body,
              head: input.head,
              base: input.base,
              draft: true,
            }),
          })
        : await this.json(
            `/projects/${encodeURIComponent(slug(input.remote))}/merge_requests`,
            {
              method: "POST",
              body: JSON.stringify({
                title: /^draft:/i.test(input.title)
                  ? input.title
                  : `Draft: ${input.title}`,
                description: input.body,
                source_branch: input.head,
                target_branch: input.base,
              }),
            },
          );
    return this.info.kind === "github"
      ? {
          id: String(result.number),
          url: result.html_url,
          state: result.merged_at
            ? "merged"
            : result.state === "opened"
              ? "open"
              : result.state,
          draft: !!result.draft,
          headSha: result.head.sha,
          baseSha: result.base.sha,
          headRef: result.head.ref,
          baseRef: result.base.ref,
          sameRepository:
            result.head.repo?.full_name === slug(input.remote) &&
            result.base.repo?.full_name === slug(input.remote),
          mergeable: result.mergeable ?? undefined,
        }
      : {
          id: String(result.iid),
          url: result.web_url,
          state: result.merged_at
            ? "merged"
            : result.state === "opened"
              ? "open"
              : result.state,
          draft:
            typeof result.draft === "boolean"
              ? result.draft
              : result.work_in_progress === true,
          headSha: result.sha ?? "",
          // start_sha is the target tip used by this diff; base_sha is its merge-base.
          baseSha: result.diff_refs?.start_sha ?? "",
          headRef: result.source_branch,
          baseRef: result.target_branch,
          sameRepository:
            String(result.source_project_id) === repository.id &&
            String(result.target_project_id) === repository.id,
          mergeable: result.merge_status === "can_be_merged",
        };
  }
  async snapshotChange(remote: GitRemote, id: string): Promise<ChangeSnapshot> {
    const repository = await this.getRepository(remote);
    const result =
      this.info.kind === "github"
        ? await this.json(
            `/repos/${slug(remote)}/pulls/${encodeURIComponent(id)}`,
          )
        : await this.json(
            `/projects/${encodeURIComponent(slug(remote))}/merge_requests/${encodeURIComponent(id)}`,
          );
    return this.info.kind === "github"
      ? {
          id: String(result.number),
          url: result.html_url,
          state: result.merged_at
            ? "merged"
            : result.state === "opened"
              ? "open"
              : result.state,
          draft: !!result.draft,
          headSha: result.head.sha,
          baseSha: result.base.sha,
          headRef: result.head.ref,
          baseRef: result.base.ref,
          sameRepository:
            result.head.repo?.full_name === slug(remote) &&
            result.base.repo?.full_name === slug(remote),
          mergeable: result.mergeable ?? undefined,
        }
      : {
          id: String(result.iid),
          url: result.web_url,
          state: result.merged_at
            ? "merged"
            : result.state === "opened"
              ? "open"
              : result.state,
          draft:
            typeof result.draft === "boolean"
              ? result.draft
              : result.work_in_progress === true,
          headSha: result.sha ?? "",
          baseSha: result.diff_refs?.start_sha ?? "",
          headRef: result.source_branch,
          baseRef: result.target_branch,
          sameRepository:
            String(result.source_project_id) === repository.id &&
            String(result.target_project_id) === repository.id,
          mergeable: result.merge_status === "can_be_merged",
        };
  }

  /** Find the same run after an interrupted POST; never infer a failed POST from an empty list. */
  async findChange(
    input: DraftChangeInput,
    marker: string,
  ): Promise<ChangeSnapshot | undefined> {
    await this.getRepository(input.remote);
    const params = new URLSearchParams(
      this.info.kind === "github"
        ? {
            state: "all",
            head: `${input.remote.namespace}:${input.head}`,
            base: input.base,
            per_page: "100",
          }
        : {
            scope: "all",
            source_branch: input.head,
            target_branch: input.base,
            per_page: "100",
          },
    );
    const results = await this.json(
      this.info.kind === "github"
        ? `/repos/${slug(input.remote)}/pulls?${params}`
        : `/projects/${encodeURIComponent(slug(input.remote))}/merge_requests?${params}`,
    );
    if (!Array.isArray(results) || results.length >= 100)
      throw Error(
        "Remote change lookup is incomplete. Inspect the remote branch manually.",
      );
    if (!results.length) return undefined;
    if (
      results.length !== 1 ||
      !(results[0].body ?? results[0].description ?? "").includes(marker)
    )
      throw Error(
        "This branch already has an unrelated or duplicate change. Inspect it on the Git host.",
      );
    const result = results[0];
    if (
      this.info.kind === "gitlab" &&
      result.source_project_id !== result.target_project_id
    )
      throw Error(
        "Cross-project merge requests cannot reuse this run's branch.",
      );
    return this.snapshotChange(
      input.remote,
      String(result.number ?? result.iid),
    );
  }

  /** New GitLab MRs populate diff_refs asynchronously. Bound waiting and preserve identity at the caller. */
  async waitForRefs(
    remote: GitRemote,
    initial: ChangeSnapshot,
  ): Promise<ChangeSnapshot> {
    let change = initial;
    for (let i = 0; i < 5 && (!change.headSha || !change.baseSha); i++) {
      await pause(400);
      change = await this.snapshotChange(remote, initial.id);
    }
    return change;
  }
}
