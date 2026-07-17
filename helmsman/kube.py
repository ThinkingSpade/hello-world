"""kubectl, twice: the real thing (subprocess) and a deterministic fake.

The fake replays canned command→output fixtures and flips to an "after"
state once a mutating command runs — which is what lets `helmsman record`
drive the REAL pipeline end-to-end (triage → diagnose → propose → gate →
apply → verify) without a cluster, and lets the test suite assert every
step offline.
"""

from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path

# commands that change cluster state; everything else is read-only
MUTATING = ("set ", "rollout undo", "patch ", "apply ", "scale ", "delete ",
            "edit ", "annotate ", "label ", "cordon", "drain", "taint")


def is_mutating(args: str) -> bool:
    return any(args.startswith(m) or f" {m}" in args for m in MUTATING)


class Kubectl:
    """Real kubectl. Read commands run freely; mutating commands must be
    explicitly unlocked by the pipeline's approval gate."""

    def __init__(self, context: str | None = None, timeout: int = 30):
        self.context = context
        self.timeout = timeout

    def run(self, args: str, allow_mutation: bool = False) -> str:
        if is_mutating(args) and not allow_mutation:
            raise PermissionError(
                f"refusing un-approved mutating command: kubectl {args}")
        cmd = ["kubectl"] + (["--context", self.context] if self.context else [])
        cmd += shlex.split(args)
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout)
        if p.returncode != 0:
            raise RuntimeError(f"kubectl {args} failed: {p.stderr.strip()}")
        return p.stdout


class FakeKubectl:
    """Replays a fixture: {commands: {...}, after: {...}, meta...}.

    Lookup order is exact string match; once any mutating command has been
    applied, the `after` map wins — so a post-fix `get pods` shows recovery.
    """

    def __init__(self, fixture: dict | str | Path):
        if not isinstance(fixture, dict):
            fixture = json.loads(Path(fixture).read_text())
        self.fixture = fixture
        self.commands: dict = fixture["commands"]
        self.after: dict = fixture.get("after", {})
        self.applied: list[str] = []

    def run(self, args: str, allow_mutation: bool = False) -> str:
        if is_mutating(args):
            if not allow_mutation:
                raise PermissionError(
                    f"refusing un-approved mutating command: kubectl {args}")
            self.applied.append(args)
            return self.after.get(args) or self.commands.get(args) or (
                args.split()[1] + " updated (fixture)")
        if self.applied and args in self.after:
            return self.after[args]
        if args in self.commands:
            return self.commands[args]
        raise KeyError(f"fixture has no output for: kubectl {args}")
