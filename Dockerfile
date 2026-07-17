FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY atlas/ atlas/
RUN pip install --no-cache-dir ".[prod]"

COPY corpus/ corpus/
COPY ops/ ops/

EXPOSE 8300
CMD ["python", "-m", "atlas", "serve", "--host", "0.0.0.0", "--port", "8300"]
