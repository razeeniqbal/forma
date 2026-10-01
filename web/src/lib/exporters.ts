import type { Dataset, PipelineSpec } from "@/engine/types";
import { toText } from "@/engine/values";
import {
  generateAirflowDag,
  generateConfigYaml,
  generatePipelineJson,
  generatePrefectFlow,
  generatePython,
  generateReadme,
  generateRequirements,
  slug,
  type GenOptions,
} from "@/codegen/python";

export type ExportTarget = "project" | "airflow" | "prefect";

/** CSV with FORMA's canonical text form of every cell (what `--check` compares against). */
export function toCsv(ds: Dataset): string {
  const esc = (v: string | null) => (v === null ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [ds.columns.map(esc).join(","), ...ds.rows.map((r) => r.map((v) => esc(toText(v))).join(","))].join("\n") + "\n";
}

export interface ProjectFiles {
  [path: string]: string | Blob;
}

export function projectFiles(
  spec: PipelineSpec,
  opts: GenOptions & { expected?: Dataset; source?: Blob; extraSources?: Record<string, Blob>; target?: ExportTarget; schedule?: string | null },
): ProjectFiles {
  const files: ProjectFiles = {
    "pipeline.py": generatePython(spec, opts),
    "requirements.txt": generateRequirements(spec),
    "config.yaml": generateConfigYaml(spec, opts),
    "README.md": generateReadme(spec, opts) + (opts.expected ? "\n## Parity check\n\n`expected/forma_output.csv` is FORMA's output for the included source. Verify the exported code reproduces it exactly:\n\n```bash\npython pipeline.py --check expected/forma_output.csv\n```\n" : ""),
    "pipeline.json": generatePipelineJson(spec, opts.version ?? 1),
    ".gitignore": "output/\n.venv/\n__pycache__/\n",
  };
  if (opts.expected) files["expected/forma_output.csv"] = toCsv(opts.expected);
  if (opts.target === "airflow") {
    files[`forma_${slug(spec.name)}_dag.py`] = generateAirflowDag(spec, opts);
    files["README.md"] += `\n## Airflow\n\nCopy this folder into your Airflow \`dags/\` directory. The DAG \`forma_${slug(spec.name)}\` runs the pipeline${opts.schedule ? ` on \`${opts.schedule}\` (UTC)` : " when triggered"}. Install \`requirements.txt\` into your Airflow environment.\n`;
  }
  if (opts.target === "prefect") {
    files["flow.py"] = generatePrefectFlow(spec, opts);
    files["requirements.txt"] += "prefect>=3.0\n";
    files["README.md"] += `\n## Prefect\n\n\`python flow.py\` runs the pipeline once; every FORMA step appears as its own Prefect task.${opts.schedule ? ` \`python flow.py --serve\` runs it on \`${opts.schedule}\` (UTC).` : ""}\n`;
  }
  if (opts.source && spec.source) files[spec.source.file] = opts.source;
  for (const [name, blob] of Object.entries(opts.extraSources ?? {})) files[name] = blob;
  return files;
}

export async function zipProject(folder: string, files: ProjectFiles): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const dir = zip.folder(folder)!;
  for (const [path, content] of Object.entries(files)) dir.file(path, content);
  return zip.generateAsync({ type: "blob" });
}
