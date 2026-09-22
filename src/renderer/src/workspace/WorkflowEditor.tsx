import { useEffect, useMemo, useState } from "react";
import {
  stageNames,
  stages,
  type AgentDefinition,
  type Workflow,
} from "../../../shared/harness";
import WorkflowGraph, { type Stage } from "./WorkflowGraph";
import { Dialog } from "./Controls";
export default function WorkflowEditor({
  flow,
  onChange,
  agents,
  locked,
  onCreate,
}: {
  flow: Workflow;
  onChange: (flow: Workflow) => void;
  agents: AgentDefinition[];
  locked: boolean;
  onCreate: (stage: Stage) => void;
}) {
  const [selected, setSelected] = useState<string>("implementation");
  const [picker, setPicker] = useState<Stage>();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Workflow[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => setHistory([]), [flow.revision]);
  const assignment = flow.assignments.find((a) => a.id === selected);
  const stage =
    assignment?.stage ??
    (stages.includes(selected as Stage)
      ? (selected as Stage)
      : "implementation");
  const compatible = (agent: AgentDefinition, s: Stage) =>
    (s === "implementation") === (agent.capability === "implementation");
  const update = (next: Workflow) => {
    if (locked) return;
    setHistory((h) => [...h.slice(-29), flow]);
    onChange(next);
  };
  const move = (id: string, to: Stage) => {
    const a = flow.assignments.find((a) => a.id === id),
      d = agents.find((d) => d.id === a?.agentId);
    if (!a || !d || locked) return;
    if (!compatible(d, to)) {
      setNotice(
        "이동할 수 없습니다. 코드 수정 에이전트는 구현 단계에, 읽기 전용 에이전트는 다른 단계에 배치하세요.",
      );
      return;
    }
    if (a.stage === to) return;
    update({
      ...flow,
      assignments: flow.assignments.map((x) =>
        x.id === id ? { ...x, stage: to } : x,
      ),
    });
    setSelected(id);
    setNotice(
      `${d.name}: ${stageNames[to]} 단계로 이동했습니다. 저장 전까지 실행에 적용되지 않습니다.`,
    );
  };
  const items = useMemo(
    () =>
      flow.assignments.map((a) => ({
        id: a.id,
        stage: a.stage,
        name:
          agents.find((d) => d.id === a.agentId)?.name ??
          "사용할 수 없는 에이전트",
        detail: a.required ? "필수 역할" : "선택 역할",
        state: "idle" as const,
      })),
    [flow.assignments, agents],
  );
  const candidates = agents.filter((a) => compatible(a, stage));
  return (
    <>
      <div className="graph-draft-bar">
        <p>편집 초안 · 저장 시 관련 설계 재승인 필요</p>
        <button
          disabled={locked || !history.length}
          onClick={() => {
            const last = history.at(-1);
            if (last) {
              onChange(last);
              setHistory((h) => h.slice(0, -1));
              setNotice("마지막 변경을 되돌렸습니다.");
            }
          }}
        >
          되돌리기
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className="graph-editor">
        <WorkflowGraph
          label="개발 흐름 그래프"
          items={items}
          selected={selected}
          onSelect={setSelected}
          modes={flow.execution}
          editable={!locked}
          onMove={move}
        />
        <aside className="graph-inspector" aria-label="선택한 흐름 설정">
          <h3>
            {assignment ? "에이전트 배치" : "선택한 단계"} · {stageNames[stage]}
          </h3>
          <fieldset disabled={locked}>
            {assignment ? (
              <>
                <label className="field">
                  에이전트
                  <select
                    aria-label={`${stageNames[stage]} 에이전트`}
                    value={assignment.agentId}
                    onChange={(e) =>
                      update({
                        ...flow,
                        assignments: flow.assignments.map((a) =>
                          a.id === assignment.id
                            ? { ...a, agentId: e.target.value }
                            : a,
                        ),
                      })
                    }
                  >
                    {candidates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · v{d.revision}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  담당 단계
                  <select
                    aria-label="에이전트 담당 단계"
                    value={stage}
                    onChange={(e) =>
                      move(assignment.id, e.target.value as Stage)
                    }
                  >
                    {stages.map((s) => (
                      <option
                        key={s}
                        value={s}
                        disabled={
                          !agents.some(
                            (d) =>
                              d.id === assignment.agentId && compatible(d, s),
                          )
                        }
                      >
                        {stageNames[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={assignment.required}
                    onChange={(e) =>
                      update({
                        ...flow,
                        assignments: flow.assignments.map((a) =>
                          a.id === assignment.id
                            ? { ...a, required: e.target.checked }
                            : a,
                        ),
                      })
                    }
                  />
                  필수 결과
                </label>
                <div className="button-row">
                  <button
                    disabled={
                      (flow.execution?.[stage] ?? "parallel") === "parallel" ||
                      flow.assignments.filter((a) => a.stage === stage)[0]
                        ?.id === assignment.id
                    }
                    onClick={() => {
                      const list = [...flow.assignments],
                        i = list.findIndex((a) => a.id === assignment.id);
                      let prev = i - 1;
                      while (prev >= 0 && list[prev].stage !== stage) prev--;
                      if (prev >= 0) {
                        [list[i], list[prev]] = [list[prev], list[i]];
                        update({ ...flow, assignments: list });
                      }
                    }}
                  >
                    순서 올리기
                  </button>
                  <button
                    onClick={() => {
                      update({
                        ...flow,
                        assignments: flow.assignments.filter(
                          (a) => a.id !== assignment.id,
                        ),
                      });
                      setSelected(stage);
                    }}
                  >
                    배치 제거
                  </button>
                </div>
                <p className="muted">
                  에이전트 정의는 유지됩니다. 단계 설정은 그래프의 단계 제목을
                  선택하세요.
                </p>
              </>
            ) : (
              <>
                <label className="field">
                  실행 방식
                  <select
                    aria-label={`${stageNames[stage]} 실행 방식`}
                    value={flow.execution?.[stage] ?? "parallel"}
                    onChange={(e) =>
                      update({
                        ...flow,
                        execution: {
                          ...flow.execution,
                          [stage]: e.target.value as "parallel" | "sequential",
                        },
                      })
                    }
                  >
                    <option value="parallel">병렬 · 기본</option>
                    <option value="sequential">순차 · 한 명씩 실행</option>
                  </select>
                </label>
                <label className="field">
                  {stageNames[stage]} 단계 지침
                  <textarea
                    aria-label={`${stageNames[stage]} 단계 지침`}
                    maxLength={10000}
                    value={flow.instructions[stage]}
                    onChange={(e) =>
                      update({
                        ...flow,
                        instructions: {
                          ...flow.instructions,
                          [stage]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <button
                  onClick={() => {
                    setQuery("");
                    setPicker(stage);
                  }}
                  disabled={flow.assignments.length >= 30}
                >
                  {stageNames[stage]} 에이전트 추가
                </button>
                {flow.assignments
                  .filter((a) => a.stage === stage)
                  .map((a) => (
                    <div className="graph-assignment" key={a.id}>
                      <button onClick={() => setSelected(a.id)}>
                        {agents.find((d) => d.id === a.agentId)?.name ??
                          "사용 불가"}
                      </button>
                      <small>{a.required ? "필수" : "선택"}</small>
                    </div>
                  ))}
              </>
            )}
          </fieldset>
        </aside>
      </div>
      {picker && (
        <Dialog
          label={`${stageNames[picker]} 에이전트 추가`}
          onClose={() => setPicker(undefined)}
          className="command-dialog graph-picker"
        >
          <h2>{stageNames[picker]}에 에이전트 추가</h2>
          <label className="field">
            기존 에이전트 검색
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 또는 역할 검색"
            />
          </label>
          <div className="graph-picker-list">
            {agents
              .filter(
                (a) =>
                  compatible(a, picker) &&
                  `${a.name} ${a.description}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    update({
                      ...flow,
                      assignments: [
                        ...flow.assignments,
                        { id, agentId: a.id, stage: picker, required: true },
                      ],
                    });
                    setSelected(id);
                    setPicker(undefined);
                    setNotice(
                      "에이전트를 초안에 배치했습니다. 개발 흐름을 저장해 적용하세요.",
                    );
                  }}
                >
                  {a.name}
                  <small>
                    v{a.revision} · {a.projectId ? "프로젝트" : "전역"}
                  </small>
                </button>
              ))}
          </div>
          {!agents.some((a) => compatible(a, picker)) && (
            <p>
              이 단계에 배치할 에이전트가 없습니다. 새 역할을 만들거나
              Markdown을 가져오세요.
            </p>
          )}
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                onCreate(picker);
                setPicker(undefined);
              }}
            >
              새 역할 만들기 · Markdown
            </button>
            <button onClick={() => setPicker(undefined)}>닫기</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
