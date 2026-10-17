"""Vision OCR for image-based PDF pages, using an OpenAI-compatible vision model (DeepSeek flash).

Results are cached in kb/ocr_cache/ and committed, so the knowledge base can be rebuilt
without calling the model again and an expert can review exactly what the model read.
"""
import base64
import os
import time
from pathlib import Path

import pymupdf
from dotenv import load_dotenv
from openai import OpenAI

KB_DIR = Path(__file__).resolve().parent
CACHE_DIR = KB_DIR / "ocr_cache"
load_dotenv(KB_DIR.parent / "backend" / ".env")

OCR_MODEL = os.environ.get("OCR_MODEL", "deepseek-flash")

PROMPTS = {
    "slide": (
        "This is one slide from a technical presentation about fiber-optic process spectroscopy.\n"
        "1. Transcribe all visible text verbatim (titles, labels, captions, legends, axis labels).\n"
        "2. List every numeric value with its unit and what it refers to (ranges, wavelengths, "
        "wavenumbers, lengths, temperatures).\n"
        "3. Describe each chart, photo or diagram factually: what it shows, axes and ranges.\n"
        "Only report what is visible. Do not add interpretation, background knowledge or guesses. "
        "Write unreadable text as [illegible]. Answer in plain Markdown."
    ),
    "figures": (
        "This is a page from a technical document. Its running text has already been extracted, "
        "so focus only on the figures, photos, diagrams and tables embedded as images.\n"
        "For each one: transcribe any text inside it, list numeric values with units, and describe "
        "factually what it shows (axes, ranges, labelled parts).\n"
        "Only report what is visible; no interpretation or background knowledge. If the page has no "
        "informative figure (only a logo or decoration), answer exactly: NO_INFORMATIVE_FIGURE. "
        "Answer in plain Markdown."
    ),
}


def _render_page(pdf_path: Path, page_no: int, dpi: int = 130) -> str:
    doc = pymupdf.open(pdf_path)
    pix = doc[page_no - 1].get_pixmap(dpi=dpi)
    return base64.b64encode(pix.tobytes("jpeg", jpg_quality=85)).decode()


def ocr_page(pdf_path: Path, source_id: str, page_no: int, mode: str) -> str:
    """Return the vision transcription of one page (1-based), using the cache when available."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{source_id}_p{page_no:02d}_{mode}.md"
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8")

    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url=os.environ["LLM_BASE_URL"])
    image_b64 = _render_page(pdf_path, page_no)
    # The model reasons before answering and the reasoning counts against max_tokens,
    # so the budget is generous and an empty or truncated answer is retried, never cached.
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=OCR_MODEL,
                temperature=0,
                max_tokens=16000,
                messages=[{"role": "user", "content": [
                    {"type": "text", "text": PROMPTS[mode]},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ]}],
            )
            choice = response.choices[0]
            text = (choice.message.content or "").strip()
            if not text or choice.finish_reason == "length":
                raise RuntimeError(f"{source_id} p.{page_no}: empty or truncated answer ({choice.finish_reason})")
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))

    cache_file.write_text(text, encoding="utf-8")
    return text
