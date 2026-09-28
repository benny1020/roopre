import { contextBridge, ipcRenderer } from "electron";
import { APP_NAME } from "../shared/brand";
import type { DesktopAPI } from "../shared/desktop";
async function request(operation: string, payload?: unknown) {
  const r = await ipcRenderer.invoke("roopre:request", operation, payload);
  if (!r.ok) throw Error(r.error);
  return r.value;
}
const api: DesktopAPI = {
  name: APP_NAME,
  refineAgent: (input) => request("refineAgent", input),
  harnessCandidate: (input) => request("harnessCandidate", input),
  harnessApply: (input) => request("harnessApply", input),
  harnessExport: (token) => request("harnessExport", token),
  readMarkdown: () => request("readMarkdown"),
  exportAgent: (id) => request("exportAgent", id),
  bootstrap: () => request("bootstrap"),
  migrateEnvironment: () => request("migrateEnvironment"),
  prepareEnvironment: () => request("prepareEnvironment"),
  cancelEnvironment: () => request("cancelEnvironment"),
  onboarding: (progress) => request("onboarding", progress),
  snapshot: () => request("snapshot"),
  command: (c) => request("command", c),
  connections: () => request("connections"),
  saveConnection: (input) => request("saveConnection", input),
  removeConnection: (id) => request("removeConnection", id),
  testConnection: (id) => request("testConnection", id),
  chooseRepository: () => request("chooseRepository"),
  configureProject: (projectId, profile) =>
    request("configureProject", { projectId, profile }),
  diagnostics: () => request("diagnostics"),
  revealArtifact: (runId, index) => request("revealArtifact", { runId, index }),
  runAction: (id, action) => request("runAction", { id, action }),
  conversations: {
    listThreads: (scope) => request("conversations:listThreads", scope),
    getThread: (threadId) => request("conversations:getThread", threadId),
    listTurns: (input) => request("conversations:listTurns", input),
    sendTurn: (input) => request("conversations:sendTurn", input),
    cancelTurn: (input) => request("conversations:cancelTurn", input),
    resetSummary: (input) => request("conversations:resetSummary", input),
    deleteThread: (input) => request("conversations:deleteThread", input),
  },
};
contextBridge.exposeInMainWorld("roopre", Object.freeze(api));
