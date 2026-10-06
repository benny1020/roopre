import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
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
import { Check, Circle, LoaderCircle, AlertCircle, Plus } from "lucide-react";
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
const left = 16,
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
        <span className="stage-name" title={String(data.name)}>
          {String(data.name)}
        </span>
        {data.running ? (
          <i
            className="stage-running"
            role="img"
            aria-label="Active stage"
            title="Active stage"
          />
        ) : null}
      </strong>
      <span>{String(data.detail)}</span>
      {data.onAdd ? (
        <button
          className="stage-add nodrag nopan"
          type="button"
          aria-label={`Add agent to ${String(data.name)}`}
          title={`Add agent to ${String(data.name)}`}
          disabled={Boolean(data.addDisabled)}
          onClick={(e) => {
            e.stopPropagation();
            (data.onAdd as () => void)();
          }}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      ) : null}
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
  onAdd,
  addDisabled,
  toolbarActions,
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
  onAdd?: (stage: Stage) => void;
  addDisabled?: boolean;
  toolbarActions?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(1100);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setCanvasWidth(entry.contentRect.width),
    );
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const column = Math.max(150, Math.min(222, (canvasWidth - 32) / 5));
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
  const layoutKey = JSON.stringify({
    items,
    selected,
    modes,
    editable,
    collapsed,
    stageDetails,
    activeStage,
    column,
    addDisabled,
  });
  const layout = useMemo(() => {
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
            onAdd: onAdd ? () => onAdd(stage) : undefined,
            addDisabled,
            running: activeStage === stage,
            detail:
              stageDetails?.[stage] ??
              `${modes?.[stage] === "sequential" ? "Sequential" : "Parallel"} · ${list.length}${running ? ` · Runs ${running}` : ""}`,
            height,
            selected: selected === stage,
          },
          ariaLabel: `${stageNames[stage]} Stage`,
          style: { width: column - 12, height },
        },
        ...(!collapsed
          ? list.map((item, j): Node => ({
              id: item.id,
              type: "agent",
              position: { x: left + i * column + 10, y: top + 32 + j * row },
              draggable: editable,
              data: { item, selected: selected === item.id },
              ariaLabel: `${item.name} · ${item.detail}`,
              style: { width: column - 32 },
            }))
          : []),
      ];
    });
  }, [layoutKey, onAdd]);
  const [nodes, setNodes] = useState(layout);
  // Retain measured dimensions across layout/data updates. Resetting them makes
  // React Flow temporarily hide focused nodes while it measures them again.
  useEffect(() => {
    setNodes((previous) =>
      layout.map((node) => ({
        ...previous.find((old) => old.id === node.id),
        ...node,
      })),
    );
  }, [layout]);
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
        if (
          !node ||
          (e.target as HTMLElement).closest(
            "button, input, select, textarea, a",
          )
        )
          return;
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
            ? "Drag agents between stages · Select to edit"
            : "Select a node to inspect · Execution layout stays fixed"}
        </span>
        <div className="graph-toolbar-actions">
          {toolbarActions}
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
          >
            {collapsed ? "Expand agents" : "Collapse agents"}
          </button>
        </div>
      </div>
      <div className="graph-canvas" ref={canvas}>
        <div className="graph-plane" style={{ height: height + 40 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            minZoom={0.35}
            maxZoom={1.5}
            nodesConnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            nodesDraggable={editable}
            panOnScroll={false}
            preventScrolling={false}
            zoomOnScroll={false}
            selectionOnDrag={false}
            onNodesChange={(changes) =>
              setNodes((n) => applyNodeChanges(changes, n))
            }
            onNodeClick={(_e, n) => onSelect(n.id)}
            onNodeDragStop={(_e, n) => {
              const index = Math.floor(
                (n.position.x + (column - 32) / 2 - left) / column,
              );
              if (index >= 0 && index < stages.length && n.position.y >= 20)
                onMove?.(n.id, stages[index]);
              setNodes((previous) =>
                layout.map((node) => ({
                  ...previous.find((old) => old.id === node.id),
                  ...node,
                })),
              );
            }}
            ariaLabelConfig={{
              "controls.zoomIn.ariaLabel": "Zoom in",
              "controls.zoomOut.ariaLabel": "Zoom out",
              "controls.fitView.ariaLabel": "Fit workflow",
              "node.a11yDescription.default":
                "Press Enter to select and Tab to navigate.",
              "node.a11yDescription.keyboardDisabled":
                "Press Enter to select and Tab to navigate.",
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
          Optional
        </span>
        <span>
          <i className="legend-running" />
          Running
        </span>
        <span>Implementation follows design approval</span>
      </div>
    </section>
  );
}
