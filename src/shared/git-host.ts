import { z } from "zod";

export const gitHostKindSchema = z.enum(["github", "gitlab"]);
export type GitHostKind = z.infer<typeof gitHostKindSchema>;

const httpsEndpoint = z.string().url().max(2000);
const hostName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/);

export const gitHostConnectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  kind: gitHostKindSchema,
  host: hostName,
  endpoint: httpsEndpoint,
  token: z.string().min(1).max(4096).optional(),
});
export type GitHostConnectionInput = z.infer<
  typeof gitHostConnectionInputSchema
>;
export type GitHostConnectionInfo = Omit<
  GitHostConnectionInput,
  "token" | "id"
> & {
  id: string;
  version: number;
  hasToken: boolean;
  testedAt?: string;
  testStatus?: "passed" | "failed";
  diagnostic?: string;
};

export const gitRemoteSchema = z.object({
  url: z.string().min(1).max(2000),
  host: hostName,
  namespace: z.string().min(1).max(800),
  repository: z.string().min(1).max(200),
  kind: gitHostKindSchema.optional(),
});
export type GitRemote = z.infer<typeof gitRemoteSchema>;

export const gitHostBindingSchema = z.object({
  remote: gitRemoteSchema,
  connectionId: z.string().uuid().optional(),
});
export type GitHostBinding = z.infer<typeof gitHostBindingSchema>;

function rejectSecret(url: URL) {
  if (url.username || url.password || url.search || url.hash)
    throw Error(
      "Git remotes cannot contain credentials, query parameters or fragments.",
    );
}

function pathParts(path: string) {
  const parts = path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2)
    throw Error("Repository owner or group and name are required.");
  const repository = parts.pop()!.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9._-]+$/.test(repository))
    throw Error("Invalid repository name.");
  return { namespace: parts.join("/"), repository };
}

/** Parses only non-secret SSH/HTTPS remotes. Provider inference is intentionally conservative. */
export function parseGitRemote(value: string): GitRemote {
  const raw = value.trim();
  let host: string;
  let path: string;
  if (/^[^/@:\s]+@[^/:\s]+:.+$/.test(raw)) {
    const match = /^([^@]+)@([^/:\s]+):(.+)$/.exec(raw)!;
    if (match[1] !== "git")
      throw Error("SSH remotes must use the git username.");
    host = match[2].toLowerCase();
    path = match[3];
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw Error("Enter an HTTPS or git SSH remote URL.");
    }
    if (url.protocol === "ssh:") {
      if (url.username !== "git" || url.password || url.search || url.hash)
        throw Error("Invalid SSH remote format.");
    } else {
      if (url.protocol !== "https:")
        throw Error("Git remotes must use HTTPS or git SSH.");
      rejectSecret(url);
    }
    host = url.hostname.toLowerCase();
    path = url.pathname;
  }
  const kind =
    host === "github.com"
      ? "github"
      : host === "gitlab.com"
        ? "gitlab"
        : undefined;
  return { url: raw, host, ...pathParts(path), ...(kind ? { kind } : {}) };
}

export function validateGitHostEndpoint(value: string) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw Error("Git host endpoint must be HTTPS without credentials.");
  return endpoint.href.replace(/\/$/, "");
}

export function gitlabApiUrl(endpoint: string, path: string) {
  return `${validateGitHostEndpoint(endpoint).replace(/\/api\/v4$/, "")}/api/v4${path}`;
}
