"""Provider adapters — one thin `complete()` per vendor, lazy imports so the
package installs without any SDK, and a deterministic MockProvider so the
whole debate protocol is testable (and demoable) without spending a token.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from typing import Protocol


@dataclass
class Completion:
    text: str
    latency_ms: int


class Provider(Protocol):
    name: str
    model: str

    def complete(self, system: str, prompt: str) -> Completion: ...


def _timed(fn):
    start = time.perf_counter()
    text = fn()
    return Completion(text=text.strip(), latency_ms=int((time.perf_counter() - start) * 1000))


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, model: str = "claude-opus-4-8"):
        import anthropic  # lazy: only needed when actually used

        self.model = model
        self._client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

    def complete(self, system: str, prompt: str) -> Completion:
        return _timed(lambda: self._client.messages.create(
            model=self.model, max_tokens=1024, system=system,
            messages=[{"role": "user", "content": prompt}],
        ).content[0].text)


class OpenAIProvider:
    name = "openai"

    def __init__(self, model: str = "gpt-5.5"):
        import openai

        self.model = model
        self._client = openai.OpenAI()  # reads OPENAI_API_KEY

    def complete(self, system: str, prompt: str) -> Completion:
        return _timed(lambda: self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": prompt}],
        ).choices[0].message.content)


class GroqProvider:
    name = "groq"

    def __init__(self, model: str = "llama-3.3-70b-versatile"):
        import groq

        self.model = model
        self._client = groq.Groq()  # reads GROQ_API_KEY

    def complete(self, system: str, prompt: str) -> Completion:
        return _timed(lambda: self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": prompt}],
        ).choices[0].message.content)


class GeminiProvider:
    name = "gemini"

    def __init__(self, model: str = "gemini-3.1-pro"):
        from google import genai

        self.model = model
        self._client = genai.Client()  # reads GEMINI_API_KEY

    def complete(self, system: str, prompt: str) -> Completion:
        return _timed(lambda: self._client.models.generate_content(
            model=self.model, contents=f"{system}\n\n{prompt}"
        ).text)


class XAIProvider:
    """Grok. xAI's API is OpenAI-compatible, so this rides the openai SDK
    pointed at api.x.ai — no extra package needed."""

    name = "xai"

    def __init__(self, model: str = "grok-4-1"):
        import openai

        self.model = model
        self._client = openai.OpenAI(
            base_url="https://api.x.ai/v1",
            api_key=os.environ.get("XAI_API_KEY"),
        )

    def complete(self, system: str, prompt: str) -> Completion:
        return _timed(lambda: self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": prompt}],
        ).choices[0].message.content)


class MockProvider:
    """Deterministic stand-in: same inputs → same outputs, parseable votes.
    Lets tests (and keyless dev) exercise the full protocol for free."""

    name = "mock"

    def __init__(self, model: str = "mock-1", stance: int = 0):
        self.model = model
        self.stance = stance  # -1 skeptical, 0 neutral, +1 optimistic

    def complete(self, system: str, prompt: str) -> Completion:
        seed = int(hashlib.sha256((self.model + prompt[:200]).encode()).hexdigest()[:8], 16)
        conf = 35 + (seed % 31) + self.stance * 15
        conf = max(5, min(95, conf))
        if "Researcher" in system:
            text = ("Morning, everyone — dossier's circulated, same copy for "
                    "every seat. Fact A (Mock Journal, 2024); fact B (Mock "
                    "Institute survey, 2023); fact C (mock dataset v2). "
                    "Thinnest part of the evidence: fact C, single source.")
        elif "FINAL VOTE" in prompt:
            vote = {1: "yes", 0: "qualified yes", -1: "no"}[self.stance]
            text = (f"Weighing the exchange, my position holds. "
                    f"VOTE: {vote} CONFIDENCE: {conf}")
        elif "CONFIDENCE" in prompt:
            text = (f"[{self.model}] position on the question, argued from my brief. "
                    f"Key claim A; key claim B. CONFIDENCE: {conf}")
        else:
            text = f"[{self.model}] rebuttal: the strongest opposing claim overreaches because of X."
        return Completion(text=text, latency_ms=40 + seed % 200)


PROVIDERS = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "groq": GroqProvider,
    "gemini": GeminiProvider,
    "xai": XAIProvider,
    "mock": MockProvider,
}


def available_keys() -> dict[str, bool]:
    return {
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "openai": bool(os.environ.get("OPENAI_API_KEY")),
        "groq": bool(os.environ.get("GROQ_API_KEY")),
        "gemini": bool(os.environ.get("GEMINI_API_KEY")),
        "xai": bool(os.environ.get("XAI_API_KEY")),
    }
