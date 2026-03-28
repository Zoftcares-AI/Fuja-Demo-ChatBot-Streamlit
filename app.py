import os
import re
import time
from typing import Dict, List

import streamlit as st
from dotenv import load_dotenv

from cloudflare_client import CloudflareAgentClient

load_dotenv()

st.set_page_config(
    page_title="FUJA Assistant",
    page_icon="✦",
    layout="centered",
    initial_sidebar_state="collapsed",
    menu_items={"Get help": None, "Report a bug": None, "About": None},
)

st.markdown(
    """
    <style>
    [data-testid="stSidebar"] { display: none !important; }
    [data-testid="collapsedControl"] { display: none !important; }
    .block-container { padding-top: 0.9rem; padding-bottom: 1.8rem; max-width: 48rem; }
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    header[data-testid="stHeader"] { background: transparent; }
    .fuja-header {
        margin-bottom: 0.95rem;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        background: #f9fafb;
        padding: 1rem 1.1rem;
    }
    .fuja-header-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.8rem;
    }
    .fuja-head-copy { min-width: 0; }
    .fuja-title {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 1.12rem;
        font-weight: 620;
        letter-spacing: -0.01em;
        color: #111827;
        margin: 0;
    }
    .fuja-subtitle {
        margin: 0.22rem 0 0 0;
        color: #6b7280;
        font-size: 0.87rem;
    }
    .fuja-status {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        color: #374151;
        font-size: 0.92rem;
        white-space: nowrap;
    }
    .fuja-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: #10b981;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
    }
    .fuja-dot.offline {
        background: #ef4444;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
    }
    div[data-testid="stChatMessage"] {
        background-color: #f8fafc;
        border: 1px solid #edf2f7;
        border-radius: 12px;
        padding: 0.75rem 0.95rem;
        margin-bottom: 0.75rem;
    }
    .ref-card {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 0.5rem 0.65rem;
        margin: 0.4rem 0;
        background: #ffffff;
        font-size: 0.84rem;
        color: #374151;
    }
    div[data-testid="stChatMessage"] ul, div[data-testid="stChatMessage"] ol {
        margin: 0.35rem 0 0.5rem 0;
        padding-left: 1.25rem;
    }
    div[data-testid="stChatMessage"] li { margin: 0.25rem 0; line-height: 1.45; }
    div[data-testid="stChatMessage"] li > ul, div[data-testid="stChatMessage"] li > ol {
        margin-top: 0.25rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

client = CloudflareAgentClient()
is_valid, _ = client.validate_config()

if "stream_speed" not in st.session_state:
    st.session_state.stream_speed = "Normal"

status_dot_class = "fuja-dot" if is_valid else "fuja-dot offline"
status_label = "Connected" if is_valid else "Config needed"
header_l, header_r = st.columns([0.72, 0.28], vertical_alignment="bottom")
with header_l:
    st.markdown(
        f"""
        <div class="fuja-header">
            <div class="fuja-header-inner">
                <div class="fuja-head-copy">
                    <p class="fuja-title">FUJAA AVIATION ACADEMY AI ASSISTANT</p>
                    <p class="fuja-subtitle">Official information about our programs and services</p>
                </div>
                <div class="fuja-status"><span class="{status_dot_class}"></span>{status_label}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
with header_r:
    st.selectbox(
        "Stream speed",
        options=["Fast", "Normal", "Slow"],
        key="stream_speed",
        label_visibility="visible",
    )

if not is_valid:
    st.warning(
        "Configuration incomplete. Set `CLOUDFLARE_AGENT_URL` and `CLOUDFLARE_API_TOKEN` in `.env`, then restart the app.",
        icon="⚠️",
    )

if "messages" not in st.session_state:
    st.session_state.messages = []


def to_history(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return [{"role": m["role"], "content": m["content"]} for m in messages]


def render_sources(sources: List[str]) -> None:
    with st.expander("References", expanded=False):
        for source in sources:
            st.markdown(f"<div class='ref-card'>{source}</div>", unsafe_allow_html=True)


def format_assistant_markdown(text: str) -> str:
    """Turn model text that crams * / - list markers into valid Markdown lists."""
    if not text or not str(text).strip():
        return text or ""
    t = str(text).strip()
    # "including: * **Item**" -> blank line before first bullet
    t = re.sub(r"([:：])\s+\*\s+", r"\1\n\n* ", t)
    # "text * **Next section**" -> new top-level bullet (bold headings)
    t = re.sub(r"(?<!\n)\s+\*\s+(\*\*)", r"\n\n* \1", t)
    # Sub-bullets after a bold heading line: ":** - Pilot"
    t = re.sub(r"(\*\*[^*]+\*\*:[^\n]*?)\s+-\s+", r"\1\n  - ", t)
    t = re.sub(r"(?<!\n)\s+-\s+(?=\*\*|[A-Za-z(])", r"\n  - ", t)
    # Closing paragraph stuck to list: ") They offer" / "). Something"
    t = re.sub(r"\)\s+([A-Z])", r")\n\n\1", t)
    t = re.sub(r"([.!?])\s+([A-Z][a-z]+\s+(offer|also|additionally|finally)\b)", r"\1\n\n\2", t)
    # Separate LLM follow-ups from the main answer (ChatGPT-style section break)
    t = re.sub(
        r"(?i)(?<!\n---\n)\n*\s*(\*\*?\s*You might also ask\s*\*?\s*:?)",
        r"\n\n---\n\n\1",
        t,
    )
    t = re.sub(
        r"(?i)(?<!\n---\n)\n*\s*(\*\*?\s*Related questions\s*\*?\s*:?)",
        r"\n\n---\n\n\1",
        t,
    )
    # Collapse excessive blank lines
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def stream_markdown_reveal(container, text: str, speed: str) -> None:
    """Reveal markdown in small chunks so Normal/Slow feel visibly different."""
    if not text:
        container.markdown("")
        return
    if speed == "Fast":
        container.markdown(text)
        return
    # Line-only streaming felt instant for short answers (often 1 line).
    if speed == "Slow":
        chunk_size, delay = 3, 0.055
    else:
        chunk_size, delay = 10, 0.028
    n = len(text)
    if n == 0:
        return
    pos = 0
    while pos < n:
        pos = min(pos + chunk_size, n)
        container.markdown(text[:pos])
        time.sleep(delay)


def run_assistant_query(prompt: str) -> None:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    if not is_valid:
        with st.chat_message("assistant"):
            st.error("Update your `.env` configuration and try again.")
        return

    with st.chat_message("assistant"):
        try:
            status_placeholder = st.empty()
            status_placeholder.caption("Working....")
            result = client.ask(prompt, chat_history=to_history(st.session_state.messages))
            answer = result["answer"] or "No response from the assistant."
            sources = result.get("sources", [])
            status_placeholder.empty()
            formatted = format_assistant_markdown(answer)
            box = st.empty()
            speed = st.session_state.get("stream_speed", "Normal")
            stream_markdown_reveal(box, formatted, speed)
            if sources:
                render_sources(sources)
            st.session_state.messages.append(
                {"role": "assistant", "content": answer, "sources": sources}
            )
        except Exception as exc:
            status_placeholder.empty()
            st.error(f"Something went wrong: {exc}")


for m in st.session_state.messages:
    with st.chat_message(m["role"]):
        if m["role"] == "assistant":
            st.markdown(format_assistant_markdown(m["content"]))
        else:
            st.markdown(m["content"])
        if m.get("sources"):
            render_sources(m["sources"])

prompt = st.chat_input("Message…")
if prompt:
    run_assistant_query(prompt)
