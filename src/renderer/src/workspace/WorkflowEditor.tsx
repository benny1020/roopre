import { useEffect, useMemo, useState, useCallback } from "react";
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
        "This move is unavailable. Write-access agents belong in implementation; other stages require read-only agents.",
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
      `${d.name}: ${stageNames[to]} stage. Save the workflow to apply this move.`,
    );
  };
  const items = useMemo(
    () =>
      flow.assignments.map((a) => ({
        id: a.id,
        stage: a.stage,
        name:
          agents.find((d) => d.id === a.agentId)?.name ?? "Agent unavailable",
        detail: a.required ? "Required role" : "Optional role",
        state: "idle" as const,
      })),
    [flow.assignments, agents],
  );
  const candidates = agents.filter((a) => compatible(a, stage));
  const openPicker = useCallback(
    (target: Stage) => {
      if (locked || flow.assignments.length >= 30) return;
      setSelected(target);
      setQuery("");
      setPicker(target);
    },
    [locked, flow.assignments.length],
  );
  const matches = picker
    ? agents.filter(
        (a) =>
          compatible(a, picker) &&
          `${a.name} ${a.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
    : [];
  return (
    <>
      <div className="graph-draft-bar">
        <p>Draft · saving requires affected designs to be approved again</p>
        <button
          disabled={locked || !history.length}
          onClick={() => {
            const last = history.at(-1);
            if (last) {
              onChange(last);
              setHistory((h) => h.slice(0, -1));
              setNotice("Last change undone.");
            }
          }}
        >
          Undo
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className="graph-editor">
        <WorkflowGraph
          label="Workflow graph"
          items={items}
          selected={selected}
          onSelect={setSelected}
          modes={flow.execution}
          editable={!locked}
          onMove={move}
          onAdd={openPicker}
          addDisabled={locked || flow.assignments.length >= 30}
        />
        <aside
          className="graph-inspector"
          aria-label="Selected workflow settings"
        >
          <h3>
            {assignment ? "Agent assignment" : "Selected stage"} ·{" "}
            {stageNames[stage]}
          </h3>
          <fieldset disabled={locked}>
            {assignment ? (
              <>
                <label className="field">
                  Agents
                  <select
                    aria-label={`${stageNames[stage]} Agents`}
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
                  Assigned stage
                  <select
                    aria-label="Agent stage"
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
                  Required result
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
                    Move up
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
                    Remove assignment
                  </button>
                </div>
                <p className="muted">
                  The agent definition is preserved. Select a stage heading to
                  edit stage settings.
                </p>
              </>
            ) : (
              <>
                <label className="field">
                  Execution mode
                  <select
                    aria-label={`${stageNames[stage]} Execution mode`}
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
                    <option value="parallel">Parallel · Default</option>
                    <option value="sequential">
                      Sequential · One at a time
                    </option>
                  </select>
                </label>
                <label className="field">
                  {stageNames[stage]} Stage instructions
                  <textarea
                    aria-label={`${stageNames[stage]} Stage instructions`}
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
                  onClick={() => openPicker(stage)}
                  disabled={flow.assignments.length >= 30}
                >
                  Add agent to {stageNames[stage]}
                </button>
                {flow.assignments
                  .filter((a) => a.stage === stage)
                  .map((a) => (
                    <div className="graph-assignment" key={a.id}>
                      <button onClick={() => setSelected(a.id)}>
                        {agents.find((d) => d.id === a.agentId)?.name ??
                          "Unavailable"}
                      </button>
                      <small>{a.required ? "Required" : "Optional"}</small>
                    </div>
                  ))}
              </>
            )}
          </fieldset>
        </aside>
      </div>
      {picker && (
        <Dialog
          label={`Add agent to ${stageNames[picker]}`}
          onClose={() => setPicker(undefined)}
          className="command-dialog graph-picker"
        >
          <h2>Add agent to {stageNames[picker]}</h2>
          <p className="muted">
            Choose an existing role or create one. Agents in this stage run{" "}
            {flow.execution?.[picker] === "sequential"
              ? "sequentially"
              : "in parallel"}
            .
          </p>
          <label className="field">
            Search existing agents
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or role"
            />
          </label>
          <div className="graph-picker-list">
            {matches.map((a) => (
              <button
                key={a.id}
                disabled={locked || flow.assignments.length >= 30}
                onClick={() => {
                  if (locked || flow.assignments.length >= 30) return;
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
                    "Agent added to the draft. Save the workflow to apply it.",
                  );
                }}
              >
                <span className="graph-picker-copy">
                  <strong>{a.name}</strong>
                  <small>{a.description || "No description"}</small>
                </span>
                <small>
                  v{a.revision} · {a.projectId ? "Projects" : "Global"}
                </small>
              </button>
            ))}
          </div>
          {!matches.length && query.trim() && (
            <p role="status">
              No agents match “{query}”. Try another name or create a role.
            </p>
          )}
          {!agents.some((a) => compatible(a, picker)) && (
            <p>
              No agents available for this stage. Create a role or import
              Markdown.
            </p>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={locked || flow.assignments.length >= 30}
              onClick={() => {
                onCreate(picker);
                setPicker(undefined);
              }}
            >
              Create role · Markdown
            </button>
            <button onClick={() => setPicker(undefined)}>Close</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
