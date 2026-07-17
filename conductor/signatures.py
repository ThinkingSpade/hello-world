"""How Conductor recognizes what derailed a pipeline and drafts the repair.

Diagnoses are deterministic signature matches over the evidence bundle
(task error + failed checks + probe query results). Fixes come from
templates — a patched task SQL or a vetted repair script — never from
free-form SQL generation, and every proposal ships its risk grade and its
rollback up front. Destructive repairs back the table up first, always.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field


@dataclass
class Diagnosis:
    signature: str
    cause: str
    receipts: list[str] = field(default_factory=list)
    confidence: int = 80


@dataclass
class Proposal:
    display: str                 # what the human reviews (diff or SQL script)
    explain: str
    risk: str                    # low | medium | high
    rollback: str
    followup: str = ""
    patch: dict | None = None    # {"task", "old", "new"} → amend task SQL, re-run
    sql: str | None = None       # repair script → execute, then re-run


def _receipts(bundle: str, patterns: list[str], limit: int = 4) -> list[str]:
    out = []
    for line in bundle.splitlines():
        if line.strip() and any(re.search(p, line) for p in patterns):
            s = line.strip()
            if s not in out:
                out.append(s)
        if len(out) >= limit:
            break
    return out


def _diff(task: str, old: str, new: str, comment: str = "") -> str:
    return (f"--- tasks/{task}.sql\n+++ tasks/{task}.sql\n"
            f"- {old.strip()}\n+ {new.strip()}{('   -- ' + comment) if comment else ''}")


def diagnose(bundle: str):
    """Returns (Diagnosis, Proposal) or None if no signature matches."""

    # ---- schema drift: a column the task expects no longer exists --------
    m = re.search(r"no such column:\s*(?:\w+\.)?(\w+)", bundle)
    if m:
        missing = m.group(1)
        actual = re.findall(r"^\s*\d+\s+(\w+)\s+(?:INTEGER|TEXT|REAL|BLOB)", bundle, re.M)
        refs = re.search(r"columns referenced by \w+: (.+)", bundle)
        referenced = ([c.strip() for c in refs.group(1).split(",")] if refs else [])
        # the renamed column is one the table HAS but the task never asked for —
        # similarity alone is a trap (order_total ↔ order_ts)
        novel = [c for c in actual if c not in referenced] or actual
        close = difflib.get_close_matches(missing, novel, n=1, cutoff=0.3)
        if close:
            renamed = close[0]
            old = f"o.{missing} AS {missing}"
            new = f"o.{renamed} AS {missing}"
            d = Diagnosis(
                signature="schema-drift",
                cause=(f"Upstream schema drift: the vendor's export renamed "
                       f"`{missing}` to `{renamed}`, so the staging build now "
                       f"references a column that no longer exists and the whole "
                       f"pipeline halts at stg_orders. The raw data itself arrived "
                       f"fine — only the contract moved."),
                receipts=_receipts(bundle, [r"no such column", rf"\b{renamed}\b\s+(REAL|INTEGER|TEXT)"]),
                confidence=94)
            p = Proposal(
                display=_diff("stg_orders", old, new, "vendor renamed the column"),
                explain=(f"Alias the new column name back to `{missing}` in staging, "
                         f"so every downstream table keeps its contract. One line, "
                         f"rebuilds staging from raw — no source data touched."),
                risk="low",
                rollback=f"Reverse the patch: `{new}` → `{old}`, re-run the pipeline.",
                followup=("Add a schema contract check at load time so a renamed "
                          "column pages BEFORE the nightly run, not during it."),
                patch={"task": "stg_orders", "old": old, "new": new})
            return d, p

    # ---- key format drift: typeof change makes a join stop matching ------
    if re.search(r"CUST-\d+", bundle) and re.search(r"^text\b", bundle, re.M):
        d = Diagnosis(
            signature="key-format-drift",
            cause=("Today's export switched to formatted customer IDs — 'CUST-1042' "
                   "instead of 1042 — so they land as TEXT and the join to "
                   "customers_raw never matches. Region goes NULL for every order "
                   "loaded today: the revenue is still counted, just attributed to "
                   "nowhere, which is why every regional dashboard under-reports."),
            receipts=_receipts(bundle, [r"NULL region", r"^text\b", r"CUST-\d+"]),
            confidence=90)
        old = "       o.customer_id,"
        new = "       CAST(REPLACE(o.customer_id, 'CUST-', '') AS INTEGER) AS customer_id,"
        p = Proposal(
            display=_diff("stg_orders", old, new, "normalize the new key format at staging"),
            explain=("Normalize the key once, at staging — strip the new prefix and "
                     "cast back to INTEGER so every downstream join matches again. "
                     "Backfills today's partition on re-run; raw data untouched."),
            risk="medium",
            rollback="Reverse the patch and re-run; the raw table was never modified.",
            followup=("File it upstream: key formats are a contract. Add a typeof() "
                      "check at load so a format change pages at ingest, not at 2 a.m."),
            patch={"task": "stg_orders", "old": old, "new": new})
        return d, p

    # ---- duplicate load: same file ingested twice -------------------------
    if re.search(r"duplicated order_id", bundle) and re.search(r"batch-[\d-]+-02", bundle):
        d = Diagnosis(
            signature="duplicate-load",
            cause=("Yesterday's file was loaded twice — the loader retried after a "
                   "timeout that had actually succeeded, so every order from that day "
                   "exists under two batch tags and revenue reads exactly 2×. The "
                   "orders are real; the second copy is not."),
            receipts=_receipts(bundle, [r"duplicated order_id", r"batch-[\d-]+-02", r"\b2\b\s*$"]),
            confidence=93)
        sql = ("CREATE TABLE orders_raw_backup_dedup AS SELECT * FROM orders_raw;\n"
               "DELETE FROM orders_raw\n"
               "WHERE rowid NOT IN (SELECT MIN(rowid) FROM orders_raw GROUP BY order_id);")
        p = Proposal(
            display=sql,
            explain=("Back the raw table up, then delete the later copy of each "
                     "duplicated order (keep the first physical row per order_id). "
                     "Destructive on raw, hence the backup first and the high grade."),
            risk="high",
            rollback=("DROP TABLE orders_raw; "
                      "ALTER TABLE orders_raw_backup_dedup RENAME TO orders_raw;"),
            followup=("Make the loader idempotent — stage into a temp table and MERGE "
                      "on order_id — so a retry can never double-load again."),
            sql=sql)
        return d, p

    return None
