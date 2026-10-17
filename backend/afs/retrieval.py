"""Knowledge base access and hybrid (dense + BM25) retrieval over page-bounded chunks.

The dense side uses a small local embedding model (fastembed, ONNX on CPU), so no embeddings API
is needed. Dense and BM25 rankings are merged with reciprocal rank fusion (RRF).
"""
import json
import os
import re
from functools import lru_cache
from pathlib import Path

import faiss
import numpy as np
from rank_bm25 import BM25Okapi

KB_DIR = Path(os.environ.get("AFS_KB_DIR", Path(__file__).resolve().parents[2] / "kb"))
INDEX_DIR = KB_DIR / "index"
EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5")


def _read_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9µ]+", text.lower())


def embedding_text(chunk: dict) -> str:
    return f"{chunk['label']}: {chunk['text']}"


class KnowledgeBase:
    """Read-only view of the files produced by kb/build_kb.py."""

    def __init__(self, kb_dir: Path = KB_DIR):
        self.dir = kb_dir
        self.sources = {s["source_id"]: s for s in _read_json(kb_dir / "sources.json")}
        self.pages = {(p["source"], p["page"]): p for p in _read_jsonl(kb_dir / "pages.jsonl")}
        self.chunks = _read_jsonl(kb_dir / "chunks.jsonl")
        self.methods = _read_json(kb_dir / "methods.json")
        self.fibers = _read_json(kb_dir / "fibers.json")
        self.cases = _read_json(kb_dir / "cases.json")

    def get_page(self, source: str, page: int) -> dict | None:
        return self.pages.get((source.upper(), int(page)))

    def reference_doc(self, name: str) -> str:
        return (self.dir / "reference" / f"{name}.md").read_text(encoding="utf-8")


class _Embedder:
    def __init__(self, model_name: str = EMBED_MODEL):
        from fastembed import TextEmbedding
        self.model = TextEmbedding(model_name=model_name)

    def passages(self, texts: list[str]) -> np.ndarray:
        return self._normalise(np.array(list(self.model.passage_embed(texts)), dtype="float32"))

    def query(self, text: str) -> np.ndarray:
        return self._normalise(np.array(list(self.model.query_embed([text])), dtype="float32"))

    @staticmethod
    def _normalise(vectors: np.ndarray) -> np.ndarray:
        faiss.normalize_L2(vectors)
        return vectors


def build_index(kb: KnowledgeBase, index_dir: Path = INDEX_DIR) -> int:
    """Embed every chunk and write a cosine-similarity FAISS index plus the chunk order."""
    index_dir.mkdir(parents=True, exist_ok=True)
    vectors = _Embedder().passages([embedding_text(c) for c in kb.chunks])
    index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)
    faiss.write_index(index, str(index_dir / "chunks.faiss"))
    meta = {"embed_model": EMBED_MODEL, "chunk_ids": [c["chunk_id"] for c in kb.chunks]}
    (index_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return index.ntotal


def add_to_index(chunks: list[dict], index_dir: Path = INDEX_DIR) -> int:
    """Embed only the new chunks and append them to the existing index (incremental; no full rebuild)."""
    meta = _read_json(index_dir / "meta.json")
    index = faiss.read_index(str(index_dir / "chunks.faiss"))
    index.add(_Embedder(meta["embed_model"]).passages([embedding_text(c) for c in chunks]))
    faiss.write_index(index, str(index_dir / "chunks.faiss"))
    meta["chunk_ids"] += [c["chunk_id"] for c in chunks]
    (index_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return index.ntotal


class HybridRetriever:
    def __init__(self, kb: KnowledgeBase, index_dir: Path = INDEX_DIR):
        meta = _read_json(index_dir / "meta.json")
        by_id = {c["chunk_id"]: c for c in kb.chunks}
        missing = [cid for cid in meta["chunk_ids"] if cid not in by_id]
        if missing or len(meta["chunk_ids"]) != len(kb.chunks):
            raise RuntimeError("kb/index is out of date with kb/chunks.jsonl; run kb/build_index.py")
        self.chunks = [by_id[cid] for cid in meta["chunk_ids"]]
        self.index = faiss.read_index(str(index_dir / "chunks.faiss"))
        self.embedder = _Embedder(meta["embed_model"])
        self.bm25 = BM25Okapi([tokenize(embedding_text(c)) for c in self.chunks])

    def search(self, query: str, k: int = 6, sources: list[str] | None = None,
               candidates: int = 30, rrf_k: int = 60) -> list[dict]:
        """Top-k chunks by reciprocal rank fusion of dense and BM25 rankings."""
        allowed = {s.upper() for s in sources} if sources else None

        _, dense_ids = self.index.search(self.embedder.query(query), min(candidates, len(self.chunks)))
        dense_rank = [int(i) for i in dense_ids[0] if i >= 0]
        bm25_scores = self.bm25.get_scores(tokenize(query))
        bm25_rank = [int(i) for i in np.argsort(-bm25_scores)[:candidates] if bm25_scores[i] > 0]

        fused = {}
        for ranking, name in ((dense_rank, "dense"), (bm25_rank, "bm25")):
            for rank, idx in enumerate(ranking):
                if allowed and self.chunks[idx]["source"] not in allowed:
                    continue
                entry = fused.setdefault(idx, {"score": 0.0, "dense_rank": None, "bm25_rank": None})
                entry["score"] += 1.0 / (rrf_k + rank + 1)
                entry[f"{name}_rank"] = rank + 1

        best = sorted(fused.items(), key=lambda kv: -kv[1]["score"])[:k]
        return [{**self.chunks[idx], "score": round(info["score"], 5),
                 "dense_rank": info["dense_rank"], "bm25_rank": info["bm25_rank"]}
                for idx, info in best]


@lru_cache(maxsize=1)
def get_kb() -> KnowledgeBase:
    return KnowledgeBase()


@lru_cache(maxsize=1)
def get_retriever() -> HybridRetriever:
    return HybridRetriever(get_kb())


def reload_kb() -> None:
    """Drop the cached knowledge base and retriever so the next request loads newly added documents."""
    get_kb.cache_clear()
    get_retriever.cache_clear()
