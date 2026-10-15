FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LIBREOFFICE_PATH=/usr/bin/soffice

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 lumio
COPY --chown=lumio:lumio app ./app
COPY --chown=lumio:lumio database ./database
USER lumio

EXPOSE 10000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
