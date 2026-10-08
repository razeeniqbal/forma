// Python runtime helpers embedded in every generated pipeline. They mirror
// src/engine/values.ts, load.ts and the review gate in execute.ts exactly.
import { DATE_FORMATS, MONEY_RE, MONTHS } from "@/engine/values";

const pyRaw = (s: string) => (s.includes('"') || s.endsWith("\\") ? JSON.stringify(s) : `r"${s}"`);

function dateTable(): string {
  const lines = Object.entries(DATE_FORMATS).map(
    ([k, v]) => `    ${JSON.stringify(k)}: (${pyRaw(v.re)}, ${v.d}, ${v.m}, ${v.y}),`,
  );
  return `DATE_FORMATS = {\n${lines.join("\n")}\n}`;
}

function monthTable(): string {
  const entries = Object.entries(MONTHS).map(([k, v]) => `"${k}": ${v}`);
  const rows: string[] = [];
  for (let i = 0; i < entries.length; i += 6) rows.push("    " + entries.slice(i, i + 6).join(", ") + ",");
  return `MONTHS = {\n${rows.join("\n")}\n}`;
}

export function runtimePython(): string {
  return String.raw`# ---------------------------------------------------------------------------
# FORMA runtime helpers
# Small, dependency-free helpers that give every step exactly the same value
# semantics as the FORMA app: blank handling, number/date parsing and flagging
# rows for review. You normally don't need to edit anything in this section.
# ---------------------------------------------------------------------------

ISSUES: list[dict] = []
FINGERPRINTS: dict[int, str] = {}
HELD: dict = {"review": [], "excluded": []}
NEXT_ROW_ID = [1]
RUN_CONFIG: dict = {}


class Flag(Exception):
    """Raised inside a step to send a value to the review queue."""

    def __init__(self, kind: str, message: str, value=...):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.value = value


def flag(row: int, column: str, step: str, kind: str, message: str, value) -> None:
    ISSUES.append({"row": int(row), "column": column, "step": step, "kind": kind, "message": message, "value": value})


def to_text(v):
    """Canonical text form of a cell (None for blanks)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return "True" if v else "False"
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        v = float(v)
        if math.isnan(v) or math.isinf(v):
            return None
        if v.is_integer() and abs(v) < 1e16:
            return str(int(v))
        return repr(v)
    return str(v)


def is_blank(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, str):
        return v.strip() == ""
    return False


def is_number(v) -> bool:
    return isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, bool) and not (
        isinstance(v, float) and math.isnan(v)
    )


_STRICT_NUM = re.compile(r"^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$", re.ASCII)


def to_num(v):
    """Strict numeric value used by formulas, filters and rules."""
    if v is None:
        return None
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if is_number(v):
        v = float(v)
        return None if math.isinf(v) else v
    if isinstance(v, float):
        return None
    s = str(v)
    if not _STRICT_NUM.match(s):
        return None
    n = float(s)
    return None if math.isinf(n) else n


MONEY_RE = re.compile(${pyRaw(MONEY_RE.source)}, re.ASCII)


def parse_money(v):
    """Parse numbers such as 'RM 4,500', '$1,299.00' or '-50'. Returns None if ambiguous."""
    if v is None or isinstance(v, bool):
        return None
    if is_number(v):
        return None if math.isinf(float(v)) else v
    if isinstance(v, float):
        return None
    m = MONEY_RE.match(str(v))
    if not m:
        return None
    n = float(m.group(4).replace(",", "") + (m.group(5) or ""))
    if math.isinf(n):
        return None
    return -n if (m.group(1) == "-" or m.group(3) == "-") else n


def round_half_even(x: float, decimals: int) -> float:
    """numpy-style rounding (banker's rounding on the scaled value)."""
    f = 10.0 ** decimals
    out = float(np.rint(x * f)) / f
    return 0.0 if out == 0 else out


def title_case(s: str) -> str:
    return s.title()


${dateTable()}

${monthTable()}

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _days_in(y: int, m: int) -> int:
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    return [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]


def parse_date(v, formats):
    """Return (year, month, day) using the first format that yields a real calendar date."""
    t = to_text(v)
    if t is None:
        return None
    t = t.strip()
    for fmt in formats:
        pattern, di, mi, yi = DATE_FORMATS[fmt]
        m = re.match(pattern, t, re.ASCII)
        if not m:
            continue
        month_raw = m.group(mi)
        if month_raw.isdigit():
            month = int(month_raw)
        else:
            month = MONTHS.get(month_raw.lower())
            if month is None:
                continue
        day = int(m.group(di))
        year = int(m.group(yi))
        if len(m.group(yi)) == 2:
            year += 2000 if year <= 68 else 1900
        if not (1 <= month <= 12) or not (1000 <= year <= 9999) or not (1 <= day <= _days_in(year, month)):
            continue
        return (year, month, day)
    return None


def format_date(ymd, fmt: str) -> str:
    y, m, d = ymd
    if fmt == "DD/MM/YYYY":
        return f"{d:02d}/{m:02d}/{y:04d}"
    if fmt == "MM/DD/YYYY":
        return f"{m:02d}/{d:02d}/{y:04d}"
    if fmt == "DD-MM-YYYY":
        return f"{d:02d}-{m:02d}-{y:04d}"
    if fmt == "DD MMM YYYY":
        return f"{d:02d} {MONTH_ABBR[m - 1]} {y:04d}"
    return f"{y:04d}-{m:02d}-{d:02d}"


ANY_DATE_FORMATS = [f for f in DATE_FORMATS if f != "MM/DD/YYYY"]


def column(values, index) -> pd.Series:
    """Build an object column that keeps None as a real blank."""
    return pd.Series(list(values), index=index, dtype=object)


def map_column(df: pd.DataFrame, name: str, fn, step: str) -> pd.Series:
    """Apply fn to every value; values raising Flag are blanked and sent to review."""
    out = []
    for row, v in zip(df.index, df[name]):
        try:
            out.append(fn(v))
        except Flag as f:
            flag(row, name, step, f.kind, f.message, v if f.value is ... else f.value)
            out.append(None)
    return column(out, df.index)


def numeric(df: pd.DataFrame, name: str) -> pd.Series:
    """Numeric view of a column for formulas (blank/invalid -> NaN)."""
    return pd.Series([to_num(v) for v in df[name]], index=df.index, dtype=float)


def _safe_div(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        out = a / b
    return out.where(np.isfinite(out)) if isinstance(out, pd.Series) else (out if np.isfinite(out) else np.nan)


def from_numeric(values, index) -> pd.Series:
    s = values if isinstance(values, pd.Series) else pd.Series(values, index=index, dtype=float)
    return column([None if (v is None or not np.isfinite(v)) else float(v) for v in s], index)


def regex_extract(text, pattern: str, ignore_case: bool = False):
    if text is None:
        return None
    m = re.search(pattern, text, re.ASCII | (re.IGNORECASE if ignore_case else 0))
    if not m:
        return None
    return m.group(1) if m.re.groups >= 1 else m.group(0)


def rename_issues(mapping: dict) -> None:
    for i in ISSUES:
        i["column"] = mapping.get(i["column"], i["column"])


def prune_issues(df: pd.DataFrame, before: set) -> None:
    """Drop issues of rows removed by this step (rows held earlier keep theirs)."""
    cols, rows, before = set(df.columns), set(int(r) for r in df.index), set(int(r) for r in before)
    ISSUES[:] = [i for i in ISSUES if i["row"] not in before or (i["row"] in rows and i["column"] in cols)]


def apply_review_gate(df: pd.DataFrame, decisions: list[dict]):
    """Hold rows with unresolved issues for review; apply recorded review decisions."""
    by_row: dict[int, list] = {}
    for i in ISSUES:
        by_row.setdefault(i["row"], []).append(i)
    dec_by_row: dict[int, list] = {}
    for d in decisions:
        if d.get("fingerprint") is not None and FINGERPRINTS.get(d["row"]) != d["fingerprint"]:
            continue  # the row changed since the decision was made
        dec_by_row.setdefault(d["row"], []).append(d)
    numeric_cols = {c: any(is_number(v) for v in df[c]) for c in df.columns}
    cols = list(df.columns)
    kept, kept_ids, review_ids, excluded_ids = [], [], [], []
    for row_id, values in zip(df.index, df.itertuples(index=False, name=None)):
        row_id = int(row_id)
        decs = dec_by_row.get(row_id, [])
        if any(d["action"] == "exclude" for d in decs):
            excluded_ids.append(row_id)
            continue
        values = list(values)
        issues = by_row.get(row_id)
        for d in decs:
            if d.get("column") not in cols:
                continue
            ci = cols.index(d["column"])
            if d["action"] == "correct" and d.get("value") is not None:
                n = to_num(d["value"]) if numeric_cols[d["column"]] else None
                values[ci] = n if n is not None else d["value"]
            elif d["action"] == "keep" and issues:
                orig = next((i for i in issues if i["column"] == d["column"]), None)
                if orig is not None:
                    values[ci] = orig["value"]
        if issues:
            resolved = {d["column"] for d in decs if d.get("column") is not None}
            ignore_all = any(d.get("column") is None and d["action"] == "ignore" for d in decs)
            if not ignore_all and any(i["column"] not in resolved for i in issues):
                review_ids.append(row_id)
                continue
        kept.append(values)
        kept_ids.append(row_id)
    out = pd.DataFrame(kept, columns=cols, index=kept_ids, dtype=object)
    return out, review_ids, excluded_ids


def hold_for_review(df: pd.DataFrame) -> pd.DataFrame:
    """Review gate before a reshaping step: hold rows with open issues, apply decisions."""
    out, review_ids, excluded_ids = apply_review_gate(df, REVIEW_DECISIONS)
    HELD["review"].extend(review_ids)
    HELD["excluded"].extend(excluded_ids)
    return out


def fingerprint(row) -> str:
    return "\u241f".join(to_text(v) or "" for v in row)


def new_rows(columns: list, rows: list) -> pd.DataFrame:
    """Rows created by reshaping / joining / appending get new, unique row ids."""
    ids = []
    for row in rows:
        ids.append(NEXT_ROW_ID[0])
        FINGERPRINTS[NEXT_ROW_ID[0]] = fingerprint(row)
        NEXT_ROW_ID[0] += 1
    return pd.DataFrame(rows, columns=columns, index=ids, dtype=object)


def key_rows(df: pd.DataFrame, columns: list) -> list:
    """Per-row tuples of the given columns (one empty tuple per row when no columns)."""
    return list(zip(*(list(df[c]) for c in columns))) if columns else [()] * len(df)


def row_key(values) -> tuple:
    return tuple(to_text(v) for v in values)


def aggregate_values(values: list, fn: str):
    if fn == "first":
        return next((v for v in values if not is_blank(v)), None)
    if fn == "count":
        return sum(1 for v in values if not is_blank(v))
    if fn == "count_distinct":
        return len({to_text(v) for v in values if not is_blank(v)})
    total, n, lo, hi = 0.0, 0, None, None
    for v in values:
        x = to_num(v)
        if x is None:
            continue
        total += x
        n += 1
        lo = x if lo is None or x < lo else lo
        hi = x if hi is None or x > hi else hi
    if not n:
        return None
    return {"sum": total, "mean": total / n, "min": lo, "max": hi}[fn]


def group_rows(df: pd.DataFrame, by: list, aggregations: list) -> pd.DataFrame:
    """Group rows (in order of first appearance) and aggregate columns."""
    names = by + [name for _, _, name in aggregations]
    if len(set(names)) != len(names):
        raise ValueError("Output column names must be unique")
    keys = key_rows(df, by)
    values = {c: list(df[c]) for c, _, _ in aggregations}
    groups: dict = {}
    for pos, key in enumerate(keys):
        groups.setdefault(row_key(key), []).append(pos)
    rows = [list(keys[members[0]]) + [aggregate_values([values[c][m] for m in members], fn) for c, fn, _ in aggregations] for members in groups.values()]
    return new_rows(names, rows)


def pivot_rows(df: pd.DataFrame, index: list, column: str, value: str, fn: str) -> pd.DataFrame:
    """Turn the distinct values of the pivot column into columns (first-appearance order)."""
    keys = key_rows(df, index)
    pivots, values = list(df[column]), list(df[value])
    pivot_values, seen, groups = [], set(), {}
    for pos, key in enumerate(keys):
        p = to_text(pivots[pos])
        p = "(blank)" if p is None else p
        if p not in seen:
            seen.add(p)
            pivot_values.append(p)
        g = groups.setdefault(row_key(key), {"first": pos, "cells": {}})
        g["cells"].setdefault(p, []).append(values[pos])
    names = [f"{p}_{column}" if p in index else p for p in pivot_values]
    rows = [
        list(keys[g["first"]]) + [aggregate_values(g["cells"][p], fn) if p in g["cells"] else None for p in pivot_values]
        for g in groups.values()
    ]
    return new_rows(index + names, rows)


def unpivot_rows(df: pd.DataFrame, keep: list, columns: list, name_column: str, value_column: str) -> pd.DataFrame:
    """Turn columns into rows: one output row per input row and unpivoted column."""
    names = keep + [name_column, value_column]
    if len(set(names)) != len(names):
        raise ValueError("Output column names must be unique")
    kept = key_rows(df, keep)
    values = {c: list(df[c]) for c in columns}
    rows = [list(kept[pos]) + [c, values[c][pos]] for pos in range(len(df)) for c in columns]
    return new_rows(names, rows)


def side_source(step_id: str) -> pd.DataFrame:
    """Load the additional source used by a join / lookup / append step."""
    return load_source(RUN_CONFIG.get("sources", CONFIG.get("sources", {}))[step_id], record=False)


def combine_rows(df, other, on, columns, prefix, how, mode, flag_unmatched, step, source_name):
    """Lookup (first match, row ids kept) or join (every match, new row ids) with another source."""
    left_keys, right_keys = [l for l, _ in on], [r for _, r in on]
    for c in right_keys + columns:
        if c not in other.columns:
            raise ValueError(f'Column "{c}" not found in {source_name}')
    out_names = [prefix + c if c in df.columns else c for c in columns]
    names = list(df.columns) + out_names
    if len(set(names)) != len(names):
        raise ValueError("Joined column names clash; change the prefix")
    right = {c: list(other[c]) for c in set(right_keys + columns)}
    index: dict = {}
    for pos in range(len(other)):
        key = [right[c][pos] for c in right_keys]
        if any(is_blank(v) for v in key):
            continue  # blank keys never match
        index.setdefault(row_key(key), []).append(pos)
    key_pos = [list(df.columns).index(c) for c in left_keys]
    blank = [None] * len(columns)
    rows, ids = [], []
    for row_id, values in zip(df.index, df.itertuples(index=False, name=None)):
        values = list(values)
        key = [values[k] for k in key_pos]
        hits = None if any(is_blank(v) for v in key) else index.get(row_key(key))
        if mode == "lookup":
            if not hits:
                if how == "inner":
                    continue
                if flag_unmatched:
                    shown = ", ".join(to_text(v) if to_text(v) is not None else "blank" for v in key)
                    flag(row_id, left_keys[0], step, "missing_value", f"No match in {source_name} for {shown}", key[0])
            rows.append(values + ([right[c][hits[0]] for c in columns] if hits else blank))
            ids.append(int(row_id))
        elif hits:
            rows.extend(values + [right[c][h] for c in columns] for h in hits)
        elif how == "left":
            rows.append(values + blank)
    if mode == "lookup":
        out = pd.DataFrame(rows, columns=names, index=ids, dtype=object)
        if how == "inner":
            prune_issues(out, set(df.index))
        return out
    return new_rows(names, rows)


def rename_appended(other: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    """Apply an explicit schema mapping before appending (appended column -> pipeline column)."""
    for name in mapping:
        if name not in other.columns:
            raise ValueError(f"Mapped column \"{name}\" not found")
    renamed = [mapping.get(c, c) for c in other.columns]
    if len(set(renamed)) != len(renamed):
        raise ValueError("Two appended columns map to the same column; check the schema mapping")
    return other.set_axis(renamed, axis=1)


def append_rows(df: pd.DataFrame, other: pd.DataFrame) -> pd.DataFrame:
    """Stack another source's rows below; columns are matched by name."""
    names = list(df.columns) + [c for c in other.columns if c not in df.columns]
    extra = new_rows(names, [[row.get(c) for c in names] for row in other.to_dict("records")])
    base = df.copy()
    for c in names[len(df.columns):]:
        base[c] = column([None] * len(base), base.index)
    return pd.concat([base, extra])


def normalize_cell(v):
    """Normalise a raw file cell the way FORMA does on import."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d") + " 00:00:00"
    if isinstance(v, time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, str):
        return v if v != "" else None
    if isinstance(v, Decimal):
        return float(v)
    return v


def _json_cell(v):
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return normalize_cell(v)


def _records_to_grid(records) -> list[list]:
    keys: list[str] = []
    for r in records:
        if isinstance(r, dict):
            for k in r:
                if k not in keys:
                    keys.append(k)
    grid = [list(keys)]
    for r in records:
        if isinstance(r, dict):
            grid.append([_json_cell(r.get(k)) for k in keys])
        else:
            grid.append([_json_cell(r)] + [None] * (len(keys) - 1))
    return grid


def read_grid(src: dict) -> list[list]:
    """Read the raw grid of cells (rows x columns) from the source."""
    kind = src["type"]
    if kind == "database":
        from sqlalchemy import create_engine, text as sql

        url = os.environ.get(src["url_env"])
        if not url:
            raise SystemExit(f"Set the {src['url_env']} environment variable to the database URL.")
        with create_engine(url).connect() as conn:
            result = conn.execute(sql(src["query"]))
            return [list(result.keys())] + [[normalize_cell(v) for v in row] for row in result]
    if kind == "api":
        import urllib.request

        headers = {"Accept": "application/json, text/csv, */*", "User-Agent": "forma-pipeline"}
        if src.get("token_env"):
            headers["Authorization"] = "Bearer " + os.environ[src["token_env"]]
        with urllib.request.urlopen(urllib.request.Request(src["url"], headers=headers), timeout=120) as resp:
            body = resp.read().decode("utf-8-sig")
        if src.get("format") == "csv":
            return [[c if c != "" else None for c in row] for row in csv.reader(io.StringIO(body))]
        data = json.loads(body)
        if isinstance(data, dict):
            data = next((v for v in data.values() if isinstance(v, list)), [data])
        return _records_to_grid(data)
    path = src["path"]
    if not os.path.isabs(path) and not os.path.exists(path):
        path = str(HERE / path)  # relative paths resolve next to pipeline.py
    if kind == "excel":
        from openpyxl import load_workbook

        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb[src["sheet"]] if src.get("sheet") else wb.worksheets[0]
        grid = [[normalize_cell(v) for v in row] for row in ws.iter_rows(min_row=1, min_col=1, values_only=True)]
        wb.close()
        return grid
    with open(path, encoding="utf-8-sig", newline="") as fh:
        text = fh.read()
    if kind == "csv":
        reader = csv.reader(io.StringIO(text), delimiter=src.get("delimiter") or ",")
        return [[c if c != "" else None for c in row] for row in reader]
    if kind == "json":
        data = json.loads(text)
        if isinstance(data, dict):
            data = next((v for v in data.values() if isinstance(v, list)), [data])
        return _records_to_grid(data)
    if kind == "jsonl":
        return _records_to_grid([json.loads(line) for line in re.split(r"\r?\n", text) if line.strip()])
    return [[line if line != "" else None] for line in re.split(r"\r?\n", text)]


def _col_letter(i: int) -> str:
    s, n = "", i + 1
    while n > 0:
        r = (n - 1) % 26
        s = chr(65 + r) + s
        n = (n - 1) // 26
    return s


def load_source(src: dict, record: bool = True) -> pd.DataFrame:
    """Load the detected data region. The index is the source row number."""
    grid = read_grid(src)
    header_row, start, end = src["header_row"], src["start_col"], src["end_col"]
    header = grid[header_row] if 0 <= header_row < len(grid) else []
    names, seen = [], {}
    for c in range(start, end + 1):
        name = (to_text(header[c]) if c < len(header) else None) or ""
        name = name.strip() or f"Column_{_col_letter(c)}"
        seen[name] = seen.get(name, 0) + 1
        names.append(name if seen[name] == 1 else f"{name}_{seen[name]}")
    rows, ids = [], []
    for r in range(header_row + 1, len(grid)):
        raw = grid[r]
        row = [raw[c] if c < len(raw) else None for c in range(start, end + 1)]
        if all(is_blank(v) for v in row):
            continue
        rows.append(row)
        ids.append(r + 1)
        if record:
            FINGERPRINTS[r + 1] = fingerprint(row)
    return pd.DataFrame(rows, columns=names, index=ids, dtype=object)
`;
}
