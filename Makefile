.PHONY: demo serve test up down ingest

# Zero-dependency demo: in-memory store, local embeddings, extractive answers.
demo:
	python -m atlas serve

serve: demo

test:
	python -m pytest

ingest:
	python -m atlas ingest

# Full production stack: pgvector + Redis + fastembed + Groq (needs .env).
up:
	docker compose up --build -d

down:
	docker compose down
