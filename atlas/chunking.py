"""Markdown → retrievable chunks.

Sections are split on headings (LangChain's MarkdownHeaderTextSplitter), then
long sections are sliced further with RecursiveCharacterTextSplitter. Chunk
ids are stable across runs so cached answers and citations stay valid.
"""

from __future__ import annotations

import re

from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)

from .schema import Chunk, DocMeta

_HEADERS = [("#", "h1"), ("##", "h2"), ("###", "h3")]

_section_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=_HEADERS, strip_headers=False
)
_size_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1200, chunk_overlap=150, separators=["\n\n", "\n", ". ", " "]
)


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "section"


def chunk_document(doc: DocMeta, body: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    sections = _section_splitter.split_text(body)
    if not sections:
        return chunks
    seq = 0  # unique within the doc even when two sections share a heading
    for section_doc in sections:
        meta = section_doc.metadata
        section_name = meta.get("h3") or meta.get("h2") or meta.get("h1") or doc.title
        pieces = _size_splitter.split_text(section_doc.page_content)
        slug = slugify(section_name)
        for piece in pieces:
            text = piece.strip()
            if len(text) < 40:  # skip heading-only fragments
                continue
            seq += 1
            chunks.append(
                Chunk(
                    id=f"{doc.id}::{slug}::{seq}",
                    doc_id=doc.id,
                    doc_title=doc.title,
                    doc_type=doc.type,
                    section=section_name,
                    text=text,
                    source_path=doc.source_path,
                    updated=doc.updated,
                    format=doc.format,
                    media=doc.media,
                )
            )
    return chunks


def chunk_corpus(docs: list[tuple[DocMeta, str]]) -> list[Chunk]:
    out: list[Chunk] = []
    for doc, body in docs:
        out.extend(chunk_document(doc, body))
    return out
