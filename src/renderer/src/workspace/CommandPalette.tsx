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
        title: "새 기능",
        meta: "요구사항으로 시작",
        icon: Plus,
        action: () => create("feature"),
        disabled: !connected || !snapshot?.projects.length,
      },
      {
        id: "new-project",
        title: "새 프로젝트",
        meta: "저장소와 개발 흐름 연결",
        icon: Plus,
        action: () => create("project"),
        disabled: !connected,
      },
      {
        id: "runs",
        title: "실행 현황",
        meta: "모든 프로젝트의 에이전트 작업",
        icon: Activity,
        action: () => navigate("queued"),
      },
      {
        id: "settings",
        title: "설정",
        meta: "하네스 · 에이전트 · 연결 · 지침",
        icon: Settings2,
        action: () => navigate("harness"),
      },
      ...(snapshot?.projects.map((p) => ({
        id: `project:${p.id}`,
        title: p.name,
        meta: "프로젝트",
        icon: Folder,
        action: () => navigate(p.id),
      })) || []),
      ...(snapshot?.features.map((f) => ({
        id: `feature:${f.id}`,
        title: f.title,
        meta:
          snapshot.projects.find((p) => p.id === f.projectId)?.name || "기능",
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
      label="작업 검색"
      onClose={onClose}
      className="command-dialog ade-command"
    >
      <div className="command-input">
        <Search size={18} />
        <input
          role="combobox"
          aria-label="명령과 작업 검색"
          aria-expanded="true"
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={
            commands[selected] ? `${id}-${selected}` : undefined
          }
          placeholder="기능, 프로젝트 또는 명령 검색…"
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
          aria-label="검색 닫기"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="command-results"
        role="listbox"
        id={id}
        aria-label="검색 결과"
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
          <p className="quiet-empty">
            일치하는 작업이 없습니다. 다른 이름을 검색하세요.
          </p>
        )}
      </div>
      <footer>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 이동
        </span>
        <span>
          <kbd>↵</kbd> 열기
        </span>
        <span>
          <kbd>esc</kbd> 닫기
        </span>
      </footer>
    </Dialog>
  );
}
