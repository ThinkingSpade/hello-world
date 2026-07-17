"""Optional LLM diagnosers. The extractive signature matcher is the floor
and the fallback; with a key, a model writes the plain-English cause on
top of the same hard evidence — but proposals still come from the vetted
signature templates, because 'creative' is not a word you want anywhere
near a kubectl command.
"""

from __future__ import annotations

import os

from .signatures import ExtractiveDiagnoser

_PROMPT = (
    "You are Helmsman, a Kubernetes incident copilot. From the evidence "
    "bundle below (kubectl get/describe/logs/events), explain the most "
    "likely root cause in 3-4 plain-English sentences a tired on-call "
    "engineer will thank you for. Quote the decisive evidence lines. Do "
    "NOT propose commands — the fix comes from vetted templates.\n\n"
    "EVIDENCE:\n{bundle}"
)


class LLMDiagnoser:
    """Wraps extractive: signature match still decides WHICH failure this is
    (and the proposal); the model only rewrites the cause narrative."""

    def __init__(self, provider: str = "anthropic"):
        self.provider = provider
        self.extractive = ExtractiveDiagnoser()

    def _complete(self, prompt: str) -> str | None:
        try:
            if self.provider == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
                import anthropic
                r = anthropic.Anthropic().messages.create(
                    model="claude-opus-4-8", max_tokens=500,
                    messages=[{"role": "user", "content": prompt}])
                return r.content[0].text
            if self.provider == "openai" and os.environ.get("OPENAI_API_KEY"):
                import openai
                r = openai.OpenAI().chat.completions.create(
                    model="gpt-5.5",
                    messages=[{"role": "user", "content": prompt}])
                return r.choices[0].message.content
        except Exception:
            return None   # any provider hiccup → extractive text stands
        return None

    def diagnose(self, namespace: str, bundle: str):
        found = self.extractive.diagnose(namespace, bundle)
        if not found:
            return None
        diag, prop = found
        text = self._complete(_PROMPT.format(bundle=bundle[-6000:]))
        if text:
            diag.cause = text.strip()
        return diag, prop
