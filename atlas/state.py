"""Live system state.

The portfolio claim is that Atlas answers from "runbooks, past incidents, and
live system state". This module is the third leg: a provider that surfaces
current operational facts (service versions, on-call, open alerts) into the
answer context.

The default provider reads ops/system-state.yaml — the file stands in for
whatever your platform exposes (status API, service registry, PagerDuty). The
interface is one method, so swapping in a real source is a small class.
"""

from __future__ import annotations

from pathlib import Path

import yaml


class SystemStateProvider:
    def __init__(self, state_file: str | Path):
        self._path = Path(state_file)

    def load(self) -> dict:
        if not self._path.exists():
            return {}
        try:
            data = yaml.safe_load(self._path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except yaml.YAMLError:
            return {}

    def as_context(self) -> str:
        """Render state as a compact text block for the LLM prompt."""
        data = self.load()
        if not data:
            return ""
        lines: list[str] = []
        for section, value in data.items():
            lines.append(f"{section}:")
            if isinstance(value, dict):
                for k, v in value.items():
                    lines.append(f"  {k}: {v}")
            elif isinstance(value, list):
                for item in value:
                    lines.append(f"  - {item}")
            else:
                lines.append(f"  {value}")
        return "\n".join(lines)
