// Docs: how to use FORMA, inside the app. Navigation by section, search, related topics, Back / Next.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Search, X } from "lucide-react";
import { DOCS, DOC_SECTIONS, docPage, searchDocs, type DocBlock, type DocPage } from "@/docs/content";

/** Renders **bold**, `code` and [text](doc:slug) links. */
function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(doc:([\w-]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={m.index}>{m[1]}</b>);
    else if (m[2]) out.push(<code key={m.index}>{m[2]}</code>);
    else out.push(<Link key={m.index} to={`/docs/${m[4]}`}>{m[3]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Block({ b }: { b: DocBlock }) {
  if ("p" in b) return <p><Inline text={b.p} /></p>;
  if ("h" in b) return <h3>{b.h}</h3>;
  if ("list" in b) return <ul>{b.list.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>;
  if ("steps" in b) return <ol>{b.steps.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ol>;
  if ("flow" in b)
    return (
      <div className="doc-flow" role="img" aria-label={b.flow.join(", then ")}>
        {b.flow.map((x, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="doc-flow-arrow" aria-hidden>→</span>}
            <span className="doc-flow-step">{x}</span>
          </Fragment>
        ))}
      </div>
    );
  if ("code" in b) return <pre className="doc-code">{b.code}</pre>;
  return (
    <div className={`doc-note ${b.tone ?? "info"}`}>
      {b.tone === "planned" && <span className="doc-note-tag">Planned</span>}
      <Inline text={b.note} />
    </div>
  );
}

export function DocsPage() {
  const { slug } = useParams();
  const [q, setQ] = useState("");
  const top = useRef<HTMLDivElement>(null);
  const page = docPage(slug ?? "getting-started");
  const results = useMemo(() => searchDocs(q), [q]);
  useEffect(() => {
    top.current?.scrollTo({ top: 0 });
  }, [slug]);
  if (!page) return <Navigate to="/docs" replace />;
  const i = DOCS.indexOf(page);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    <div className="docs">
      <nav className="docs-nav" aria-label="Docs">
        <div className="docs-search">
          <Search size={14} color="var(--subtle)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search docs" aria-label="Search docs" />
          {q && (
            <button className="btn ghost xs icon" aria-label="Clear search" onClick={() => setQ("")}>
              <X size={13} />
            </button>
          )}
        </div>
        {q ? (
          <ul className="docs-results">
            {results.length === 0 && <li className="subtle small">No pages match "{q}".</li>}
            {results.map((d) => (
              <li key={d.slug}>
                <Link to={`/docs/${d.slug}`} onClick={() => setQ("")}>
                  <span className="t">{d.title}</span>
                  <span className="d">{d.section}. {d.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          DOC_SECTIONS.map((s) => (
            <div key={s} className="docs-section">
              <div className="docs-section-title">{s}</div>
              {DOCS.filter((d) => d.section === s).map((d) => (
                <Link key={d.slug} to={`/docs/${d.slug}`} className={d.slug === page.slug ? "on" : ""} aria-current={d.slug === page.slug ? "page" : undefined}>
                  {d.title}
                </Link>
              ))}
            </div>
          ))
        )}
      </nav>
      <div className="docs-main" ref={top}>
        <article className="doc">
          <div className="doc-crumb">Docs / {page.section}</div>
          <h1>{page.title}</h1>
          <p className="doc-summary">{page.summary}</p>
          {page.body.map((b, k) => (
            <Block key={k} b={b} />
          ))}
          {page.related && page.related.length > 0 && <Related pages={page.related.map(docPage).filter((x): x is DocPage => !!x)} />}
          <div className="doc-pager">
            {prev ? (
              <Link to={`/docs/${prev.slug}`} className="doc-pager-link">
                <ArrowLeft size={14} />
                <span>
                  <span className="subtle small">Back</span>
                  <br />
                  {prev.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/docs/${next.slug}`} className="doc-pager-link next">
                <span>
                  <span className="subtle small">Next</span>
                  <br />
                  {next.title}
                </span>
                <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

function Related({ pages }: { pages: DocPage[] }) {
  return (
    <div className="doc-related">
      <div className="docs-section-title">Related topics</div>
      <ul>
        {pages.map((d) => (
          <li key={d.slug}>
            <Link to={`/docs/${d.slug}`}>{d.title}</Link>
            <span className="subtle small"> {d.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
