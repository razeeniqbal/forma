import type { Cell, IssueKind, PipelineSpec, ReviewAction, ReviewDecision } from "@/engine/types";
import { fingerprint } from "@/engine/load";

export function makeDecision(row: number, column: string | null, action: ReviewAction, sourceRow: Cell[] | undefined, extra: { value?: string; issueKind?: IssueKind } = {}): ReviewDecision {
  return {
    row,
    column,
    action,
    decidedAt: Date.now(),
    ...(extra.value !== undefined ? { value: extra.value } : {}),
    ...(extra.issueKind ? { issueKind: extra.issueKind } : {}),
    ...(sourceRow ? { fingerprint: fingerprint(sourceRow) } : {}),
  };
}

/** Replace any earlier decision for the same row/column (latest wins, all are auditable via versions). */
export function upsertDecisions(spec: PipelineSpec, decisions: ReviewDecision[]): PipelineSpec {
  const key = (d: ReviewDecision) => `${d.row}\u0000${d.column ?? "*"}`;
  const incoming = new Map(decisions.map((d) => [key(d), d]));
  const kept = spec.reviewDecisions.filter((d) => !incoming.has(key(d)));
  return { ...spec, reviewDecisions: [...kept, ...incoming.values()] };
}

export function removeDecision(spec: PipelineSpec, row: number, column: string | null): PipelineSpec {
  return { ...spec, reviewDecisions: spec.reviewDecisions.filter((d) => !(d.row === row && d.column === column)) };
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  invalid_date: "Invalid date",
  missing_value: "Missing value",
  pattern_mismatch: "Pattern mismatch",
  invalid_number: "Invalid amount",
  rule_failed: "Rule failed",
  other: "Other",
};
