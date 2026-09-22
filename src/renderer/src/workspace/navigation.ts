export type WorkspaceLocation = {
  scope: string;
  selected: string | null;
  query: string;
  settingsContext?: { projectId: string; featureId?: string };
  runtimeSection: "connection" | "profile";
};
export type NavigationHistory = { entries: WorkspaceLocation[]; index: number };
const identity = (location: WorkspaceLocation) =>
  JSON.stringify([
    location.scope,
    location.selected,
    location.settingsContext?.projectId,
    location.settingsContext?.featureId,
    location.scope === "runtime" ? location.runtimeSection : undefined,
  ]);

export function rememberLocation(
  history: NavigationHistory,
  location: WorkspaceLocation,
): NavigationHistory {
  const entries = history.entries.slice();
  const current = entries[history.index];
  if (current && identity(current) === identity(location)) {
    // Search text belongs to its location; typing does not create history entries.
    entries[history.index] = location;
    return { entries, index: history.index };
  }
  const next = [...entries.slice(0, history.index + 1), location].slice(-60);
  return { entries: next, index: next.length - 1 };
}

export function historyTarget(
  history: NavigationHistory,
  direction: -1 | 1,
  valid: (location: WorkspaceLocation) => boolean,
): number | undefined {
  for (
    let i = history.index + direction;
    i >= 0 && i < history.entries.length;
    i += direction
  ) {
    if (valid(history.entries[i])) return i;
  }
}
