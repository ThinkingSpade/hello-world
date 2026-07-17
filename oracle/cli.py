"""CLI: oracle ask | record | serve. --mock runs the full protocol keyless."""

from __future__ import annotations

import argparse
import json
import sys

from .council import Seat, run_debate
from .models import PROVIDERS, MockProvider, available_keys

DEFAULT_SEATS = [
    ("gpt", "GPT-5.5", "optimist", "gold", "openai"),
    ("claude", "Claude Opus 4.8", "fact-checker", "blue", "anthropic"),
    ("gemini", "Gemini 3.1 Pro", "skeptic", "violet", "gemini"),
    ("grok", "Grok 4.1", "wildcard", "coral", "xai"),
]
_MOCK_STANCE = {"optimist": 1, "fact-checker": 0, "skeptic": -1, "wildcard": -1}


def build_seats(mock: bool) -> tuple[list[Seat], object]:
    seats = []
    for sid, name, role, color, provider_key in DEFAULT_SEATS:
        if mock:
            provider = MockProvider(model=f"mock-{sid}", stance=_MOCK_STANCE[role])
        else:
            provider = PROVIDERS[provider_key]()
        seats.append(Seat(id=sid, name=name, role=role, color=color, provider=provider))
    moderator = MockProvider(model="mock-moderator") if mock else PROVIDERS["anthropic"]()
    return seats, moderator


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oracle", description="Oracle — debating agent council")
    sub = parser.add_subparsers(dest="command", required=True)

    ask = sub.add_parser("ask", help="run a debate, print the verdict")
    ask.add_argument("question", nargs="+")
    ask.add_argument("--mock", action="store_true", help="keyless deterministic providers")

    rec = sub.add_parser("record", help="run a debate, save a replay session json")
    rec.add_argument("question", nargs="+")
    rec.add_argument("-o", "--out", required=True)
    rec.add_argument("--mock", action="store_true")

    srv = sub.add_parser("serve", help="FastAPI: POST /api/debate {question}")
    srv.add_argument("--port", type=int, default=8500)
    srv.add_argument("--mock", action="store_true")

    args = parser.parse_args(argv)

    if args.command in ("ask", "record"):
        if not args.mock and not any(available_keys().values()):
            print("no provider API keys found — set ANTHROPIC_API_KEY / OPENAI_API_KEY / "
                  "GROQ_API_KEY / GEMINI_API_KEY / XAI_API_KEY, or pass --mock", file=sys.stderr)
            return 2
        seats, moderator = build_seats(args.mock)
        session = run_debate(" ".join(args.question), seats, moderator)
        if args.command == "record":
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(session, f, indent=1)
            print(f"recorded → {args.out}")
        else:
            r = session["result"]
            print(r["answer"])
            print(f"\nconfidence: {r['confidence']}%  ({r['how_scored']})")
            for aid, vote in r["votes"].items():
                print(f"  {aid}: {vote}")
        return 0

    if args.command == "serve":
        import uvicorn
        from fastapi import FastAPI
        from pydantic import BaseModel

        app = FastAPI(title="Oracle")
        seats, moderator = build_seats(args.mock)

        class Ask(BaseModel):
            question: str

        @app.post("/api/debate")
        def debate(body: Ask):
            return run_debate(body.question, seats, moderator)

        uvicorn.run(app, host="0.0.0.0", port=args.port)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
