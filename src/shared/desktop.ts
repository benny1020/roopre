import type { BootstrapStatus, OnboardingProgress } from "./onboarding";
import type { Command, Snapshot } from "./contracts";
import type {
  ConnectionInput,
  ConnectionInfo,
  ExecutionProfile,
} from "./runtime";
export interface DesktopAPI {
  name: string;
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
  chooseRepository: () => Promise<{
    path: string;
    branch: string;
    commit: string;
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
}
