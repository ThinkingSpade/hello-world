"""Command-line interface: atlas ingest | ask | serve."""

from __future__ import annotations

import argparse
import json
import sys

from .config import Settings
from .pipeline import AtlasEngine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="atlas",
        description="Atlas — ops knowledge agent. Cited answers from runbooks, "
        "incidents, and live system state.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("ingest", help="(re)index the corpus into the vector store")

    ask = sub.add_parser("ask", help="ask a question, print the cited answer")
    ask.add_argument("question", nargs="+")
    ask.add_argument("--k", type=int, default=None, help="number of sources")
    ask.add_argument("--json", action="store_true", help="print raw JSON")

    serve = sub.add_parser("serve", help="run the web UI + API")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)

    export = sub.add_parser(
        "export", help="bake a self-contained static demo site (runs in-browser)"
    )
    export.add_argument("--out", default="dist")
    export.add_argument(
        "--corpus", action="append", metavar="NAME=DIR",
        help="named corpus to export (repeatable); default: corpus/ + corpus-supply/",
    )

    args = parser.parse_args(argv)
    settings = Settings.from_env()

    if args.command == "ingest":
        engine = AtlasEngine(settings)
        chunks = engine.ingest()
        print(f"indexed {engine.docs_indexed} docs → {chunks} chunks "
              f"({engine.store.name} store, {engine.embedder.name} embeddings)")
        if engine.docs_indexed == 0:
            print(
                f"warning: no .md docs found under '{settings.corpus_dir}' — "
                "run from the repo root or set ATLAS_CORPUS_DIR",
                file=sys.stderr,
            )
        return 0

    if args.command == "ask":
        engine = AtlasEngine(settings)
        if engine.store.count() == 0:
            engine.ingest()
        answer = engine.ask(" ".join(args.question), k=args.k)
        if args.json:
            print(json.dumps(answer.to_dict(), indent=2))
            return 0
        print(answer.answer)
        if answer.citations:
            print("\nSources:")
            for c in answer.citations:
                print(f"  [{c.n}] {c.doc_title} — {c.section}")
        print(
            f"\n({answer.latency_ms} ms, "
            f"{'cache hit' if answer.cached else 'fresh'}, "
            f"llm={answer.mode['llm']}, store={answer.mode['store']})"
        )
        return 0

    if args.command == "export":
        from .export import export_static

        corpora = None
        if args.corpus:
            corpora = []
            for spec in args.corpus:
                name, _, path = spec.partition("=")
                if not path:
                    parser.error(f"--corpus expects NAME=DIR, got {spec!r}")
                corpora.append((name, path))
        info = export_static(args.out, settings, corpora)
        print(
            f"exported {info['datasets']} dataset(s): {info['docs']} docs / "
            f"{info['chunks']} chunks / {info['words']} words / "
            f"{info['files']} raw files → {info['out']} ({info['size_kb']} KB)"
        )
        return 0

    if args.command == "serve":
        import uvicorn

        from .api import create_app

        host = args.host or settings.host
        port = args.port or settings.port
        uvicorn.run(create_app(AtlasEngine(settings)), host=host, port=port)
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
