import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import { Check, Circle, LoaderCircle, AlertCircle } from "lucide-react";
import { stages, stageNames } from "../../../shared/harness";
import "@xyflow/react/dist/style.css";
import "./graph.css";
export type Stage = (typeof stages)[number];
export type GraphItem = {
  id: string;
  stage: Stage;
  name: string;
  detail: string;
  state: "idle" | "running" | "passed" | "failed" | "unknown";
};
const column = 222,
  left = 24,
  top = 56,
  row = 72;
const stateIcons = {
  idle: Circle,
  running: LoaderCircle,
  passed: Check,
  failed: AlertCircle,
  unknown: AlertCircle,
};
function StageNode({ data }: NodeProps) {
  return (
    <div
      className={`flow-stage-node ${data.selected ? "is-selected" : ""} ${data.running ? "is-running" : ""}`}
      style={{ height: Number(data.height) }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <strong>
        {String(data.name)} {data.running ? <small>진행 중</small> : null}
      </strong>
      <span>{String(data.detail)}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
function AgentNode({ data }: NodeProps) {
  const item = data.item as GraphItem;
  const Icon = stateIcons[item.state];
  return (
    <div
      className={`flow-agent-node state-${item.state} ${data.selected ? "is-selected" : ""}`}
    >
      <Icon size={13} aria-hidden="true" />
      <div>
        <strong title={item.name}>{item.name}</strong>
        <span title={item.detail}>{item.detail}</span>
      </div>
    </div>
  );
}
const nodeTypes = { stage: StageNode, agent: AgentNode };
export default function WorkflowGraph({
  items,
  selected,
  onSelect,
  modes,
  editable = false,
  onMove,
  label,
  stageDetails,
  activeStage,
}: {
  items: GraphItem[];
  selected: string;
  onSelect: (id: string) => void;
  modes?: Partial<Record<Stage, string>>;
  editable?: boolean;
  onMove?: (id: string, stage: Stage) => void;
  label: string;
  stageDetails?: Partial<Record<Stage, string>>;
  activeStage?: Stage;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const layoutKey = JSON.stringify({
    items,
    selected,
    modes,
    editable,
    collapsed,
    stageDetails,
    activeStage,
  });
  const layout = useMemo(() => {
    const height = collapsed
      ? 72
      : Math.max(
          150,
          76 +
            Math.max(
              0,
              ...stages.map((s) => items.filter((a) => a.stage === s).length),
            ) *
              row,
        );
    return stages.flatMap((stage, i): Node[] => {
      const list = items.filter((a) => a.stage === stage);
      const running = list.filter((a) => a.state === "running").length;
      return [
        {
          id: stage,
          type: "stage",
          position: { x: left + i * column, y: 20 },
          draggable: false,
          data: {
            name: stageNames[stage],
            running: activeStage === stage,
            detail:
              stageDetails?.[stage] ??
              `${modes?.[stage] === "sequential" ? "순차" : "병렬"} · ${list.length}개${running ? ` · 실행 ${running}` : ""}`,
            height,
            selected: selected === stage,
          },
          ariaLabel: `${stageNames[stage]} 단계`,
          style: { width: 202, height },
        },
        ...(!collapsed
          ? list.map((item, j): Node => ({
              id: item.id,
              type: "agent",
              position: { x: left + i * column + 10, y: top + 32 + j * row },
              draggable: editable,
              data: { item, selected: selected === item.id },
              ariaLabel: `${item.name} · ${item.detail}`,
              style: { width: 182 },
            }))
          : []),
      ];
    });
  }, [layoutKey]);
  const [nodes, setNodes] = useState(layout);
  useEffect(() => setNodes(layout), [layout]);
  const edges: Edge[] = stages.slice(1).map((stage, i) => ({
    id: `edge-${stage}`,
    source: stages[i],
    target: stage,
    type: "smoothstep",
    label: "",
    selectable: false,
    focusable: false,
  }));
  return (
    <section
      className="workflow-graph"
      aria-label={label}
      onKeyDownCapture={(e) => {
        const node = (e.target as HTMLElement).closest<HTMLElement>(
          ".react-flow__node",
        );
        if (!node) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (node.dataset.id) onSelect(node.dataset.id);
        }
        if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="graph-toolbar">
        <span>
          {editable
            ? "에이전트를 끌어 단계 이동 · 선택해서 편집"
            : "노드를 선택해 확인 · 실행 위치는 유지"}
        </span>
        <button onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "에이전트 펼치기" : "에이전트 접기"}
        </button>
      </div>
      <div className="graph-canvas">
        <div className="graph-plane">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.35}
            maxZoom={1.5}
            nodesConnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            nodesDraggable={editable}
            panOnScroll={false}
            zoomOnScroll={false}
            selectionOnDrag={false}
            onNodesChange={(changes) =>
              setNodes((n) => applyNodeChanges(changes, n))
            }
            onNodeClick={(_e, n) => onSelect(n.id)}
            onNodeDragStop={(_e, n) => {
              const index = Math.floor((n.position.x + 91 - left) / column);
              if (index >= 0 && index < stages.length && n.position.y >= 20)
                onMove?.(n.id, stages[index]);
              setNodes(layout);
            }}
            ariaLabelConfig={{
              "controls.zoomIn.ariaLabel": "확대",
              "controls.zoomOut.ariaLabel": "축소",
              "controls.fitView.ariaLabel": "전체 흐름 보기",
              "node.a11yDescription.default":
                "Enter로 선택하고 Tab으로 이동합니다.",
              "node.a11yDescription.keyboardDisabled":
                "Enter로 선택하고 Tab으로 이동합니다.",
            }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
      <div className="graph-legend">
        <span>
          <i className="legend-selected" />
          선택
        </span>
        <span>
          <i className="legend-running" />
          실행 중
        </span>
        <span>설계 승인 후 구현 · 단계 안은 기본 병렬</span>
      </div>
    </section>
  );
}
