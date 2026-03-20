import os
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

# Hide sidebar completely; tighten default padding for a cleaner chat app
st.markdown(
    """
    <style>
    [data-testid="stSidebar"] { display: none !important; }
    [data-testid="collapsedControl"] { display: none !important; }
    .block-container { padding-top: 0.75rem; padding-bottom: 2rem; max-width: 48rem; }
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    header[data-testid="stHeader"] { background: transparent; }
    .fuja-topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        background: rgba(255, 255, 255, 0.86);
        backdrop-filter: blur(8px);
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 0.8rem 1rem;
        margin-bottom: 1rem;
    }
    .fuja-topbar-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
    }
    .fuja-header {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .fuja-title {
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: #111827;
        margin: 0;
    }
    .fuja-sub {
        font-size: 0.78rem;
        color: #6b7280;
        margin-top: 0.1rem;
    }
    .fuja-status {
        font-size: 0.8rem;
        color: #4b5563;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
    }
    .fuja-dot {
        width: 8px;
        height: 8px;
        border-radius: 99px;
        display: inline-block;
        background: #10b981;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
    }
    .fuja-dot.offline {
        background: #ef4444;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
    }
    .fuja-empty {
        border: 1px dashed #d1d5db;
        border-radius: 12px;
        padding: 1rem;
        margin: 0.25rem 0 1rem;
        background: #fcfcfd;
    }
    div[data-testid="stChatMessage"] {
        background-color: #f9fafb;
        border: 1px solid #f3f4f6;
        border-radius: 12px;
        padding: 0.75rem 1rem;
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
    </style>
    """,
    unsafe_allow_html=True,
)

client = CloudflareAgentClient()
is_valid, _ = client.validate_config()

top_l, top_r = st.columns([0.75, 0.25])
with top_l:
    status_html = (
        "<span class='fuja-dot'></span>Connected"
        if is_valid
        else "<span class='fuja-dot offline'></span>Config needed"
    )
    st.markdown(
        f"""
        <div class="fuja-topbar">
            <div class="fuja-topbar-inner">
                <div class="fuja-header">
                    <p class="fuja-title">FUJA Assistant</p>
                    <p class="fuja-sub">Answers from your knowledge base</p>
                </div>
                <div class="fuja-status">{status_html}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
with top_r:
    st.markdown("<div style='height:0.34rem'></div>", unsafe_allow_html=True)
    if st.button("New conversation", use_container_width=True, type="secondary"):
        st.session_state.messages = []
        st.rerun()

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


def run_assistant_query(prompt: str) -> None:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    if not is_valid:
        with st.chat_message("assistant"):
            st.error("Update your `.env` configuration and try again.")
        return

    with st.chat_message("assistant"):
        with st.spinner("Working…"):
            try:
                result = client.ask(prompt, chat_history=to_history(st.session_state.messages))
                answer = result["answer"] or "No response from the assistant."
                sources = result.get("sources", [])
                st.markdown(answer)
                if sources:
                    render_sources(sources)
                st.session_state.messages.append(
                    {"role": "assistant", "content": answer, "sources": sources}
                )
            except Exception as exc:
                st.error(f"Something went wrong: {exc}")


if not st.session_state.messages:
    st.markdown(
        """
        <div class="fuja-empty">
            <strong>Start with a common query</strong><br/>
            <span style="color:#6b7280;font-size:0.9rem;">Pick a prompt or type your own question below.</span>
        </div>
        """,
        unsafe_allow_html=True,
    )
    p1, p2, p3 = st.columns(3)
    with p1:
        if st.button("Admission process", use_container_width=True):
            run_assistant_query("What is the admission process?")
    with p2:
        if st.button("Fees structure", use_container_width=True):
            run_assistant_query("Can you explain the current fees structure?")
    with p3:
        if st.button("Scholarships", use_container_width=True):
            run_assistant_query("What scholarships are available?")


for m in st.session_state.messages:
    with st.chat_message(m["role"]):
        st.markdown(m["content"])
        if m.get("sources"):
            render_sources(m["sources"])


prompt = st.chat_input("Message…")
if prompt:
    run_assistant_query(prompt)
