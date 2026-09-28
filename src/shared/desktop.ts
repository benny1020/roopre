import type { RefinementInput, RefinementOutput } from "./agent-refinement";
import type { PackageCandidate } from "./harness-package";
import type { BootstrapStatus, OnboardingProgress } from "./onboarding";
import type { Command, Snapshot } from "./contracts";
import type {
  ConnectionInput,
  ConnectionInfo,
  ExecutionProfile,
} from "./runtime";
import type {
  GitHostConnectionInfo,
  GitHostConnectionInput,
  GitRemote,
} from "./git-host";
import type {
  ConversationScope,
  ConversationThread,
  ConversationTurn,
  SendTurnInput,
} from "./conversations";
export interface DesktopAPI {
  name: string;
  refineAgent: (input: RefinementInput) => Promise<RefinementOutput>;
  harnessCandidate: (
    input:
      | { kind: "default" | "folder" }
      | { kind: "project"; projectId: string }
      | { kind: "git"; url: string; ref: string }
      | { kind: "json"; text: string },
  ) => Promise<PackageCandidate | null>;
  harnessApply: (input: {
    token: string;
    projectId: string;
    profileId: string;
    expectedRevision: number;
    bindings: Record<string, string>;
  }) => Promise<unknown>;
  harnessExport: (token: string) => Promise<string | null>;
  readMarkdown: () => Promise<string | null>;
  exportAgent: (id: string) => Promise<void>;
  bootstrap: () => Promise<BootstrapStatus>;
  migrateEnvironment: () => Promise<BootstrapStatus>;
  prepareEnvironment: () => Promise<BootstrapStatus>;
  cancelEnvironment: () => Promise<BootstrapStatus>;
  onboarding: (progress: OnboardingProgress) => Promise<BootstrapStatus>;
  snapshot: () => Promise<Snapshot>;
  command: (command: Command) => Promise<{ entityId?: string }>;
  connections: () => Promise<ConnectionInfo[]>;
  saveConnection: (input: ConnectionInput) => Promise<ConnectionInfo[]>;
  removeConnection: (id: string) => Promise<ConnectionInfo[]>;
  testConnection: (id: string) => Promise<ConnectionInfo[]>;
  gitHostConnections: () => Promise<GitHostConnectionInfo[]>;
  saveGitHostConnection: (
    input: GitHostConnectionInput,
  ) => Promise<GitHostConnectionInfo[]>;
  removeGitHostConnection: (id: string) => Promise<GitHostConnectionInfo[]>;
  testGitHostConnection: (id: string) => Promise<GitHostConnectionInfo[]>;
  chooseRepository: () => Promise<{
    path: string;
    branch: string;
    commit: string;
    remote?: GitRemote;
  } | null>;
  configureProject: (
    projectId: string,
    profile: ExecutionProfile,
  ) => Promise<unknown>;
  diagnostics: () => Promise<{
    docker: boolean;
    image: boolean;
    approvalHelper: boolean;
    message: string;
  }>;
  revealArtifact: (runId: string, index: number) => Promise<void>;
  runAction: (id: string, action: "retry" | "diff") => Promise<string>;
  deliverRun: (input: {
    runId: string;
    title: string;
    body: string;
  }) => Promise<{ url?: string; branch: string }>;
  conversations: {
    listThreads: (scope: ConversationScope) => Promise<ConversationThread[]>;
    getThread: (threadId: string) => Promise<ConversationThread>;
    listTurns: (input: {
      threadId: string;
      beforeOrdinal?: number;
      limit?: number;
    }) => Promise<ConversationTurn[]>;
    sendTurn: (
      input: SendTurnInput,
    ) => Promise<{ thread: ConversationThread; turn: ConversationTurn }>;
    cancelTurn: (input: {
      threadId: string;
      turnId: string;
    }) => Promise<boolean>;
    resetSummary: (input: {
      threadId: string;
      expectedRevision: number;
    }) => Promise<ConversationThread>;
    deleteThread: (input: {
      threadId: string;
      deactivateDerivedMemoryIds?: string[];
    }) => Promise<void>;
  };
}
