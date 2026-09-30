import { Link } from "react-router-dom";
import { Eye, MousePointerClick, Wand2, ShieldCheck, Play, Code2, MessageSquare } from "lucide-react";
import { SHORTCUTS } from "./SettingsPage";

const FLOW = [
  { icon: <Eye size={18} />, t: "See", d: "Upload CSV, Excel, JSON or text. FORMA detects the header, data region and quality issues." },
  { icon: <MousePointerClick size={18} />, t: "Select", d: "Click a column to inspect its profile, patterns and suggested actions." },
  { icon: <Wand2 size={18} />, t: "Transform", d: "Extract, clean and reshape. Every transformation previews before it's applied." },
  { icon: <ShieldCheck size={18} />, t: "Verify", d: "Add explicit validation rules. Problem rows go to the review queue — never silently changed." },
  { icon: <Play size={18} />, t: "Run", d: "Runs execute a saved, immutable version on every row and record step-level results." },
  { icon: <Code2 size={18} />, t: "Keep the code", d: "Export a readable pandas project that produces exactly the same output." },
];

export function HelpPage() {
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Help &amp; Feedback</h1>
          <p>SEE → SELECT → TRANSFORM → VERIFY → RUN. Your pipeline. Your code. Your data.</p>
        </div>
      </div>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        {FLOW.map((f) => (
          <div key={f.t} className="card card-pad">
            <div className="row" style={{ marginBottom: 6, color: "var(--blue)" }}>
              {f.icon}
              <h3>{f.t}</h3>
            </div>
            <div className="muted small">{f.d}</div>
          </div>
        ))}
      </div>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>Keyboard shortcuts</h3>
          <table className="table compact">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <td style={{ width: 150 }}>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-pad col" style={{ gap: 10 }}>
          <h3>Try it</h3>
          <div className="muted small">The Invoice Processing demo walks through the complete V1 lifecycle on a messy workbook with 1,000 invoices.</div>
          <Link className="btn primary" to="/pipelines/new" style={{ alignSelf: "flex-start" }}>
            Create a pipeline
          </Link>
          <div className="hr" />
          <h3>Feedback</h3>
          <div className="muted small">Found a bug or have an idea? Open an issue on the project repository.</div>
          <a className="btn" style={{ alignSelf: "flex-start" }} href="https://github.com/razeeniqbal/forma/issues" target="_blank" rel="noreferrer">
            <MessageSquare size={15} /> Send feedback
          </a>
        </div>
      </div>
    </div>
  );
}
