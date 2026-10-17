import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

load_dotenv()
llm = ChatOpenAI(model=os.environ["LLM_MODEL"], api_key=os.environ["DEEPSEEK_API_KEY"],
                 base_url=os.environ["LLM_BASE_URL"], temperature=0)

print("1) plain:", llm.invoke("Reply with OK").content)


@tool
def fiber_range(fiber: str) -> str:
    """Return the transmission range of a fiber family."""
    return "350-2400 nm"


msg = llm.bind_tools([fiber_range]).invoke("What range does a Vis-NIR silica fiber transmit? Use the tool.")
print("2) tool calls:", msg.tool_calls)

js = llm.bind(response_format={"type": "json_object"}).invoke("Return JSON with key status = ok")
print("3) json:", js.content)
