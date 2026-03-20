import os
from typing import Any, Dict, List, Optional, Tuple

import requests


class CloudflareAgentClient:
    def __init__(self) -> None:
        self.agent_url = os.getenv("CLOUDFLARE_AGENT_URL", "").strip()
        self.api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
        self.account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        self.auth_header = os.getenv("CLOUDFLARE_AUTH_HEADER", "Authorization").strip()

    def validate_config(self) -> Tuple[bool, str]:
        if not self.agent_url:
            return False, "Missing CLOUDFLARE_AGENT_URL in environment."
        if not self.api_token:
            return False, "Missing CLOUDFLARE_API_TOKEN in environment."
        return True, "Configuration looks good."

    def ask(
        self,
        user_query: str,
        chat_history: Optional[List[Dict[str, str]]] = None,
        timeout_seconds: int = 60,
    ) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            self.auth_header: f"Bearer {self.api_token}",
        }

        payload: Dict[str, Any] = {
            "query": user_query,
            "messages": chat_history or [],
        }

        if self.account_id:
            payload["account_id"] = self.account_id

        response = requests.post(
            self.agent_url,
            headers=headers,
            json=payload,
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()

        # Normalize common response shapes from custom worker/agent APIs.
        answer = (
            data.get("answer")
            or data.get("response")
            or data.get("result")
            or data.get("text")
            or ""
        )
        sources = data.get("sources") or data.get("citations") or []

        return {
            "raw": data,
            "answer": answer,
            "sources": sources,
        }
