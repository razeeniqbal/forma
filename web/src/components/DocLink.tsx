import { Link } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import { docPage } from "@/docs/content";

/** Contextual help: opens the Docs page that explains the thing next to it. */
export function DocLink({ page, label, onNavigate, className = "" }: { page: string; label?: string; onNavigate?: () => void; className?: string }) {
  const p = docPage(page);
  if (!p) return null;
  const text = label ?? p.learn ?? `Learn about ${p.title}`;
  return (
    <Link className={`doclink ${className}`} to={`/docs/${p.slug}`} onClick={onNavigate} title={p.summary}>
      <CircleHelp size={13} aria-hidden />
      <span>{text}</span>
    </Link>
  );
}
