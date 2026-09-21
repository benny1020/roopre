import { useEffect, useRef, type ReactNode } from "react";

export function Tabs({
  items,
  value,
  onChange,
  label,
  className = "work-tabs",
}: {
  items: { id: string; label: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const index = items.findIndex((i) => i.id === value);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : e.key === "ArrowRight"
                ? (index + 1) % items.length
                : e.key === "ArrowLeft"
                  ? (index + items.length - 1) % items.length
                  : -1;
        if (next < 0) return;
        e.preventDefault();
        onChange(items[next].id);
        e.currentTarget
          .querySelectorAll<HTMLButtonElement>('[role="tab"]')
          [next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          type="button"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          className={value === item.id ? "active" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function Dialog({
  label,
  onClose,
  children,
  className = "command-dialog",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const targets = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length > 0);
    (targets()[0] || root).focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const items = targets();
      const first = items[0];
      const last = items.at(-1);
      if (!first) {
        event.preventDefault();
        root.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const contain = (e: FocusEvent) => {
      if (!root.contains(e.target as Node)) (targets()[0] || root).focus();
    };
    document.addEventListener("keydown", trap, true);
    document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("keydown", trap, true);
      document.removeEventListener("focusin", contain);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}
export function ResizeHandle({
  value,
  onChange,
  min,
  max,
  label,
  horizontal = false,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label: string;
  horizontal?: boolean;
}) {
  const start = useRef<{ position: number; value: number } | undefined>(
    undefined,
  );
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div
      className={`resize-handle ${horizontal ? "horizontal" : "vertical"}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onDoubleClick={() => onChange(Math.round((min + max) / 2))}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.focus();
        start.current = { position: horizontal ? e.clientY : e.clientX, value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current)
          onChange(
            clamp(
              start.current.value +
                start.current.position -
                (horizontal ? e.clientY : e.clientX),
            ),
          );
      }}
      onPointerUp={(e) => {
        start.current = undefined;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        start.current = undefined;
      }}
      onKeyDown={(e) => {
        const n =
          e.key === "Home"
            ? min
            : e.key === "End"
              ? max
              : ["ArrowLeft", "ArrowUp"].includes(e.key)
                ? value + 16
                : ["ArrowRight", "ArrowDown"].includes(e.key)
                  ? value - 16
                  : undefined;
        if (n !== undefined) {
          e.preventDefault();
          onChange(clamp(n));
        }
      }}
    />
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="work-empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
