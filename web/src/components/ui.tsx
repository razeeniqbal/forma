import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, Loader2, CircleDashed } from "lucide-react";
import { useApp } from "@/store/app";
import type { RunStatus } from "@/store/model";

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
  icon,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "lg" | "xl";
  icon?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon}
          <h2>{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  hint?: string;
}

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("mousedown", close), 0);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="sep-h" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            style={it.disabled ? { opacity: 0.45, cursor: "default" } : undefined}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon}
            <span className="grow">{it.label}</span>
            {it.hint && <span className="subtle tiny">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = (e: { clientX: number; clientY: number } | DOMRect, items: MenuItem[]) => {
    if ("clientX" in e) setMenu({ x: e.clientX, y: e.clientY, items });
    else setMenu({ x: e.left, y: e.bottom + 4, items });
  };
  const node = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  return { open, node };
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label}
    </label>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  size,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm";
}) {
  return (
    <div className={`seg ${size ?? ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} disabled={o.disabled} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" }) {
  return (
    <div className={`tabs ${size ?? ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const STATUS_META: Record<RunStatus, { label: string; cls: string }> = {
  running: { label: "Running", cls: "blue" },
  success: { label: "Success", cls: "green" },
  review: { label: "Completed with review items", cls: "amber" },
  failed: { label: "Failed", cls: "red" },
  cancelled: { label: "Cancelled", cls: "" },
};

export function StatusIcon({ status, size = 15 }: { status: RunStatus | "warning" | "info" | "error"; size?: number }) {
  if (status === "running") return <Loader2 size={size} className="spin" color="var(--blue)" />;
  if (status === "success") return <CheckCircle2 size={size} color="var(--green)" />;
  if (status === "review" || status === "warning") return <AlertTriangle size={size} color="var(--amber)" />;
  if (status === "failed" || status === "error") return <XCircle size={size} color="var(--red)" />;
  if (status === "info") return <Info size={size} color="var(--blue)" />;
  return <CircleDashed size={size} color="var(--subtle)" />;
}

export function StatusBadge({ status, short }: { status: RunStatus; short?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className={`badge ${m.cls}`}>
      <StatusIcon status={status} size={13} />
      {short && status === "review" ? "Review items" : m.label}
    </span>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "warning" ? <AlertTriangle size={16} /> : t.kind === "error" ? <XCircle size={16} /> : <Info size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Confirm (destructive actions require confirmation, PRD §17) ----------
interface ConfirmReq {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
const useConfirmStore = create<{ req: ConfirmReq | null; set: (r: ConfirmReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirmAction(opts: Omit<ConfirmReq, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const { req, set } = useConfirmStore();
  if (!req) return null;
  const done = (ok: boolean) => {
    req.resolve(ok);
    set(null);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(false)}
      icon={req.danger ? <AlertTriangle size={18} color="var(--red)" /> : undefined}
      footer={
        <>
          <button className="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`btn ${req.danger ? "danger solid" : "primary"}`} onClick={() => done(true)} autoFocus>
            {req.confirmLabel}
          </button>
        </>
      }
    >
      <div className="muted">{req.body}</div>
    </Modal>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <h3>{title}</h3>
      {children && <div style={{ maxWidth: 420 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Bar({ value, tone }: { value: number; tone?: "amber" | "red" | "blue" }) {
  const t = tone ?? (value >= 0.98 ? undefined : value >= 0.9 ? "amber" : "red");
  return (
    <div className={`bar ${t ?? ""}`}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Ring({ value, size = 84 }: { value: number; size?: number }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const color = value >= 0.98 ? "var(--green)" : value >= 0.9 ? "var(--amber)" : "var(--red)";
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--grey-bg)" strokeWidth="7" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="7" fill="none" strokeDasharray={`${c * value} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="v">{(value * 100).toFixed(1)}%</div>
    </div>
  );
}

export function FileIcon({ kind }: { kind: string }) {
  const label = kind === "excel" ? "XLS" : kind === "csv" ? "CSV" : kind === "text" ? "TXT" : "{ }";
  return <div className={`file-ic ${kind}`}>{label}</div>;
}
