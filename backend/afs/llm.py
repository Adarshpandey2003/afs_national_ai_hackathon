"""DeepSeek chat models (OpenAI-compatible API) and a JSON-mode helper validated against Pydantic schemas."""
import json
import os
import re
from typing import TypeVar

from langchain_openai import ChatOpenAI
from openai import LengthFinishReasonError
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


def main_model() -> str:
    return os.environ.get("LLM_MODEL", "deepseek-v4-pro")


def fast_model() -> str:
    """Used for the clarifier and the research tool loop, where latency matters more than depth."""
    return os.environ.get("FAST_LLM_MODEL", "deepseek-flash")


def writer_model(mode: str) -> str:
    """The writer's model: the strongest for batch outputs; a faster one when a user is waiting (interactive).
    Measured on H03/H04/H06: flash writes about 2.5x faster, with somewhat less disciplined method selection."""
    return os.environ.get("INTERACTIVE_WRITER_MODEL", fast_model()) if mode == "interactive" else main_model()


def chat(model: str | None = None, thinking: bool = True, temperature: float = 0.2,
         max_tokens: int = 16000) -> ChatOpenAI:
    # DeepSeek models reason before answering and the reasoning counts against max_tokens,
    # so the budget must be generous or the visible answer comes back empty.
    # thinking=False skips the reasoning phase: about 4x faster, less careful.
    return ChatOpenAI(
        model=model or main_model(),
        api_key=os.environ["DEEPSEEK_API_KEY"],
        base_url=os.environ.get("LLM_BASE_URL", "https://api.deepseek.com"),
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=600,
        max_retries=2,
        extra_body=None if thinking else {"thinking": {"type": "disabled"}},
    )


def ask_json(system: str, user: str, schema: type[T], model: str | None = None, thinking: bool = True,
             retries: int = 2, json_schema: dict | None = None) -> T:
    """One JSON-mode call; the reply is validated against `schema` and repaired by the model on failure.
    `json_schema` overrides the schema shown to the model (e.g. a more compact form that `schema` also accepts)."""
    llm = chat(model, thinking).bind(response_format={"type": "json_object"})
    messages = [
        ("system", f"{system}\n\nReply with a single JSON object that validates against this JSON schema:\n"
                   f"{json.dumps(json_schema or schema.model_json_schema(), ensure_ascii=False)}"),
        ("user", user),
    ]
    for attempt in range(retries + 1):
        try:
            reply = llm.invoke(messages)
        except LengthFinishReasonError:  # reply cut off at the output limit (8192 tokens without reasoning)
            if attempt == retries:
                raise
            messages.append(("user", "Your reply was cut off at the length limit. Return a shorter, complete JSON "
                                     "object: fewer items and one sentence per item."))
            continue
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (reply.content or "").strip())
        try:
            return schema.model_validate_json(text)
        except ValidationError as exc:  # also raised for invalid or empty JSON
            if attempt == retries:
                raise
            messages += [("assistant", reply.content or ""),
                         ("user", f"That JSON is invalid:\n{exc}\nReturn the complete corrected JSON object only.")]
