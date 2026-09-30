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


def prune_issues(df: pd.DataFrame) -> None:
    cols, rows = set(df.columns), set(int(r) for r in df.index)
    ISSUES[:] = [i for i in ISSUES if i["column"] in cols and i["row"] in rows]


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
    """Read the raw grid of cells (rows x columns) from the source file."""
    path, kind = src["path"], src["type"]
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


def load_source(src: dict) -> pd.DataFrame:
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
        FINGERPRINTS[r + 1] = "␟".join(to_text(v) or "" for v in row)
    return pd.DataFrame(rows, columns=names, index=ids, dtype=object)
`;
}
