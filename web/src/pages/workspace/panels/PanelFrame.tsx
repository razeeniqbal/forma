import { createContext, useContext, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { PanelId } from "@/store/model";

export const LayoutCtl = createContext<{ hide(id: PanelId): void; toggleMax(id: PanelId): void; maximized: PanelId | null } | null>(null);

/** Inside a collapsible Workbench section, which supplies its own title. */
export const InSection = createContext(false);

export function PanelFrame({
  id,
  title,
  sub,
  icon,
  actions,
  footer,
  children,
  pad,
}: {
  id: PanelId;
  title: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  const ctl = useContext(LayoutCtl);
  const inSection = useContext(InSection);
  if (inSection)
    return (
      <section className="panel in-section" aria-label={typeof title === "string" ? title : undefined}>
        {(sub || actions) && (
          <div className="panel-head slim">
            <span className="sub grow">{sub}</span>
            {actions}
          </div>
        )}
        <div className={`panel-body ${pad ? "pad" : ""}`}>{children}</div>
        {footer && <div className="panel-foot">{footer}</div>}
      </section>
    );
  return (
    <section className="panel" aria-label={typeof title === "string" ? title : undefined}>
      <div className="panel-head">
        <h3>
          {icon}
          {title}
          {sub && <span className="sub">{sub}</span>}
        </h3>
        {actions}
        {ctl && (
          <>
            <button className="btn ghost xs icon" title={ctl.maximized === id ? "Restore" : "Maximize"} aria-label="Maximize panel" onClick={() => ctl.toggleMax(id)}>
              {ctl.maximized === id ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button className="btn ghost xs icon" title="Hide panel" aria-label="Hide panel" onClick={() => ctl.hide(id)}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
      <div className={`panel-body ${pad ? "pad" : ""}`}>{children}</div>
      {footer && <div className="panel-foot">{footer}</div>}
    </section>
  );
}
