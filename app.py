import os
from typing import Dict, List

import streamlit as st
from dotenv import load_dotenv

from cloudflare_client import CloudflareAgentClient


load_dotenv()

st.set_page_config(page_title="FUJA Cloudflare AI Search", page_icon="🔎", layout="wide")
st.title("🔎 FUJA Cloudflare AI Search")
st.caption("Streamlit frontend connected to your Cloudflare AI Search / RAG agent")

client = CloudflareAgentClient()
is_valid, message = client.validate_config()

with st.sidebar:
    st.header("Connection")
    st.write(f"Endpoint: `{os.getenv('CLOUDFLARE_AGENT_URL', '') or 'Not set'}`")
    st.write(f"Auth header: `{os.getenv('CLOUDFLARE_AUTH_HEADER', 'Authorization')}`")
    if is_valid:
        st.success(message)
    else:
        st.error(message)
    st.markdown(
        "Set values in `.env` (see `.env.example`) and restart the app if config changes."
    )

if "messages" not in st.session_state:
    st.session_state.messages = []


def to_history(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return [{"role": m["role"], "content": m["content"]} for m in messages]


for m in st.session_state.messages:
    with st.chat_message(m["role"]):
        st.markdown(m["content"])
        if m.get("sources"):
            with st.expander("Sources"):
                for idx, source in enumerate(m["sources"], start=1):
                    st.write(f"{idx}. {source}")


prompt = st.chat_input("Ask anything from your indexed knowledge base...")
if prompt:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    if not is_valid:
        with st.chat_message("assistant"):
            st.error("Cloudflare config is missing. Update `.env` and retry.")
    else:
        with st.chat_message("assistant"):
            with st.spinner("Thinking..."):
                try:
                    result = client.ask(prompt, chat_history=to_history(st.session_state.messages))
                    answer = result["answer"] or "No answer returned by Cloudflare endpoint."
                    sources = result.get("sources", [])
                    st.markdown(answer)
                    if sources:
                        with st.expander("Sources"):
                            for idx, source in enumerate(sources, start=1):
                                st.write(f"{idx}. {source}")
                    st.session_state.messages.append(
                        {"role": "assistant", "content": answer, "sources": sources}
                    )
                except Exception as exc:
                    st.error(f"Request failed: {exc}")
