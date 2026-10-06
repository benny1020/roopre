import { searchCommands } from "./search";
import { useId, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  Folder,
  Search,
  X,
  Plus,
  Settings2,
  Activity,
  ShieldCheck,
} from "lucide-react";
import type { Snapshot } from "../../../shared/contracts";
import { Dialog } from "./Controls";
export default function CommandPalette({
  snapshot,
  onClose,
  onSelect,
  navigate,
  create,
  connected,
}: {
  snapshot?: Snapshot;
  onClose: () => void;
  onSelect: (id: string) => void;
  navigate: (scope: string) => void;
  create: (kind: "feature" | "project") => void;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const id = useId();
  const commands = searchCommands(
    [
      {
        id: "new-feature",
        title: "New feature",
        meta: "Start with requirements",
        icon: Plus,
        action: () => create("feature"),
        disabled: !connected || !snapshot?.projects.length,
      },
      {
        id: "new-project",
        title: "New project",
        meta: "Connect repository and workflow",
        icon: Plus,
        action: () => create("project"),
        disabled: !connected,
      },
      {
        id: "quality",
        title: "Quality evidence",
        meta: "Results, attempts, checks, reviews & cost",
        icon: ShieldCheck,
        action: () => navigate("quality"),
      },
      {
        id: "runs",
        title: "Execution",
        meta: "Agent activity across all projects",
        icon: Activity,
        action: () => navigate("queued"),
      },
      {
        id: "portfolio",
        title: "Workspace overview",
        meta: "Project flow, decisions & roles",
        icon: Activity,
        action: () => navigate("portfolio"),
      },
      {
        id: "settings",
        title: "Settings",
        meta: "Harness, agents, connections & instructions",
        icon: Settings2,
        action: () => navigate("harness"),
      },
      ...(snapshot?.projects.map((p) => ({
        id: `project:${p.id}`,
        title: p.name,
        meta: "Projects",
        icon: Folder,
        action: () => navigate(p.id),
      })) || []),
      ...(snapshot?.features.map((f) => ({
        id: `feature:${f.id}`,
        title: f.title,
        meta:
          snapshot.projects.find((p) => p.id === f.projectId)?.name ||
          "Feature",
        icon: FileText,
        action: () => onSelect(f.id),
      })) || []),
    ].filter((c) => !("disabled" in c && c.disabled)),
    query,
  );
  const selected = Math.min(index, Math.max(0, commands.length - 1));
  const execute = (i: number) => {
    const c = commands[i];
    if (c) {
      onClose();
      c.action();
    }
  };
  return (
    <Dialog
      label="Search work"
      onClose={onClose}
      className="command-dialog ade-command"
    >
      <div className="command-input">
        <Search size={18} />
        <input
          role="combobox"
          aria-label="Search commands and work"
          aria-expanded="true"
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={
            commands[selected] ? `${id}-${selected}` : undefined
          }
          placeholder="Search features, projects or commands…"
          maxLength={500}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
              return;
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setIndex(
                commands.length
                  ? (selected +
                      (e.key === "ArrowDown" ? 1 : commands.length - 1)) %
                      commands.length
                  : 0,
              );
              requestAnimationFrame(() =>
                document
                  .querySelector('[aria-selected="true"][role="option"]')
                  ?.scrollIntoView({ block: "nearest" }),
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              execute(selected);
            }
          }}
        />
        <button
          className="icon-button"
          aria-label="Close search"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="command-results"
        role="listbox"
        id={id}
        aria-label="Search results"
      >
        {commands.map((c, i) => (
          <div
            role="option"
            id={`${id}-${i}`}
            aria-selected={selected === i}
            key={c.id}
            className={selected === i ? "selected" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execute(i)}
          >
            <c.icon size={16} />
            <span>
              {c.title}
              <small>{c.meta}</small>
            </span>
            <ArrowUpRight size={14} />
          </div>
        ))}
        {!commands.length && (
          <p className="quiet-empty">No matching work. Try another name.</p>
        )}
      </div>
      <footer>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>↵</kbd> Open
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
      </footer>
    </Dialog>
  );
}
