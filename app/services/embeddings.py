"""Local text embeddings for the RAG pipeline.

Embedding generation is deliberately kept *separate* from LLM text generation:
an LLM API key is never assumed to provide an embedding model, and no text is
ever sent to an external service to be embedded.

The default backend is a fully local feature-hashing embedder. It tokenises
text into word unigrams, word bigrams and character 4-grams, applies sublinear
term-frequency weighting and L2-normalises the result. That gives a fixed-size
vector with meaningful cosine similarity for related passages, and it needs no
model download and no network — indexing and retrieval work completely offline.

If ``sentence-transformers`` is installed and ``EMBEDDING_BACKEND`` is set to
``sentence-transformers``, a real local transformer model is used instead (still
no API key, still fully on-device). The code degrades back to hashing if the
package or model is missing so the pipeline never hard-fails.
"""

from __future__ import annotations

import hashlib
import math
import re
from functools import lru_cache

from app.core.config import settings

_WORD_RE = re.compile(r"[a-z0-9]+")

# Common English words carry little retrieval signal; dropping them keeps the
# hashing vectors focused on content words.
_STOPWORDS = frozenset(
    """a an the and or but if then than that this these those of to in on at
    for from by with without as is are was were be been being it its we
    you they he she i do does did not no can could should would will shall may
    might must have has had having there here what which who whom whose when
    where why how all any both each few more most other some such only own same
    so too very just also into over under again further once about above below
    up down out off between during before after because while your our their my
    me us them him her""".split()
)


STOPWORDS = _STOPWORDS


def _tokens(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def salient_terms(text: str, limit: int = 8) -> list[str]:
    """The most frequent content words in ``text`` (grounded, no invention).

    Used to label generated notes with topics that literally appear in the
    source. Deterministic ordering (count desc, then alphabetical) so the same
    source always yields the same topics.
    """
    counts: dict[str, int] = {}
    for word in _tokens(text):
        if len(word) < 4 or word in _STOPWORDS or word.isdigit():
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [word for word, _count in ranked[:limit]]


def _features(text: str) -> dict[str, float]:
    """Weighted features for one document (higher weight = more signal)."""
    words = _tokens(text)
    features: dict[str, float] = {}
    for word in words:
        if word not in _STOPWORDS and len(word) > 1:
            key = f"w:{word}"
            features[key] = features.get(key, 0.0) + 1.0
    for first, second in zip(words, words[1:]):
        if first not in _STOPWORDS and second not in _STOPWORDS:
            key = f"b:{first} {second}"
            features[key] = features.get(key, 0.0) + 0.7
    for word in words:
        if len(word) >= 5:
            for start in range(len(word) - 3):
                key = f"c:{word[start:start + 4]}"
                features[key] = features.get(key, 0.0) + 0.3
    return features


def _hash_index(token: str, dim: int) -> int:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % dim


def _normalise(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if not norm:
        return vector
    return [value / norm for value in vector]


class _HashingEmbedder:
    """Deterministic, dependency-light local embedder."""

    def __init__(self, dim: int) -> None:
        self.dim = max(32, dim)
        self.model_name = f"hashing-{self.dim}"

    def embed(self, text: str) -> list[float]:
        counts: dict[int, float] = {}
        for token, weight in _features(text).items():
            position = _hash_index(token, self.dim)
            counts[position] = counts.get(position, 0.0) + weight

        vector = [0.0] * self.dim
        for position, weight in counts.items():
            # Sublinear term frequency, then L2 normalise.
            vector[position] = 1.0 + math.log(weight) if weight > 0 else 0.0
        return _normalise(vector)


class _SentenceTransformerEmbedder:
    """Optional real local model (no API key, runs on this machine)."""

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415

        self._model = SentenceTransformer(model_name)
        self.model_name = model_name

    def embed(self, text: str) -> list[float]:
        vector = self._model.encode(text, normalize_embeddings=True)
        return [float(value) for value in vector]


@lru_cache(maxsize=1)
def _embedder():
    """Build (once) the configured embedder, falling back to hashing."""
    backend = (settings.EMBEDDING_BACKEND or "hashing").strip().lower()
    if backend in {"sentence-transformers", "sentence_transformers", "st"}:
        try:
            return _SentenceTransformerEmbedder(settings.SENTENCE_TRANSFORMERS_MODEL)
        except Exception:  # noqa: BLE001 - fall back to the local hashing model
            pass
    return _HashingEmbedder(settings.EMBEDDING_DIM)


def embedding_model_name() -> str:
    """The name recorded alongside every stored vector (provenance)."""
    return _embedder().model_name


def embed_text(text: str) -> list[float]:
    """Embed a single piece of text (query or document)."""
    return _embedder().embed(text or "")


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed many documents at once."""
    embedder = _embedder()
    return [embedder.embed(text or "") for text in texts]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Cosine similarity of two vectors (0.0 when either has no magnitude).

    Documents are stored L2-normalised, but this never assumes it: the dot
    product is divided by both magnitudes so an arbitrary stored vector is safe.
    """
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for i in range(size):
        a = float(left[i])
        b = float(right[i])
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if left_norm <= 0.0 or right_norm <= 0.0:
        return 0.0
    return dot / math.sqrt(left_norm * right_norm)
