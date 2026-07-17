"""Answer generation.

- ExtractiveLLM: offline answerer for demo mode and tests. No API calls — it
  selects the most question-relevant sentences from the retrieved chunks and
  stitches them into a cited summary. Honest about what it is: retrieval
  quality is real, prose quality is basic.
- GroqLLM: production path. LangChain's ChatGroq drafts the answer fast,
  under a system prompt that enforces [n] citations against the provided
  numbered sources only.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Protocol

from .schema import Chunk

_STOPWORDS = frozenset(
    "a an and are as at be by do does for from how i in is it of on or our the "
    "this to we what when where which who why with you your".split()
)


def content_words(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z0-9]+", text.lower())
        if w not in _STOPWORDS and len(w) > 1
    }


class LLM(Protocol):
    name: str

    def generate(
        self,
        question: str,
        sources: list[tuple[int, Chunk]],
        system_state: str = "",
    ) -> str: ...


class ExtractiveLLM:
    name = "extractive"

    @staticmethod
    def _sentences(text: str) -> list[str]:
        # Keep fenced code blocks intact as single "sentences".
        parts: list[str] = []
        for block in re.split(r"(```[\s\S]*?```)", text):
            if block.startswith("```"):
                parts.append(block.strip())
            else:
                for line in block.split("\n"):
                    line = line.strip().lstrip("#").strip()
                    if not line:
                        continue
                    if line.startswith("**"):
                        # timestamped transcript line — keep speaker + words together
                        parts.append(line)
                        continue
                    parts.extend(
                        s.strip() for s in re.split(r"(?<=[.!?])\s+", line) if s.strip()
                    )
        return parts

    def generate(
        self,
        question: str,
        sources: list[tuple[int, Chunk]],
        system_state: str = "",
    ) -> str:
        q_words = content_words(question)
        state_lines = self._matching_state_lines(q_words, system_state)
        if not sources:
            if state_lines:
                return (
                    "Nothing in the corpus matches that, but the live system "
                    "state does:\n" + "\n".join(state_lines)
                )
            return (
                "I couldn't find anything relevant in the corpus for that. "
                "Try rephrasing, or check that the corpus is ingested (/api/health)."
            )
        lines: list[str] = []
        for n, chunk in sources:
            scored = []
            for sentence in self._sentences(chunk.text):
                if sentence.startswith("```"):
                    continue
                overlap = len(q_words & content_words(sentence))
                scored.append((overlap, len(sentence), sentence))
            scored.sort(key=lambda t: (-t[0], t[1]))
            picks = [s for _, _, s in scored[:2] if s]
            if picks:
                lines.append(f"• {' '.join(picks)} [{n}]")
        titles = ", ".join(dict.fromkeys(f"{c.doc_title}" for _, c in sources))
        header = f"From {titles}:"
        answer = header + "\n\n" + "\n\n".join(lines)
        if state_lines:
            answer += "\n\nLive system state:\n" + "\n".join(state_lines)
        return answer

    @staticmethod
    def _matching_state_lines(q_words: set[str], system_state: str) -> list[str]:
        """Surface state lines the question plausibly asks about (substring
        match so "call" hits "oncall"), keeping section headers for context."""
        if not system_state or not q_words:
            return []
        picked: list[str] = []
        header = ""
        last_header_added = ""
        for line in system_state.splitlines():
            if line and not line.startswith(" "):
                header = line
                continue
            lowered = line.lower()
            if any(len(w) >= 3 and w in lowered for w in q_words) or any(
                len(w) >= 4 and w in header.lower() for w in q_words
            ):
                if header and header != last_header_added:
                    picked.append(header)
                    last_header_added = header
                picked.append(line)
            if len(picked) >= 8:
                break
        return picked


class GroqLLM:
    name = "groq"

    _SYSTEM = (
        "You are Atlas, an ops knowledge agent. Answer the question using ONLY "
        "the numbered sources and the live system state provided. Cite every "
        "factual claim with its source number in square brackets, e.g. [1]. "
        "If the sources don't contain the answer, say so plainly. Prefer exact "
        "commands from the sources. Be concise: a short answer, then numbered "
        "steps if the question is procedural."
    )

    def __init__(self, model: str, api_key: str = ""):
        try:
            from langchain_groq import ChatGroq
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "langchain-groq is not installed — pip install 'atlas-ops-agent[prod]' "
                "or set ATLAS_LLM=extractive"
            ) from exc
        kwargs = {"model": model, "temperature": 0.1}
        if api_key:
            kwargs["api_key"] = api_key
        self._chat = ChatGroq(**kwargs)

    def generate(
        self,
        question: str,
        sources: list[tuple[int, Chunk]],
        system_state: str = "",
    ) -> str:
        source_block = "\n\n".join(
            f"[{n}] {c.doc_title} — {c.section} ({c.doc_type}, updated {c.updated})\n{c.text}"
            for n, c in sources
        )
        prompt = f"SOURCES:\n{source_block}\n\n"
        if system_state:
            prompt += f"LIVE SYSTEM STATE:\n{system_state}\n\n"
        prompt += f"QUESTION: {question}"
        result = self._chat.invoke(
            [("system", self._SYSTEM), ("human", prompt)]
        )
        return str(result.content)


def make_llm(kind: str, *, groq_model: str = "", groq_api_key: str = "") -> LLM:
    if kind == "extractive":
        return ExtractiveLLM()
    if kind == "groq":
        if not (groq_api_key or os.environ.get("GROQ_API_KEY")):
            print(
                "atlas: ATLAS_LLM=groq but no GROQ_API_KEY set — "
                "falling back to the extractive answerer",
                file=sys.stderr,
            )
            return ExtractiveLLM()
        return GroqLLM(groq_model, groq_api_key)
    raise ValueError(f"unknown llm: {kind!r} (expected extractive|groq)")
