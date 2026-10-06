import {
  gitlabApiUrl,
  validateGitHostEndpoint,
  type GitHostConnectionInfo,
  type GitRemote,
} from "../../shared/git-host.ts";

export type ChangeSnapshot = {
  id: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headSha: string;
  baseSha: string;
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
      name: result.full_name ?? result.path_with_namespace,
      url: result.html_url ?? result.web_url,
    };
  }
  async createDraftChange(input: DraftChangeInput): Promise<ChangeSnapshot> {
    await this.getRepository(input.remote);
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
                title: input.title,
                description: input.body,
                source_branch: input.head,
                target_branch: input.base,
                draft: true,
              }),
            },
          );
    return this.info.kind === "github"
      ? {
          id: String(result.number),
          url: result.html_url,
          state: result.merged_at ? "merged" : result.state,
          draft: !!result.draft,
          headSha: result.head.sha,
          baseSha: result.base.sha,
          mergeable: result.mergeable ?? undefined,
        }
      : {
          id: String(result.iid),
          url: result.web_url,
          state: result.merged_at ? "merged" : result.state,
          draft: result.draft || /^draft:/i.test(result.title),
          headSha: result.sha,
          baseSha: result.diff_refs?.base_sha ?? "",
          mergeable: result.merge_status === "can_be_merged",
        };
  }
  async snapshotChange(remote: GitRemote, id: string): Promise<ChangeSnapshot> {
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
          state: result.merged_at ? "merged" : result.state,
          draft: !!result.draft,
          headSha: result.head.sha,
          baseSha: result.base.sha,
          mergeable: result.mergeable ?? undefined,
        }
      : {
          id: String(result.iid),
          url: result.web_url,
          state: result.merged_at ? "merged" : result.state,
          draft: result.draft || /^draft:/i.test(result.title),
          headSha: result.sha,
          baseSha: result.diff_refs?.base_sha ?? "",
          mergeable: result.merge_status === "can_be_merged",
        };
  }
}
