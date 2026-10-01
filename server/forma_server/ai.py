"""AI-assisted extraction (PRD §10): Claude proposes deterministic regex patterns.

AI is an assistant, not the execution engine. The model only *suggests*
field names and regular expressions; the server validates every pattern and
measures its match rate on the samples, and FORMA previews it before the
user applies anything. Execution stays deterministic (plain regex).
"""
from __future__ import annotations

import json
import re

MODEL = "claude-opus-5-5"

SCHEMA = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "snake_case output column name"},
                    "type": {"type": "string", "enum": ["text", "number", "date"]},
                    "pattern": {"type": "string", "description": "Regular expression; capture group 1 (if present) is the value"},
                    "explanation": {"type": "string"},
                },
                "required": ["name", "type", "pattern", "explanation"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["fields"],
    "additionalProperties": False,
}

SYSTEM = """You design regular expressions for a deterministic data-cleaning tool.
Given sample values from one text column, propose the structured fields worth extracting.

Rules for each pattern:
- It must work identically in Python `re` and JavaScript RegExp: no named groups, no lookbehind, no possessive quantifiers, no inline flags, no \\A \\Z \\z.
- It is applied with search semantics to each value; if it has a capture group, group 1 is the extracted value.
- Prefer patterns that tolerate the variation you see (optional '#', optional '-', spacing), but never match the wrong field.
- For amounts, capture the number text including separators (e.g. "4,500.00"); the tool parses currency itself. Use type "number".
- For dates, capture the date text as written; the tool validates calendar dates. Use type "date".
- Return 1 to 6 fields with short snake_case names. Do not invent fields that are absent from the samples."""

_UNSUPPORTED = re.compile(r"\(\?P|\(\?<[=!]|\(\?[aiLmsux]|\\[AZz]|[*+?}]\+")


class AIError(Exception):
    pass


def _client():
    import anthropic

    return anthropic.Anthropic()


def validate_pattern(pattern: str) -> str | None:
    """Return an error message if the pattern is not portable between Python and JS."""
    if _UNSUPPORTED.search(pattern):
        return "uses syntax that differs between Python and JavaScript"
    try:
        compiled = re.compile(pattern, re.ASCII)
    except re.error as e:
        return f"invalid pattern: {e}"
    del compiled  # compiled only to validate; group 1 (if any) is the value
    return None


def suggest_patterns(samples: list[str], hint: str | None = None, client=None) -> list[dict]:
    samples = [s for s in samples if isinstance(s, str) and s.strip()][:60]
    if not samples:
        raise AIError("No sample values to learn from.")
    client = client or _client()
    content = "Sample values (one per line):\n" + "\n".join(f"- {s[:300]}" for s in samples)
    if hint:
        content += f"\n\nThe user wants: {hint[:500]}"
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=SYSTEM,
        messages=[{"role": "user", "content": content}],
    )
    if response.stop_reason == "refusal":
        raise AIError("The model declined this request.")
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
    if not text:
        raise AIError("The model returned no suggestions.")
    try:
        fields = json.loads(text)["fields"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise AIError("The model returned malformed suggestions.") from e

    out = []
    for f in fields[:6]:
        name = re.sub(r"[^a-z0-9_]+", "_", str(f.get("name", "")).lower()).strip("_") or "field"
        pattern = str(f.get("pattern", ""))
        problem = validate_pattern(pattern)
        if problem:
            continue  # never hand the user a pattern FORMA can't execute identically
        compiled = re.compile(pattern, re.ASCII)
        hits = 0
        for s in samples:
            m = compiled.search(s)
            if m and (m.group(1) if compiled.groups else m.group(0)):
                hits += 1
        out.append(
            {
                "name": name,
                "type": f.get("type") if f.get("type") in ("text", "number", "date") else "text",
                "pattern": pattern,
                "explanation": str(f.get("explanation", ""))[:300],
                "sample_match_rate": hits / len(samples),
            }
        )
    if not out:
        raise AIError("None of the suggested patterns could be used safely.")
    return out
