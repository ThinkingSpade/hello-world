"""The incident loop. Same shape as an SRE runbook, same hard rule as
always: nothing rewrites data or pipeline SQL without a human approval.

    page ──▶ run (halts) ──▶ probe ──▶ diagnose ──▶ propose ──▶ GATE ──▶ repair ──▶ re-run ──▶ verify
                                                                  │
                                                                  └─ declined → stop, warehouse untouched
"""

from __future__ import annotations

import sqlite3
import time

from . import signatures
from .pipeline import BOARD, Runner, q


class Agent:
    def __init__(self, conn: sqlite3.Connection, spec: dict | None = None):
        self.conn = conn
        self.runner = Runner(conn, spec)
        self.timeline: list[dict] = []
        self.start = time.monotonic()

    def _step(self, t: str, **kw):
        self.timeline.append({"t": t, **kw})

    def _probe(self, sql: str, note: str) -> str:
        out = q(self.conn, sql)
        self._step("cmd", cmd=sql, out=out, note=note)
        return out

    def _emit_run(self, result: dict):
        for ev in result["events"]:
            self._step("run", task=ev["task"], status=ev["status"], detail=ev["detail"])
            if ev.get("checks"):
                self._step("checks", task=ev["task"], results=ev["checks"])

    # ------------------------------------------------------------------ run
    def run(self, approve_cb, page_text: str) -> dict:
        self._step("page", text=page_text, sev="P2")
        result = self.runner.run()
        self._emit_run(result)

        if not result["failed"]:
            self._step("verify", result="green",
                       text="Every task and every check is green — false alarm, "
                            "or someone fixed it before the agent sat down.")
            return self._session(resolved=True)

        self._step("think", ms=1600, status="reading the failure")
        bundle = self._investigate(result)
        self._step("think", ms=2200, status="matching against known derailments")

        found = signatures.diagnose(bundle)
        if not found:
            self._step("diagnosis", signature="unknown", confidence=0, receipts=[],
                       cause=("No known signature matches this failure. Evidence "
                              "bundle saved — this one needs human eyes before "
                              "anything is rewritten."))
            self._step("verify", result="held",
                       text="Unknown derailment — Conductor stays read-only and "
                            "escalates with the evidence attached.")
            return self._session(resolved=False)

        diag, prop = found
        self._step("diagnosis", signature=diag.signature, cause=diag.cause,
                   receipts=diag.receipts, confidence=diag.confidence)
        proposal = {"command": prop.display, "explain": prop.explain, "risk": prop.risk,
                    "rollback": prop.rollback, "followup": prop.followup}
        self._step("proposal", **proposal)

        # ---- THE GATE ----
        approved = bool(approve_cb(proposal))
        self._step("approval", decision="approved" if approved else "declined",
                   by="dispatcher")
        if not approved:
            self._step("verify", result="held",
                       text="Proposal declined — nothing was rewritten. The failed "
                            "run, the evidence, and the staged rollback are all in "
                            "the ledger for the human on call.")
            return self._session(resolved=False)

        if prop.patch:
            self.runner.patch_task(prop.patch["task"], prop.patch["old"], prop.patch["new"])
            self._step("apply", cmd=f"patch tasks/{prop.patch['task']}.sql",
                       out=prop.display)
        else:
            self.conn.executescript(prop.sql)
            self.conn.commit()
            self._step("apply", cmd="apply repair script (backup first)", out=prop.sql)

        self._step("think", ms=1800, status="re-running the pipeline")
        result2 = self.runner.run()
        self._emit_run(result2)
        healthy = result2["failed"] is None
        self._step("verify", result="green" if healthy else "red",
                   text=("All tasks rebuilt, every check green — marts are fresh "
                         "and the numbers reconcile. Standing down." if healthy else
                         "Still failing after the repair — escalating to a human; "
                         "the rollback above is staged and ready."))
        return self._session(resolved=healthy)

    # ------------------------------------------------------------- probing
    def _investigate(self, result: dict) -> str:
        parts = []
        if "error" in result:
            parts.append(result["error"])
            parts.append(self._probe(
                "SELECT cid, name, type FROM pragma_table_info('orders_raw');",
                "what does the raw table actually look like now?"))
            # which raw columns does the failing task expect? the renamed one
            # is whichever actual column is NOT on this list
            import re as _re
            refs = _re.findall(r"\bo\.(\w+)", self.runner.task(result["failed"])["sql"])
            parts.append(f"columns referenced by {result['failed']}: "
                         + ", ".join(dict.fromkeys(refs)))
        else:
            chk = result["check"]
            parts.append(f"failed check: {chk['name']} on {chk['table']} — {chk['detail']}")
            if "region" in chk["name"] or "region" in chk["detail"]:
                parts.append(self._probe(
                    "SELECT day, SUM(orders) AS orphan_orders, SUM(revenue) AS orphan_revenue\n"
                    "FROM fct_daily_revenue WHERE region IS NULL GROUP BY day;",
                    "when did the orphan rows start?"))
                parts.append(self._probe(
                    "SELECT typeof(customer_id) AS key_type, COUNT(*) AS n\n"
                    "FROM orders_raw GROUP BY 1 ORDER BY n DESC;",
                    "are the join keys still the type we think they are?"))
                parts.append(self._probe(
                    "SELECT DISTINCT '''' || customer_id || '''' AS sample_key\n"
                    "FROM orders_raw WHERE typeof(customer_id) = 'text' LIMIT 3;",
                    "show me one of the misbehaving keys, quoted"))
            if "unique" in chk["name"]:
                parts.append(self._probe(
                    "SELECT order_id, COUNT(*) AS copies FROM stg_orders\n"
                    "GROUP BY order_id HAVING copies > 1 LIMIT 5;",
                    "sample the duplicated keys"))
                parts.append(self._probe(
                    "SELECT load_batch, COUNT(*) AS rows_loaded FROM orders_raw\n"
                    "GROUP BY load_batch ORDER BY load_batch DESC LIMIT 6;",
                    "the batch ledger never lies — was something loaded twice?"))
        return "\n".join(parts)

    def _session(self, resolved: bool) -> dict:
        return {"resolved": resolved,
                "duration_s": round(time.monotonic() - self.start, 1),
                "board": BOARD, "timeline": self.timeline}
