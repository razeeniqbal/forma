// "Update rule from correction" (PRD §6.9 future enhancement): turn review
// items and user corrections into deterministic pipeline changes, and measure
// their impact before anything is applied.
import type { ExecutionResult, Issue, PipelineSpec, Step } from "@/engine/types";
import { detectDateFormats, parseDate, toText } from "@/engine/values";
import { newId, stepTitle } from "@/engine/registry";
import { toText as canon } from "@/engine/values";

export interface RuleSuggestion {
  id: string;
  title: string;
  detail: string;
  /** Review rows this suggestion is aimed at (for the "resolves" estimate). */
  targets: number;
  apply(spec: PipelineSpec): PipelineSpec;
}

export interface Impact {
  resolved: number;
  stillOpen: number;
  newlyFlagged: number;
  changedCells: number;
}

function insertBefore(spec: PipelineSpec, stepId: string, step: Step): PipelineSpec {
  const at = spec.steps.findIndex((s) => s.id === stepId);
  const steps = spec.steps.slice();
  steps.splice(at < 0 ? steps.length : at, 0, step);
  return { ...spec, steps };
}

export function suggestRuleUpdates(spec: PipelineSpec, result: ExecutionResult): RuleSuggestion[] {
  const out: RuleSuggestion[] = [];
  const open = new Set(result.reviewRows);
  const issues = result.issues.filter((i) => open.has(i.row));
  const byStep = new Map<string, Issue[]>();
  for (const i of issues) byStep.set(i.stepId, [...(byStep.get(i.stepId) ?? []), i]);

  // 1. Dates that fail "Standardise date" but match another known format.
  for (const step of spec.steps) {
    if (step.type !== "standardise_date") continue;
    const failed = (byStep.get(step.id) ?? []).filter((i) => i.kind === "invalid_date");
    if (!failed.length) continue;
    const candidates = detectDateFormats(failed.map((i) => i.value)).filter((d) => !step.inputFormats.includes(d.format));
    for (const c of candidates) {
      const fixes = failed.filter((i) => parseDate(i.value, [c.format]) !== null).length;
      if (!fixes) continue;
      out.push({
        id: `fmt:${step.id}:${c.format}`,
        title: `Accept ${c.format} in “${stepTitle(step)}”`,
        detail: `${fixes} value${fixes > 1 ? "s" : ""} like “${c.example}” use this format.`,
        targets: fixes,
        apply: (s) => ({ ...s, steps: s.steps.map((x) => (x.id === step.id && x.type === "standardise_date" ? { ...x, inputFormats: [...x.inputFormats, c.format] } : x)) }),
      });
    }
  }

  // 2. Corrections that can become a Replace step for every identical value.
  const corrections = new Map<string, { column: string; from: string; to: string; stepId: string; rows: number }>();
  for (const d of spec.reviewDecisions) {
    if (d.action !== "correct" || d.column === null || d.value === undefined) continue;
    const issue = result.issues.find((i) => i.row === d.row && i.column === d.column);
    if (!issue || typeof issue.value !== "string") continue;
    const step = spec.steps.find((s) => s.id === issue.stepId);
    // Extraction issues live on derived columns; a replace can't target them.
    if (!step || step.type === "extract" || step.type === "extract_kv" || step.type === "join") continue;
    const key = `${d.column}\u0000${issue.value}\u0000${d.value}`;
    const c = corrections.get(key) ?? { column: d.column, from: issue.value, to: d.value, stepId: step.id, rows: 0 };
    c.rows++;
    corrections.set(key, c);
  }
  for (const c of corrections.values()) {
    const same = issues.filter((i) => i.column === c.column && canon(i.value) === c.from).length;
    out.push({
      id: `rep:${c.column}:${c.from}`,
      title: `Replace “${c.from}” → “${c.to}” in ${c.column}`,
      detail: `From your correction${c.rows > 1 ? "s" : ""}. Applies to every row with this exact value (${same} currently in review).`,
      targets: same,
      apply: (s) => insertBefore(s, c.stepId, { id: newId("repl"), type: "replace", label: `Correct “${c.from}”`, column: c.column, find: c.from, replace: c.to, match: "exact" }),
    });
  }

  // 3. Recurring values rejected by an allowed-set rule.
  for (const step of spec.steps) {
    if (step.type !== "validate") continue;
    for (const rule of step.rules) {
      if (rule.kind !== "in_set") continue;
      const counts = new Map<string, number>();
      for (const i of byStep.get(step.id) ?? []) if (i.ruleId === rule.id && i.value !== null) counts.set(toText(i.value)!, (counts.get(toText(i.value)!) ?? 0) + 1);
      for (const [value, n] of counts) {
        if (n < 2) continue;
        out.push({
          id: `set:${rule.id}:${value}`,
          title: `Allow “${value}” in ${rule.column}`,
          detail: `${n} rows have this value. Only accept it if it is genuinely valid.`,
          targets: n,
          apply: (s) => ({
            ...s,
            steps: s.steps.map((x) =>
              x.id === step.id && x.type === "validate" ? { ...x, rules: x.rules.map((r) => (r.id === rule.id && r.kind === "in_set" ? { ...r, values: [...r.values, value] } : r)) } : x,
            ),
          }),
        });
      }
    }
  }
  return out.sort((a, b) => b.targets - a.targets);
}

/** Compare a candidate run with the baseline: review rows resolved and output values changed. */
export function measureImpact(base: ExecutionResult, next: ExecutionResult): Impact {
  const before = new Set(base.reviewRows);
  const after = new Set(next.reviewRows);
  let resolved = 0;
  for (const r of before) if (!after.has(r)) resolved++;
  let newly = 0;
  for (const r of after) if (!before.has(r)) newly++;
  const idx = new Map(base.output.rowIds.map((r, i) => [r, i]));
  let changed = 0;
  next.output.rowIds.forEach((r, i) => {
    const j = idx.get(r);
    if (j === undefined) return;
    next.output.columns.forEach((c, ci) => {
      const bj = base.output.columns.indexOf(c);
      if (bj >= 0 && canon(base.output.rows[j][bj]) !== canon(next.output.rows[i][ci])) changed++;
    });
  });
  return { resolved, stillOpen: after.size, newlyFlagged: newly, changedCells: changed };
}
