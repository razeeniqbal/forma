import { Plus, Trash2, Wand2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Dataset, RuleKind, RuleResult, Step, ValidationRule } from "@/engine/types";
import { newId } from "@/engine/registry";
import { ruleLabel } from "@/engine/execute";
import { suggestRules } from "@/lib/stepDefaults";
import { fmtInt, fmtPct } from "@/lib/format";
import { ColumnSelect } from "./StepEditor";

const KINDS: { value: RuleKind; label: string }[] = [
  { value: "not_blank", label: "Cannot be blank" },
  { value: "matches", label: "Matches pattern" },
  { value: "valid_date", label: "Is a valid date" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "At least" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "At most" },
  { value: "in_set", label: "One of allowed values" },
  { value: "unique", label: "Is unique" },
];

function withKind(rule: ValidationRule, kind: RuleKind): ValidationRule {
  const base = { id: rule.id, column: rule.column };
  switch (kind) {
    case "matches":
      return { ...base, kind, pattern: "^INV-\\d+$" };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { ...base, kind, value: 0 };
    case "in_set":
      return { ...base, kind, values: [] };
    default:
      return { ...base, kind };
  }
}

export function ValidateEditor({
  step,
  onChange,
  before,
  results,
}: {
  step: Extract<Step, { type: "validate" }>;
  onChange: (s: Step) => void;
  before?: Dataset;
  results: RuleResult[];
}) {
  const setRule = (i: number, r: ValidationRule) => onChange({ ...step, rules: step.rules.map((x, k) => (k === i ? r : x)) });
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <span className="hint grow">Explicit rules. Failing values are flagged for review, never silently changed.</span>
        <button
          className="btn xs"
          onClick={() => {
            if (!before) return;
            const existing = new Set(step.rules.map((r) => `${r.column}:${r.kind}`));
            const extra = suggestRules(before).filter((r) => !existing.has(`${r.column}:${r.kind}`));
            onChange({ ...step, rules: [...step.rules, ...extra] });
          }}
        >
          <Wand2 size={12} /> Suggest rules
        </button>
      </div>
      {step.rules.map((rule, i) => {
        const res = results.find((r) => r.ruleId === rule.id);
        const failed = res ? res.evaluated - res.passed : 0;
        return (
          <div key={rule.id} className="card" style={{ padding: 8, display: "grid", gap: 6 }}>
            <div className="row">
              {res && (failed ? <AlertTriangle size={15} color="var(--amber)" /> : <CheckCircle2 size={15} color="var(--green)" />)}
              <div style={{ flex: 1 }}>
                <ColumnSelect ds={before} value={rule.column} onChange={(column) => setRule(i, { ...rule, column })} />
              </div>
              <select className="select" style={{ flex: 1 }} value={rule.kind} aria-label="Rule" onChange={(e) => setRule(i, withKind(rule, e.target.value as RuleKind))}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button className="btn ghost xs icon" aria-label="Remove rule" onClick={() => onChange({ ...step, rules: step.rules.filter((_, k) => k !== i) })}>
                <Trash2 size={13} color="var(--red)" />
              </button>
            </div>
            {rule.kind === "matches" && (
              <div className="row">
                <input className="input sm mono" value={rule.pattern} aria-label="Pattern" onChange={(e) => setRule(i, { ...rule, pattern: e.target.value })} />
                <input className="input sm" style={{ width: "45%" }} value={rule.description ?? ""} placeholder="Description (optional)" onChange={(e) => setRule(i, { ...rule, description: e.target.value })} />
              </div>
            )}
            {(rule.kind === "gt" || rule.kind === "gte" || rule.kind === "lt" || rule.kind === "lte") && (
              <input className="input sm" type="number" value={rule.value} aria-label="Value" onChange={(e) => setRule(i, { ...rule, value: Number(e.target.value) })} />
            )}
            {rule.kind === "in_set" && (
              <input
                className="input sm"
                value={rule.values.join(", ")}
                placeholder="Allowed values, comma separated"
                aria-label="Allowed values"
                onChange={(e) => setRule(i, { ...rule, values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            )}
            <div className="small muted row">
              <span className="grow">{ruleLabel(rule)}</span>
              {res && (
                <span className="num" style={{ color: failed ? "var(--amber-text)" : "var(--green-text)" }}>
                  {fmtInt(res.passed)}/{fmtInt(res.evaluated)} passed · {fmtPct(res.passed, res.evaluated)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <button
        className="btn sm"
        style={{ alignSelf: "flex-start" }}
        onClick={() => onChange({ ...step, rules: [...step.rules, { id: newId("r"), column: before?.columns[0] ?? "", kind: "not_blank" }] })}
      >
        <Plus size={13} /> Add rule
      </button>
    </div>
  );
}
