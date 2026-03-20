import os
import json
from typing import Any, Dict, List, Optional, Tuple

import requests


class CloudflareAgentClient:
    def __init__(self) -> None:
        self.agent_url = os.getenv("CLOUDFLARE_AGENT_URL", "").strip()
        self.api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
        self.account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        self.auth_header = os.getenv("CLOUDFLARE_AUTH_HEADER", "Authorization").strip()
        self.cf_access_client_id = os.getenv("CF_ACCESS_CLIENT_ID", "").strip()
        self.cf_access_client_secret = os.getenv("CF_ACCESS_CLIENT_SECRET", "").strip()

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
        if self.cf_access_client_id and self.cf_access_client_secret:
            headers["CF-Access-Client-Id"] = self.cf_access_client_id
            headers["CF-Access-Client-Secret"] = self.cf_access_client_secret

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
        if not response.ok:
            # Bubble up backend JSON details instead of generic 502 only.
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type:
                err = response.json()
                upstream_status = err.get("upstream_status")
                upstream_errors = err.get("upstream_errors")
                upstream_body = err.get("upstream_body")
                details = [f"Backend error {response.status_code}: {err.get('error', err)}"]
                if upstream_status:
                    details.append(f"upstream_status={upstream_status}")
                if upstream_errors:
                    details.append(f"upstream_errors={upstream_errors}")
                if upstream_body:
                    details.append(f"upstream_body={str(upstream_body)[:500]}")
                raise RuntimeError(
                    " | ".join(details)
                )
            raise RuntimeError(
                f"Backend error {response.status_code}: {response.text[:500]}"
            )

        try:
            data = response.json()
        except json.JSONDecodeError:
            raise RuntimeError(
                f"Backend returned non-JSON response (status {response.status_code}): "
                f"{response.text[:500]}"
            )

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
