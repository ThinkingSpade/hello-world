"""The debate protocol, as a LangGraph state machine.

    brief ──▶ openings ──▶ cross_examination ──▶ final_votes ──▶ moderate

Each agent node calls its own provider (a different frontier model per
seat). The output is a replay session in the exact format the demo player
consumes — run it live and you get a recording identical in shape to the
scripted samples, just real.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .models import Provider

# Two house rules shared by every seat: talk like a colleague, cite by name.
_HOUSE_STYLE = (
    " House style, two rules. One: talk like a colleague in a meeting, not a "
    "press release — first person, contractions, plain words. Two: cite your "
    "sources by name (a report, paper, dataset, or writeup someone could "
    "actually look up, e.g. 'per the 2018 Segment writeup'); never lean on a "
    "vague 'studies show'."
)

ROLES = {
    "optimist": (
        "You are The Optimist on a debate council. Argue the "
        "strongest good-faith case FOR the proposition: possibilities, "
        "trendlines, historical precedent for surprise. Stay honest — "
        "concede real obstacles rather than deny them." + _HOUSE_STYLE
    ),
    "skeptic": (
        "You are The Skeptic on a debate council. Argue the "
        "strongest good-faith case AGAINST the proposition: base rates, "
        "structural obstacles, ways the rosy story fails. Stay honest — "
        "concede strong evidence rather than dodge it." + _HOUSE_STYLE
    ),
    "fact-checker": (
        "You are The Fact-Checker on a debate council. Anchor "
        "the debate in verifiable, mainstream facts and numbers. Correct "
        "BOTH sides when they overreach. Prefer 'the data shows' to 'I feel'."
        + _HOUSE_STYLE
    ),
    "wildcard": (
        "You are The Wildcard on a debate council. Attack the question's "
        "frame itself: find the assumption everyone else silently shares and "
        "argue the position nobody at the table is covering. Contrarian, not "
        "contradictory — your hot takes carry named sources, and you concede "
        "good evidence when shown it." + _HOUSE_STYLE
    ),
}

RESEARCHER = (
    "You are The Researcher for a debate council. Before the seats argue, "
    "you circulate a neutral briefing dossier: the most decision-relevant, "
    "checkable facts and figures on the question, each tied to a named "
    "source (report, paper, dataset, or writeup someone could look up). "
    "Take NO position — your job is the evidence pool, not the verdict, and "
    "you flag where the evidence is thin or contested." + _HOUSE_STYLE
)

_CONF_RE = re.compile(r"CONFIDENCE:\s*(\d{1,3})")
_VOTE_RE = re.compile(r"VOTE:\s*([^\n.]+?)(?:\s+CONFIDENCE|$)", re.MULTILINE)

_STANCE_WORDS = [(-1, ("no", "unlikely", "against")), (1, ("yes", "likely", "for"))]


def parse_confidence(text: str, default: int = 50) -> int:
    m = _CONF_RE.search(text)
    return max(0, min(100, int(m.group(1)))) if m else default

def parse_vote(text: str) -> str:
    m = _VOTE_RE.search(text)
    return m.group(1).strip().lower() if m else "abstain"

def stance(vote: str) -> int:
    v = vote.lower()
    neg = any(w in v.split() or v.startswith(w) for _, ws in _STANCE_WORDS[:1] for w in ws)
    pos = any(w in v.split() or v.startswith(w) for _, ws in _STANCE_WORDS[1:] for w in ws)
    if neg and not pos:
        return -1
    if pos and not neg:
        return 1
    return 0


@dataclass
class Seat:
    id: str
    name: str
    role: str            # optimist | skeptic | fact-checker | wildcard
    color: str
    provider: Provider = field(repr=False, default=None)

    @property
    def role_title(self) -> str:
        return "The " + self.role.replace("-", " ").title().replace(" ", "-")


class DebateState(TypedDict, total=False):
    question: str
    brief: dict             # {text, think} — the researcher's shared dossier
    openings: dict          # seat id -> {text, confidence, think}
    rebuttals: list         # [{agent, target, text, think}]
    finals: dict            # seat id -> {text, confidence, vote, think}
    moderator: dict
    result: dict


def score_confidence(finals: dict, openings: dict) -> dict:
    """Disagreement → confidence. Three ingredients, all reported:
    - consensus: share of agent pairs whose final votes point the same way
    - mean self-confidence at the final round
    - convergence: how much the confidence spread narrowed since round 1
    """
    ids = list(finals)
    stances = {i: stance(finals[i]["vote"]) for i in ids}
    pairs = [(a, b) for k, a in enumerate(ids) for b in ids[k + 1:]]
    agree = sum(1 for a, b in pairs if stances[a] == stances[b])
    consensus = round(100 * agree / len(pairs)) if pairs else 100

    confs_final = [finals[i]["confidence"] for i in ids]
    mean_conf = round(sum(confs_final) / len(confs_final))

    spread_open = max(openings[i]["confidence"] for i in ids) - min(openings[i]["confidence"] for i in ids)
    spread_final = max(confs_final) - min(confs_final)
    convergence = round(100 * (spread_open - spread_final) / spread_open) if spread_open else 0
    conv_bonus = max(-50, min(50, convergence))

    final = round(0.45 * consensus + 0.45 * mean_conf + 0.10 * (50 + conv_bonus))
    final = max(1, min(99, final))
    leaning = [i for i in ids if stances[i] > 0]
    return {
        "confidence": final,
        "consensus": f"{len(leaning)} of {len(ids)} leaning yes",
        "votes": {i: finals[i]["vote"] for i in ids},
        "dissent_stances": stances,
        "how_scored": (
            f"consensus {consensus}% · mean self-confidence {mean_conf}% · "
            f"convergence {convergence:+d}% → {final}%"
        ),
    }


def build_graph(seats: list[Seat], moderator: Provider, researcher: Provider | None = None):
    researcher = researcher or moderator

    def brief(state: DebateState) -> DebateState:
        c = researcher.complete(
            RESEARCHER,
            f"Question under debate: {state['question']}\n\n"
            "Circulate the briefing dossier in 100-160 words: open with one "
            "casual line handing it to the room, then the 5-8 most "
            "decision-relevant facts, each with its named source inline. "
            "Close by flagging the thinnest part of the evidence. No position.",
        )
        return {"brief": {"text": c.text, "think": c.latency_ms}}

    def openings(state: DebateState) -> DebateState:
        out = {}
        for s in seats:
            c = s.provider.complete(
                ROLES[s.role],
                f"Question under debate: {state['question']}\n\n"
                "The Researcher circulated this briefing dossier — every seat "
                f"got the same copy:\n\n{state['brief']['text']}\n\n"
                "Give your opening position in 120-180 words. Draw on the "
                "dossier, dispute it, or bring your own sources. Then on its "
                "own line: CONFIDENCE: <0-100> (that the answer is yes).",
            )
            out[s.id] = {"text": c.text, "confidence": parse_confidence(c.text),
                         "think": c.latency_ms}
        return {"openings": out}

    def cross_examination(state: DebateState) -> DebateState:
        rebuttals = []
        for s in seats:
            rivals = [o for o in seats if o.id != s.id]
            others = "\n\n".join(
                f"{o.name} ({o.role_title}) said:\n{state['openings'][o.id]['text']}"
                for o in rivals
            )
            # rebut the seat you disagree with most, by opening confidence
            target = max(rivals, key=lambda o: abs(
                state["openings"][o.id]["confidence"]
                - state["openings"][s.id]["confidence"]))
            c = s.provider.complete(
                ROLES[s.role],
                f"Question: {state['question']}\n\nThe other agents argued:\n\n"
                f"{others}\n\nRebut the weakest claim you see in 60-120 words. "
                "Name whose claim you are attacking. Concede anything that is "
                "simply true.",
            )
            rebuttals.append({"agent": s.id, "target": target.id,
                              "text": c.text, "think": c.latency_ms})
        return {"rebuttals": rebuttals}

    def final_votes(state: DebateState) -> DebateState:
        transcript = "\n\n".join(r["text"] for r in state["rebuttals"])
        out = {}
        for s in seats:
            c = s.provider.complete(
                ROLES[s.role],
                f"Question: {state['question']}\n\nAfter cross-examination:\n"
                f"{transcript}\n\nGive your FINAL VOTE in 50-90 words, ending "
                "with two lines:\nVOTE: <yes|no|qualified yes|qualified no>\n"
                "CONFIDENCE: <0-100>",
            )
            out[s.id] = {"text": c.text, "confidence": parse_confidence(c.text),
                         "vote": parse_vote(c.text), "think": c.latency_ms}
        return {"finals": out}

    def moderate(state: DebateState) -> DebateState:
        packed = "\n\n".join(
            f"{s.name} finally said ({state['finals'][s.id]['vote']}, "
            f"{state['finals'][s.id]['confidence']}%): {state['finals'][s.id]['text']}"
            for s in seats
        )
        c = moderator.complete(
            "You are The Moderator of a debate council. Synthesize a final "
            "answer from the agents' positions. Be faithful to the balance "
            "of argument; name the unresolved crux explicitly.",
            f"Question: {state['question']}\n\n{packed}\n\n"
            "Write a 100-150 word synthesis, then on its own line: "
            "ANSWER: <2-sentence verdict>",
        )
        scored = score_confidence(state["finals"], state["openings"])
        answer_match = re.search(r"ANSWER:\s*(.+)", c.text, re.S)
        return {
            "moderator": {"text": c.text, "think": c.latency_ms},
            "result": {
                "answer": (answer_match.group(1).strip() if answer_match else c.text[-300:]),
                **scored,
            },
        }

    g = StateGraph(DebateState)
    g.add_node("brief", brief)
    g.add_node("openings", openings)
    g.add_node("cross_examination", cross_examination)
    g.add_node("final_votes", final_votes)
    g.add_node("moderate", moderate)
    g.add_edge(START, "brief")
    g.add_edge("brief", "openings")
    g.add_edge("openings", "cross_examination")
    g.add_edge("cross_examination", "final_votes")
    g.add_edge("final_votes", "moderate")
    g.add_edge("moderate", END)
    return g.compile()


def run_debate(question: str, seats: list[Seat], moderator: Provider,
               researcher: Provider | None = None) -> dict:
    graph = build_graph(seats, moderator, researcher)
    state = graph.invoke({"question": question})
    finals, openings = state["finals"], state["openings"]
    session = {
        "question": question,
        "recorded": "live",
        "topic_tag": "",
        "agents": [{"id": s.id, "name": s.name, "role": s.role_title, "color": s.color}
                   for s in seats],
        "rounds": [
            {"phase": "The briefing", "events": [
                {"agent": "scout", "think": state["brief"]["think"],
                 "text": state["brief"]["text"]}]},
            {"phase": "Opening positions", "events": [
                {"agent": s.id, "think": openings[s.id]["think"],
                 "confidence": openings[s.id]["confidence"],
                 "text": openings[s.id]["text"]} for s in seats]},
            {"phase": "Cross-examination", "events": [
                {"agent": r["agent"], "target": r["target"], "think": r["think"],
                 "text": r["text"]} for r in state["rebuttals"]]},
            {"phase": "Final votes", "events": [
                {"agent": s.id, "think": finals[s.id]["think"],
                 "confidence": finals[s.id]["confidence"],
                 "vote": finals[s.id]["vote"],
                 "text": finals[s.id]["text"]} for s in seats]},
        ],
        "moderator": {"name": "The Moderator", **state["moderator"]},
        "result": {
            **{k: v for k, v in state["result"].items() if k != "dissent_stances"},
            "confidence_by_round": {
                s.id: [openings[s.id]["confidence"], finals[s.id]["confidence"],
                       finals[s.id]["confidence"]] for s in seats},
            "dissent": "See moderator synthesis for the unresolved crux.",
        },
    }
    return session
