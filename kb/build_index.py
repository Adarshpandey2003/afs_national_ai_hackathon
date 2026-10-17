"""Build the hybrid retrieval index (FAISS dense vectors; BM25 is rebuilt in memory at load time).

Usage (from the repo root, with the backend venv):
    python kb/build_index.py                       # build kb/index/
    python kb/build_index.py --query "silica fiber mid infrared"   # build, then run a test search
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from afs.retrieval import INDEX_DIR, HybridRetriever, KnowledgeBase, build_index  # noqa: E402


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--query", action="append", default=[], help="test query (repeatable)")
    parser.add_argument("-k", type=int, default=5)
    args = parser.parse_args()

    kb = KnowledgeBase()
    print(f"indexed {build_index(kb)} chunks -> {INDEX_DIR}")

    if args.query:
        retriever = HybridRetriever(kb)
        for q in args.query:
            print(f"\n> {q}")
            for hit in retriever.search(q, k=args.k):
                preview = hit["text"][:110].replace("\n", " ")
                print(f"  {hit['label']:<9} rrf={hit['score']:.4f} dense#{hit['dense_rank']} "
                      f"bm25#{hit['bm25_rank']}  {preview}")


if __name__ == "__main__":
    main()
