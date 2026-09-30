import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Code2, Copy, Download, FolderDown, FileCode2, Folder, File, Info, Database, CheckCircle2, Loader2, Maximize2, Workflow, Terminal } from "lucide-react";
import { usePipeline, useApp } from "@/store/app";
import { getRawFile } from "@/store/db";
import { generateConfigYaml, generatePipelineJson, generatePython, generateReadme, generateRequirements, stepFunctionName } from "@/codegen/python";
import { stepTitle, STAGE_OF } from "@/engine/registry";
import { CodeView, findStepRange } from "@/components/CodeView";
import { Empty, Modal, Tabs } from "@/components/ui";
import { useFullExecution } from "@/lib/hooks";
import { projectFiles, zipProject } from "@/lib/exporters";
import { copyText, download, fmtInt } from "@/lib/format";

type Tab = "full" | "functions" | "requirements" | "config" | "readme" | "spec";

export function ExportPage() {
  const { id } = useParams();
  const pipeline = usePipeline(id);
  const connections = useApp((s) => s.connections);
  const toast = useApp((s) => s.toast);
  const [target, setTarget] = useState<"script" | "project">("project");
  const [tab, setTab] = useState<Tab>("full");
  const [includeSource, setIncludeSource] = useState(true);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const [raw, setRaw] = useState<Blob | undefined>();
  const exec = useFullExecution(pipeline?.spec);

  useEffect(() => {
    if (pipeline?.spec.source) getRawFile(pipeline.spec.source.fileId).then(setRaw);
  }, [pipeline?.spec.source]);

  const spec = pipeline?.spec;
  const version = pipeline ? (pipeline.dirty ? pipeline.version + 1 : pipeline.version || 1) : 1;
  const conn = spec?.destination?.type === "database" ? connections.find((c) => c.id === spec.destination!.connectionId) : undefined;
  const opts = useMemo(() => ({ version, connectionEnv: conn?.envVar }), [version, conn?.envVar]);
  const code = useMemo(() => (spec ? generatePython(spec, opts) : ""), [spec, opts]);

  if (!pipeline || !spec)
    return (
      <div className="page">
        <Empty icon={<Workflow size={22} />} title="Pipeline not found" />
      </div>
    );

  const functions = spec.steps.map((s, i) => {
    const r = findStepRange(code, stepFunctionName(s, i));
    return r ? code.split("\n").slice(r[0], r[1] + 1).join("\n") : "";
  });
  const shown: Record<Tab, string> = {
    full: code,
    functions: functions.join("\n\n\n") || "# No steps yet",
    requirements: generateRequirements(spec),
    config: generateConfigYaml(spec, opts),
    readme: generateReadme(spec, opts),
    spec: generatePipelineJson(spec, version),
  };
  const base = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "pipeline";
  const envVar = conn?.envVar ?? (spec.destination?.type === "database" ? "WAREHOUSE_URL" : null);
  const out = exec.result?.output;

  const downloadProject = async () => {
    setBusy(true);
    try {
      const files = projectFiles(spec, { ...opts, expected: out, source: includeSource ? raw : undefined });
      download(`${base}.zip`, await zipProject(base, files), "application/zip");
      toast("success", "Project downloaded");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page wide">
      <div className="crumbs">
        <Link to="/pipelines">Pipelines</Link>/<Link to={`/pipelines/${pipeline.id}`}>{spec.name}</Link>/<span className="cur">Export</span>
      </div>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row">
            <h1 style={{ fontSize: 24 }}>{spec.name}</h1>
            <span className="badge outline">v{version}</span>
          </div>
          <h1 style={{ marginTop: 10 }}>Export pipeline</h1>
          <p>Take your pipeline with you.</p>
        </div>
        <div className="callout" style={{ marginLeft: "auto", maxWidth: 560, alignItems: "center", padding: "16px 20px" }}>
          <Code2 size={30} />
          <div>
            <b style={{ color: "var(--ink)", letterSpacing: "0.02em" }}>YOUR PIPELINE. YOUR CODE. YOUR DATA.</b>
            <div className="small">Export clean, readable code. No lock-in. No hidden logic. Always yours.</div>
          </div>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: "400px 1fr" }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <span className="badge blue">1</span>
              <h3>Export options</h3>
            </div>
            <div className="card-pad col" style={{ gap: 8 }}>
              <label className={`option ${target === "script" ? "on" : ""}`}>
                <input type="radio" checked={target === "script"} onChange={() => setTarget("script")} />
                <FileCode2 size={22} color="#3776ab" />
                <div>
                  <div className="t">Python script</div>
                  <div className="d">Single readable .py file with the full pipeline.</div>
                </div>
              </label>
              <label className={`option ${target === "project" ? "on" : ""}`} style={{ flexWrap: "wrap" }}>
                <input type="radio" checked={target === "project"} onChange={() => setTarget("project")} />
                <Folder size={22} color="var(--muted)" />
                <div className="grow">
                  <div className="t">Python project</div>
                  <div className="d">Complete project with multiple files.</div>
                  <div className="col small" style={{ gap: 3, marginTop: 8 }}>
                    {[
                      ["pipeline.py", "Pipeline code"],
                      ["requirements.txt", "Python dependencies"],
                      ["config.yaml", "Configuration template"],
                      ["README.md", "Setup instructions"],
                      ["pipeline.json", "Pipeline specification"],
                      ["expected/forma_output.csv", "Parity reference"],
                    ].map(([f, d]) => (
                      <div key={f} className="row" style={{ gap: 6 }}>
                        <File size={12} color="var(--subtle)" />
                        <span className="mono" style={{ width: 170 }}>{f}</span>
                        <span className="muted">{d}</span>
                      </div>
                    ))}
                    {raw && spec.source && (
                      <label className="row" style={{ gap: 6, marginTop: 4 }}>
                        <input type="checkbox" checked={includeSource} onChange={(e) => setIncludeSource(e.target.checked)} />
                        Include source file <span className="mono">{spec.source.file}</span>
                      </label>
                    )}
                  </div>
                </div>
              </label>
              {[
                ["Airflow", "Export as an Airflow DAG."],
                ["Prefect", "Export as a Prefect flow."],
              ].map(([t, d]) => (
                <div key={t} className="option disabled">
                  <input type="radio" disabled />
                  <Workflow size={22} color="var(--subtle)" />
                  <div className="grow">
                    <div className="t">{t}</div>
                    <div className="d">{d}</div>
                  </div>
                  <span className="badge sm">Coming later</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="badge blue">2</span>
              <h3>Engine</h3>
            </div>
            <div className="card-pad col" style={{ gap: 8 }}>
              <label className="option on">
                <input type="radio" checked readOnly />
                <div>
                  <div className="t">Pandas</div>
                  <div className="d">Standard and widely compatible.</div>
                </div>
              </label>
              <div className="option disabled">
                <input type="radio" disabled />
                <div className="grow">
                  <div className="t">Polars</div>
                  <div className="d">High performance, large datasets.</div>
                </div>
                <span className="badge sm">Later</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="badge blue">3</span>
              <h3>Connections</h3>
            </div>
            <div className="card-pad col" style={{ gap: 10 }}>
              {envVar ? (
                <div className="row">
                  <Database size={22} color="var(--muted)" />
                  <div>
                    <div className="mono" style={{ fontWeight: 650 }}>{envVar}</div>
                    <div className="small muted">This will be read from an environment variable.</div>
                  </div>
                </div>
              ) : (
                <div className="small muted">No external connections — this pipeline reads a file and writes a {(spec.destination?.format ?? "csv").toUpperCase()} file.</div>
              )}
              <div className="callout">
                <Info size={16} />
                <div>
                  <b>Credentials are never written into generated code.</b>
                  <div className="small">Use environment variables or your secret management system.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="card-head">
              <h3>Generated Python code</h3>
              <button className="btn sm" onClick={() => copyText(shown[tab]).then(() => toast("success", "Copied to clipboard"))}>
                <Copy size={13} /> Copy code
              </button>
              <button className="btn sm icon" aria-label="Full screen" onClick={() => setFull(true)}>
                <Maximize2 size={13} />
              </button>
            </div>
            <div style={{ padding: "0 12px" }}>
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { value: "full", label: "Full script" },
                  { value: "functions", label: "Functions" },
                  { value: "requirements", label: "Requirements" },
                  { value: "config", label: "Config (YAML)" },
                  { value: "readme", label: "README" },
                  { value: "spec", label: "pipeline.json" },
                ]}
              />
            </div>
            <div style={{ height: 470, overflow: "auto" }}>
              <CodeView code={shown[tab]} />
            </div>
            <div className="small muted" style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>
              {spec.steps.map((s, i) => `${String(i + 1).padStart(2, "0")} ${STAGE_OF[s.type]} — ${stepTitle(s)}`).join(" · ") || "No steps yet"}
            </div>
          </div>

          <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 260px" }}>
            <div className="card-pad col" style={{ gap: 12, borderRight: "1px solid var(--border)" }}>
              <div className="row">
                <span className="badge blue">4</span>
                <h3>Parity check</h3>
              </div>
              <div className="row" style={{ gap: 14, alignItems: "stretch" }}>
                <div className="row" style={{ gap: 10, flex: 1.3 }}>
                  {exec.loading ? <Loader2 size={30} className="spin" color="var(--blue)" /> : <CheckCircle2 size={30} color="var(--green)" />}
                  <div>
                    <div style={{ fontWeight: 650, color: "var(--green-text)", fontSize: 15 }}>Same spec, same semantics</div>
                    <div className="small muted">The exported code runs the same deterministic steps as FORMA. Verify it on your machine against FORMA's output.</div>
                  </div>
                </div>
                <div className="card" style={{ padding: 10, flex: 1 }}>
                  <div className="tiny muted">FORMA output</div>
                  <div style={{ fontWeight: 700, fontSize: 17 }} className="num">
                    {out ? `${fmtInt(out.rows.length)} rows × ${out.columns.length} columns` : "…"}
                  </div>
                </div>
              </div>
              <div className="card mono small" style={{ padding: "8px 12px", background: "var(--ink)", color: "#e6e9ef" }}>
                <Terminal size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
                python pipeline.py --check expected/forma_output.csv
              </div>
              <div className="tiny muted">Every build is also checked by FORMA's parity test suite, which runs the TypeScript engine and the generated pandas code on the same files and compares every cell.</div>
            </div>
            <div className="card-pad col" style={{ gap: 8, justifyContent: "center" }}>
              {target === "script" ? (
                <button className="btn primary lg" onClick={() => download("pipeline.py", code, "text/x-python")}>
                  <Download size={16} /> Download .py
                </button>
              ) : (
                <button className="btn primary lg" onClick={downloadProject} disabled={busy || exec.loading}>
                  {busy ? <Loader2 size={16} className="spin" /> : <FolderDown size={16} />} Download project
                </button>
              )}
              {target === "project" ? (
                <button className="btn" onClick={() => download("pipeline.py", code, "text/x-python")}>
                  <Download size={15} /> Download .py
                </button>
              ) : (
                <button className="btn" onClick={downloadProject} disabled={busy || exec.loading}>
                  <FolderDown size={15} /> Download project
                </button>
              )}
              <button className="btn" onClick={() => copyText(code).then(() => toast("success", "Copied pipeline.py"))}>
                <Copy size={15} /> Copy code
              </button>
            </div>
          </div>
        </div>
      </div>
      {full && (
        <Modal title="Generated Python code" size="xl" onClose={() => setFull(false)}>
          <CodeView code={shown[tab]} />
        </Modal>
      )}
    </div>
  );
}
