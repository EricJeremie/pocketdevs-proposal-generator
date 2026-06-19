#!/usr/bin/env python3
"""PocketDevs Proposal Generator MCP server.

This server is intentionally self-contained so it can run on the machine's
stock Python 3 installation without extra packages. It exposes:

- repository tools for codebase search and file reads
- app-specific tools for Supabase proposals, invoices, and questionnaires

The server speaks MCP over stdio using newline-delimited JSON-RPC messages.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "proposal-generator", "version": "1.0.0"}
INSTRUCTIONS = (
    "PocketDevs Proposal Generator MCP. Use repo tools for code and config "
    "questions, and document tools for proposals, invoices, and questionnaire "
    "records. Prefer search before read, and keep results focused on the "
    "smallest useful set of files or documents."
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://xiykfvyjavkkmfqujcql.supabase.co").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
DEFAULT_OWNER_EMAIL = os.environ.get("PROPOSAL_GENERATOR_OWNER_EMAIL", "e.rotaquio@pocketdevs.ph").strip()


def find_project_root(start: Path) -> Path:
    markers = {"README.md", "app.js", "requirements.js", "supabase.js"}
    for candidate in (start, *start.parents):
        if all((candidate / marker).exists() for marker in markers):
            return candidate
    return start


ROOT = find_project_root(
    Path(
        os.environ.get("PROPOSAL_GENERATOR_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.getcwd()
    ).resolve()
)


def eprint(*parts: Any) -> None:
    print(*parts, file=sys.stderr, flush=True)


def make_json_result(payload: Any, max_chars: int = 40000) -> Dict[str, Any]:
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False)
    if len(text) > max_chars:
        text = text[: max_chars - 16] + "\n... [truncated]"
    return {"content": [{"type": "text", "text": text}]}


def make_text_result(text: str) -> Dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}


def error_result(message: str) -> Dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def json_rpc_response(request_id: Any, result: Any = None, error: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    response: Dict[str, Any] = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        response["error"] = error
    else:
        response["result"] = result if result is not None else {}
    return response


def send(obj: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def is_inside_root(path: Path) -> bool:
    try:
        path.relative_to(ROOT)
        return True
    except ValueError:
        return False


def resolve_workspace_path(relative_path: str) -> Path:
    if not relative_path or not isinstance(relative_path, str):
        raise ValueError("path is required")
    candidate = (ROOT / relative_path).resolve()
    if not is_inside_root(candidate) and candidate != ROOT:
        raise ValueError("path escapes the workspace root")
    return candidate


def truncate_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 16)] + "\n... [truncated]"


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, number))


def parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return default


def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    email = email.strip().lower()
    return email or None


def is_probably_text(path: Path) -> bool:
    if path.suffix.lower() in {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".pdf",
        ".ico",
        ".zip",
        ".gz",
        ".sqlite",
    }:
        return False
    return True


def walk_files() -> List[str]:
    files: List[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = Path(dirpath).relative_to(ROOT)
        parts = rel_dir.parts
        if ".git" in parts:
            dirnames[:] = []
            continue
        if "__pycache__" in parts:
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for filename in filenames:
            rel = Path(dirpath, filename).relative_to(ROOT).as_posix()
            files.append(rel)
    files.sort()
    return files


def rg_available() -> bool:
    return shutil.which("rg") is not None


def workspace_files(glob: Optional[str] = None, limit: int = 200) -> List[str]:
    limit = clamp_int(limit, 200, 1, 1000)
    if rg_available():
        args = ["rg", "--files", "--hidden", "--glob", "!**/.git/**", "--glob", "!**/__pycache__/**"]
        if glob:
            args.extend(["--glob", glob])
        try:
            completed = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
            output = completed.stdout.strip()
            if completed.returncode not in {0, 1} and output:
                eprint("rg --files warning:", completed.stderr.strip())
            files = [line.strip() for line in output.splitlines() if line.strip()]
            return files[:limit]
        except Exception as exc:
            eprint("rg --files failed, falling back to os.walk:", exc)
    files = walk_files()
    if glob:
        import fnmatch

        files = [f for f in files if fnmatch.fnmatch(f, glob)]
    return files[:limit]


def workspace_search(query: str, glob: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
    query = (query or "").strip()
    if not query:
        raise ValueError("query is required")
    limit = clamp_int(limit, 20, 1, 100)

    matches: List[Dict[str, Any]] = []
    if rg_available():
        args = ["rg", "-n", "-F", "--hidden", "--glob", "!**/.git/**", "--glob", "!**/__pycache__/**", "--max-count", str(limit)]
        if glob:
            args.extend(["--glob", glob])
        args.extend(["--", query, "."])
        completed = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
        if completed.returncode not in {0, 1}:
            raise RuntimeError((completed.stderr or "ripgrep search failed").strip())
        for line in completed.stdout.splitlines():
            parts = line.split(":", 2)
            if len(parts) == 3:
                file_path, line_no, text = parts
                if file_path.startswith("./"):
                    file_path = file_path[2:]
                matches.append({"path": file_path, "line": int(line_no), "text": text})
            else:
                matches.append({"raw": line})
        return matches[:limit]

    # Fallback: simple Python search over text files.
    needle = query.lower()
    for rel in workspace_files(limit=10000):
        path = (ROOT / rel).resolve()
        if not path.is_file() or not is_probably_text(path):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for idx, line in enumerate(text.splitlines(), start=1):
            if needle in line.lower():
                matches.append({"path": rel, "line": idx, "text": line.strip()})
                if len(matches) >= limit:
                    return matches
    return matches


def read_workspace_file(relative_path: str, max_chars: int = 20000) -> Dict[str, Any]:
    max_chars = clamp_int(max_chars, 20000, 1, 150000)
    path = resolve_workspace_path(relative_path)
    if not path.exists():
        raise FileNotFoundError(f"{relative_path} does not exist")
    if not path.is_file():
        raise ValueError(f"{relative_path} is not a file")
    data = path.read_text(encoding="utf-8", errors="replace")
    truncated = len(data) > max_chars
    text = truncate_text(data, max_chars) if truncated else data
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "size": len(data),
        "truncated": truncated,
        "text": text,
    }


def project_overview() -> Dict[str, Any]:
    files = set(workspace_files(limit=1000))
    overview = {
        "project": "PocketDevs Proposal Generator",
        "type": "Build-free static site with Supabase-backed document storage and Vercel AI proxy functions",
        "runLocal": "vercel dev",
        "keyFiles": [
            {"path": "index.html", "purpose": "Main proposal/invoice builder"},
            {"path": "app.js", "purpose": "Core proposal generation and editor logic"},
            {"path": "requirements.html", "purpose": "System requirements questionnaire and chat UI"},
            {"path": "requirements.js", "purpose": "Questionnaire flow, AI requirements chat, and SRD rendering"},
            {"path": "dashboard.html", "purpose": "Saved documents dashboard"},
            {"path": "dashboard.js", "purpose": "Dashboard behavior and document navigation"},
            {"path": "supabase.js", "purpose": "Shared Supabase client and document helpers"},
            {"path": "lib/supabase.js", "purpose": "Shared Supabase session verification for Vercel routes"},
            {"path": "api/generate-proposal.js", "purpose": "Proposal generation Vercel function"},
            {"path": "api/generate-requirements.js", "purpose": "Requirements generation Vercel function"},
        ],
        "availableMcpFiles": [
            f for f in [".mcp.json", ".codex/config.toml", "AGENTS.md", "CLAUDE.md", "mcp/server.py"] if f in files
        ],
        "notes": [
            "The repo root is the working directory for the web app.",
            "Document tools are optional; they require Supabase credentials in the MCP server environment.",
        ],
    }
    return overview


def supabase_headers(use_user_token: bool = False) -> Dict[str, str]:
    headers = {"accept": "application/json", "content-type": "application/json"}
    if use_user_token:
        if not SUPABASE_ACCESS_TOKEN:
            raise RuntimeError(
                "Document tools need SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN in the MCP server environment."
            )
        headers["apikey"] = SUPABASE_ANON_KEY
        headers["Authorization"] = f"Bearer {SUPABASE_ACCESS_TOKEN}"
        return headers
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "Document tools need SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN in the MCP server environment."
        )
    headers["apikey"] = SUPABASE_SERVICE_ROLE_KEY
    headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    return headers


def http_json(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    body: Optional[Any] = None,
    timeout: int = 30,
) -> Tuple[int, Dict[str, Any]]:
    req_headers = headers.copy() if headers else {}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers.setdefault("content-type", "application/json")
    request = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw) if raw else {}
            return response.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"message": raw or exc.reason}
        return exc.code, parsed


def supabase_request(
    path: str,
    method: str = "GET",
    params: Optional[Dict[str, Any]] = None,
    body: Optional[Any] = None,
    use_user_token: bool = False,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, Dict[str, Any]]:
    url = f"{SUPABASE_URL}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = supabase_headers(use_user_token=use_user_token)
    if extra_headers:
        headers.update(extra_headers)
    return http_json(method, url, headers=headers, body=body)


def current_user_id() -> Optional[str]:
    if not SUPABASE_ACCESS_TOKEN:
        return None
    status, payload = supabase_request("/auth/v1/user", use_user_token=True)
    if status != 200:
        return None
    user = payload if isinstance(payload, dict) else {}
    return user.get("id")


def list_auth_users(page: int = 1, per_page: int = 1000) -> List[Dict[str, Any]]:
    status, payload = supabase_request(
        "/auth/v1/admin/users",
        params={"page": page, "per_page": per_page},
    )
    if status != 200:
        raise RuntimeError(payload.get("message") or payload.get("msg") or f"Auth admin list failed (HTTP {status})")
    return list(payload.get("users") or [])


def resolve_user_id(owner_id: Optional[str] = None, owner_email: Optional[str] = None) -> Optional[str]:
    if owner_id:
        return owner_id.strip() or None
    email = normalize_email(owner_email) or normalize_email(DEFAULT_OWNER_EMAIL)
    if email and SUPABASE_SERVICE_ROLE_KEY:
        page = 1
        while page <= 10:
            users = list_auth_users(page=page, per_page=1000)
            for user in users:
                if normalize_email(user.get("email")) == email:
                    return user.get("id")
            if len(users) < 1000:
                break
            page += 1
    if SUPABASE_ACCESS_TOKEN:
        return current_user_id()
    return None


def proposal_title_from_content(content: Dict[str, Any]) -> str:
    meta = content.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}
    return (
        meta.get("title")
        or meta.get("proposalName")
        or meta.get("invoiceName")
        or content.get("title")
        or "Untitled document"
    )


def proposal_kind_from_content(content: Dict[str, Any]) -> str:
    if content.get("docType") == "invoice":
        return "invoice"
    return "proposal"


def summarize_proposal(row: Dict[str, Any]) -> Dict[str, Any]:
    content = row.get("content") or {}
    if not isinstance(content, dict):
        content = {}
    client = row.get("client_name")
    if not client:
        client_data = content.get("client")
        if isinstance(client_data, dict):
            client = client_data.get("company") or client_data.get("name")
    return {
        "kind": proposal_kind_from_content(content),
        "id": row.get("id"),
        "title": proposal_title_from_content(content),
        "client": client,
        "docNumber": row.get("doc_number") or (content.get("meta") or {}).get("documentNumber"),
        "updatedAt": row.get("updated_at"),
        "shareToken": row.get("share_token"),
        "ownerId": row.get("user_id"),
    }


def summarize_questionnaire(row: Dict[str, Any]) -> Dict[str, Any]:
    answers = row.get("answers") or {}
    if not isinstance(answers, dict):
        answers = {}
    return {
        "kind": "questionnaire",
        "id": row.get("id"),
        "title": row.get("project_name") or answers.get("projectName") or answers.get("project_name") or "Untitled submission",
        "client": row.get("client_name"),
        "projectType": row.get("project_type") or answers.get("projectType"),
        "docNumber": row.get("doc_number"),
        "status": row.get("status"),
        "updatedAt": row.get("updated_at"),
        "ownerId": row.get("user_id"),
    }


def fetch_documents(table: str, owner_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    limit = clamp_int(limit, 50, 1, 200)
    params = {"select": "*", "order": "updated_at.desc", "limit": str(limit)}
    if owner_id:
        params["user_id"] = f"eq.{owner_id}"
    status, payload = supabase_request(f"/rest/v1/{table}", params=params, use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY))
    if status != 200:
        raise RuntimeError(payload.get("message") or payload.get("hint") or f"Failed to load {table} (HTTP {status})")
    if not isinstance(payload, list):
        return []
    return payload


def get_document_by_id(kind: str, doc_id: str, owner_id: Optional[str] = None) -> Dict[str, Any]:
    doc_id = str(doc_id).strip()
    if not doc_id:
        raise ValueError("id is required")
    owner_id = owner_id or resolve_user_id()

    if kind in {"proposal", "invoice"}:
        params = {"select": "*", "id": f"eq.{doc_id}"}
        if owner_id:
            params["user_id"] = f"eq.{owner_id}"
        status, payload = supabase_request(
            "/rest/v1/proposals",
            params=params,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
        )
        if status != 200:
            raise RuntimeError(payload.get("message") or f"Failed to load proposal (HTTP {status})")
        row = payload[0] if isinstance(payload, list) and payload else None
        if not row:
            raise FileNotFoundError("proposal not found")
        summary = summarize_proposal(row)
        if kind == "invoice" and summary["kind"] != "invoice":
            raise FileNotFoundError("invoice not found")
        if kind == "proposal" and summary["kind"] != "proposal":
            raise FileNotFoundError("proposal not found")
        return {"summary": summary, "content": row}

    if kind == "questionnaire":
        params = {"select": "*", "id": f"eq.{doc_id}"}
        if owner_id:
            params["user_id"] = f"eq.{owner_id}"
        status, payload = supabase_request(
            "/rest/v1/questionnaire_submissions",
            params=params,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
        )
        if status != 200:
            raise RuntimeError(payload.get("message") or f"Failed to load questionnaire (HTTP {status})")
        row = payload[0] if isinstance(payload, list) and payload else None
        if not row:
            raise FileNotFoundError("questionnaire not found")
        return {"summary": summarize_questionnaire(row), "content": row}

    raise ValueError("kind must be proposal, invoice, or questionnaire")


def search_docs(
    query: str,
    kind: str = "all",
    owner_id: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    query = (query or "").strip().lower()
    if not query:
        raise ValueError("query is required")
    limit = clamp_int(limit, 20, 1, 50)
    owner_id = owner_id or resolve_user_id()

    rows: List[Dict[str, Any]] = []
    if kind in {"all", "proposal", "invoice"}:
        rows.extend(fetch_documents("proposals", owner_id=owner_id, limit=limit * 5))
    if kind in {"all", "questionnaire"}:
        rows.extend(fetch_documents("questionnaire_submissions", owner_id=owner_id, limit=limit * 5))

    scored: List[Tuple[int, Dict[str, Any]]] = []
    for row in rows:
        if "content" in row:
            summary = summarize_proposal(row)
            if kind == "invoice" and summary["kind"] != "invoice":
                continue
            if kind == "proposal" and summary["kind"] != "proposal":
                continue
            blob = json.dumps(row, ensure_ascii=False)
            summary_type = summary["kind"]
        else:
            summary = summarize_questionnaire(row)
            blob = json.dumps(row, ensure_ascii=False)
            summary_type = "questionnaire"
            if kind not in {"all", summary_type}:
                continue

        haystack = " ".join(
            str(part)
            for part in [
                summary.get("title"),
                summary.get("client"),
                summary.get("docNumber"),
                summary.get("status"),
                blob,
            ]
            if part is not None
        ).lower()
        if query not in haystack:
            continue
        score = sum(1 for field in [summary.get("title"), summary.get("client"), summary.get("docNumber"), summary.get("status")] if field and query in str(field).lower())
        scored.append((score, summary | {"excerpt": make_excerpt(blob, query)}))

    scored.sort(key=lambda item: (item[0], str(item[1].get("updatedAt") or "")), reverse=True)
    return [item[1] for item in scored[:limit]]


def make_excerpt(blob: str, query: str, window: int = 120) -> str:
    lowered = blob.lower()
    idx = lowered.find(query)
    if idx == -1:
        return truncate_text(blob.replace("\n", " "), 240)
    start = max(0, idx - window)
    end = min(len(blob), idx + len(query) + window)
    excerpt = blob[start:end].replace("\n", " ")
    if start > 0:
        excerpt = "…" + excerpt
    if end < len(blob):
        excerpt = excerpt + "…"
    return excerpt


def upsert_proposal_document(payload: Dict[str, Any]) -> Dict[str, Any]:
    owner_id = resolve_user_id(payload.get("ownerId"), payload.get("ownerEmail"))
    if not owner_id:
        raise RuntimeError("Could not resolve a document owner. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN, or pass ownerId.")

    proposal = payload.get("proposal")
    if not isinstance(proposal, dict):
        raise ValueError("proposal must be an object")

    doc_number = payload.get("docNumber") or (proposal.get("meta") or {}).get("documentNumber")
    if isinstance(doc_number, str):
        doc_number = doc_number.strip() or None

    row = {
        "user_id": owner_id,
        "doc_number": doc_number,
        "project_title": proposal_title_from_content(proposal),
        "client_name": (
            (proposal.get("client") or {}).get("company")
            if isinstance(proposal.get("client"), dict)
            else None
        )
        or (
            (proposal.get("client") or {}).get("name")
            if isinstance(proposal.get("client"), dict)
            else None
        )
        or proposal.get("client_name"),
        "content": proposal,
        "updated_at": payload.get("updatedAt") or current_timestamp(),
    }
    if payload.get("id"):
        params = {"select": "*", "id": f"eq.{payload['id']}", "user_id": f"eq.{owner_id}"}
        status, result = supabase_request(
            "/rest/v1/proposals",
            method="PATCH",
            params=params,
            body=row,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
            extra_headers={"Prefer": "return=representation"},
        )
    elif doc_number:
        status, result = supabase_request(
            "/rest/v1/proposals",
            method="POST",
            params={"on_conflict": "user_id,doc_number"},
            body=row,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
            extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
        )
    else:
        status, result = supabase_request(
            "/rest/v1/proposals",
            method="POST",
            body=row,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
            extra_headers={"Prefer": "return=representation"},
        )

    if status not in {200, 201}:
        raise RuntimeError(result.get("message") or f"Could not save proposal (HTTP {status})")
    saved = result[0] if isinstance(result, list) and result else result
    return {"summary": summarize_proposal(saved), "content": saved}


def upsert_questionnaire_document(payload: Dict[str, Any]) -> Dict[str, Any]:
    owner_id = resolve_user_id(payload.get("ownerId"), payload.get("ownerEmail"))
    if not owner_id:
        raise RuntimeError("Could not resolve a document owner. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN, or pass ownerId.")

    questionnaire = payload.get("questionnaire")
    if not isinstance(questionnaire, dict):
        raise ValueError("questionnaire must be an object")

    answers = questionnaire.get("answers") or {}
    if not isinstance(answers, dict):
        answers = {}

    row = {
        "user_id": owner_id,
        "client_name": (
            questionnaire.get("client_name")
            or answers.get("contactCompany")
            or answers.get("clientName")
            or answers.get("contactName")
        ),
        "project_name": questionnaire.get("project_name") or answers.get("projectName"),
        "project_type": questionnaire.get("project_type") or answers.get("projectType"),
        "answers": answers,
        "srd_content": questionnaire.get("srd_content"),
        "doc_number": questionnaire.get("doc_number") or answers.get("documentNumber"),
        "status": questionnaire.get("status") or "submitted",
        "updated_at": payload.get("updatedAt") or current_timestamp(),
    }

    if payload.get("id"):
        params = {"select": "*", "id": f"eq.{payload['id']}", "user_id": f"eq.{owner_id}"}
        status, result = supabase_request(
            "/rest/v1/questionnaire_submissions",
            method="PATCH",
            params=params,
            body=row,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
            extra_headers={"Prefer": "return=representation"},
        )
    elif row.get("doc_number"):
        status, result = supabase_request(
            "/rest/v1/questionnaire_submissions",
            method="POST",
            params={"on_conflict": "user_id,doc_number"},
            body=row,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
            extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
        )
    else:
        status, result = supabase_request(
            "/rest/v1/questionnaire_submissions",
            method="POST",
            body=row,
            use_user_token=bool(SUPABASE_ACCESS_TOKEN and not SUPABASE_SERVICE_ROLE_KEY),
            extra_headers={"Prefer": "return=representation"},
        )

    if status not in {200, 201}:
        raise RuntimeError(result.get("message") or f"Could not save questionnaire (HTTP {status})")
    saved = result[0] if isinstance(result, list) and result else result
    return {"summary": summarize_questionnaire(saved), "content": saved}


def current_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def validate_schema(schema: Dict[str, Any], value: Any, path: str = "$") -> None:
    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(value, dict):
            raise ValueError(f"{path} must be an object")
        properties = schema.get("properties") or {}
        required = schema.get("required") or []
        for key in required:
            if key not in value:
                raise ValueError(f"{path}.{key} is required")
        if schema.get("additionalProperties") is False:
            for key in value.keys():
                if key not in properties:
                    raise ValueError(f"{path}.{key} is not allowed")
        for key, prop_schema in properties.items():
            if key in value:
                validate_schema(prop_schema, value[key], f"{path}.{key}")
        return
    if expected_type == "array":
        if not isinstance(value, list):
            raise ValueError(f"{path} must be an array")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_schema(item_schema, item, f"{path}[{index}]")
        return
    if expected_type == "string":
        if not isinstance(value, str):
            raise ValueError(f"{path} must be a string")
        enum = schema.get("enum")
        if enum and value not in enum:
            raise ValueError(f"{path} must be one of {enum}")
        return
    if expected_type == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError(f"{path} must be an integer")
        return
    if expected_type == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"{path} must be a number")
        return
    if expected_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{path} must be a boolean")
        return


@dataclass
class Tool:
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Any


TOOLS: Dict[str, Tool] = {}


def register_tool(name: str, description: str, input_schema: Dict[str, Any]):
    def decorator(func):
        TOOLS[name] = Tool(name=name, description=description, input_schema=input_schema, handler=func)
        return func

    return decorator


@register_tool(
    "project_overview",
    "Return a concise map of the app, its main files, and the local run command.",
    {"type": "object", "properties": {}, "additionalProperties": False},
)
def tool_project_overview(_args: Dict[str, Any]) -> Dict[str, Any]:
    return make_json_result(project_overview())


@register_tool(
    "workspace_list",
    "List files in the proposal-generator workspace.",
    {
        "type": "object",
        "properties": {
            "glob": {"type": "string"},
            "limit": {"type": "integer"},
        },
        "additionalProperties": False,
    },
)
def tool_workspace_list(args: Dict[str, Any]) -> Dict[str, Any]:
    files = workspace_files(glob=args.get("glob"), limit=args.get("limit", 200))
    return make_json_result({"root": ROOT.as_posix(), "files": files, "count": len(files)})


@register_tool(
    "workspace_search",
    "Search the repository text for a literal query string.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "glob": {"type": "string"},
            "limit": {"type": "integer"},
        },
        "required": ["query"],
        "additionalProperties": False,
    },
)
def tool_workspace_search(args: Dict[str, Any]) -> Dict[str, Any]:
    matches = workspace_search(args["query"], glob=args.get("glob"), limit=args.get("limit", 20))
    return make_json_result({"query": args["query"], "count": len(matches), "matches": matches})


@register_tool(
    "workspace_read",
    "Read a single file relative to the repository root.",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "maxChars": {"type": "integer"},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
)
def tool_workspace_read(args: Dict[str, Any]) -> Dict[str, Any]:
    return make_json_result(read_workspace_file(args["path"], args.get("maxChars", 20000)))


@register_tool(
    "documents_list",
    "List proposals, invoices, or questionnaires from Supabase.",
    {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["all", "proposal", "invoice", "questionnaire"]},
            "ownerEmail": {"type": "string"},
            "ownerId": {"type": "string"},
            "limit": {"type": "integer"},
        },
        "additionalProperties": False,
    },
)
def tool_documents_list(args: Dict[str, Any]) -> Dict[str, Any]:
    owner_id = resolve_user_id(args.get("ownerId"), args.get("ownerEmail"))
    if args.get("ownerEmail") or args.get("ownerId") or DEFAULT_OWNER_EMAIL:
        owner_id = owner_id or resolve_user_id()
    kind = args.get("kind", "all")
    limit = clamp_int(args.get("limit", 20), 20, 1, 50)
    items: List[Dict[str, Any]] = []
    if kind in {"all", "proposal", "invoice"}:
        for row in fetch_documents("proposals", owner_id=owner_id, limit=limit * 5):
            summary = summarize_proposal(row)
            if kind == "proposal" and summary["kind"] != "proposal":
                continue
            if kind == "invoice" and summary["kind"] != "invoice":
                continue
            items.append(summary)
    if kind in {"all", "questionnaire"}:
        for row in fetch_documents("questionnaire_submissions", owner_id=owner_id, limit=limit * 5):
            items.append(summarize_questionnaire(row))
    items = sorted(items, key=lambda item: str(item.get("updatedAt") or ""), reverse=True)[:limit]
    return make_json_result({"filters": {"kind": kind, "ownerId": owner_id, "limit": limit}, "count": len(items), "items": items})


@register_tool(
    "documents_search",
    "Search saved proposals, invoices, and questionnaires by title, client, or document body.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "kind": {"type": "string", "enum": ["all", "proposal", "invoice", "questionnaire"]},
            "ownerEmail": {"type": "string"},
            "ownerId": {"type": "string"},
            "limit": {"type": "integer"},
        },
        "required": ["query"],
        "additionalProperties": False,
    },
)
def tool_documents_search(args: Dict[str, Any]) -> Dict[str, Any]:
    owner_id = resolve_user_id(args.get("ownerId"), args.get("ownerEmail"))
    kind = args.get("kind", "all")
    matches = search_docs(args["query"], kind=kind, owner_id=owner_id, limit=args.get("limit", 20))
    return make_json_result({"query": args["query"], "filters": {"kind": kind, "ownerId": owner_id}, "count": len(matches), "matches": matches})


@register_tool(
    "documents_get",
    "Fetch one saved proposal, invoice, or questionnaire by id.",
    {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["proposal", "invoice", "questionnaire"]},
            "id": {"type": "string"},
            "ownerEmail": {"type": "string"},
            "ownerId": {"type": "string"},
            "includeContent": {"type": "boolean"},
        },
        "required": ["kind", "id"],
        "additionalProperties": False,
    },
)
def tool_documents_get(args: Dict[str, Any]) -> Dict[str, Any]:
    owner_id = resolve_user_id(args.get("ownerId"), args.get("ownerEmail"))
    record = get_document_by_id(args["kind"], args["id"], owner_id=owner_id)
    if parse_bool(args.get("includeContent"), True):
        return make_json_result(record)
    return make_json_result({"summary": record["summary"]})


@register_tool(
    "save_proposal",
    "Create or update a proposal or invoice document in Supabase.",
    {
        "type": "object",
        "properties": {
            "proposal": {"type": "object"},
            "ownerEmail": {"type": "string"},
            "ownerId": {"type": "string"},
            "id": {"type": "string"},
            "docNumber": {"type": "string"},
            "updatedAt": {"type": "string"},
        },
        "required": ["proposal"],
        "additionalProperties": False,
    },
)
def tool_save_proposal(args: Dict[str, Any]) -> Dict[str, Any]:
    return make_json_result(upsert_proposal_document(args))


@register_tool(
    "save_questionnaire",
    "Create or update a questionnaire submission in Supabase.",
    {
        "type": "object",
        "properties": {
            "questionnaire": {"type": "object"},
            "ownerEmail": {"type": "string"},
            "ownerId": {"type": "string"},
            "id": {"type": "string"},
            "updatedAt": {"type": "string"},
        },
        "required": ["questionnaire"],
        "additionalProperties": False,
    },
)
def tool_save_questionnaire(args: Dict[str, Any]) -> Dict[str, Any]:
    return make_json_result(upsert_questionnaire_document(args))


def list_tools() -> List[Dict[str, Any]]:
    return [
        {"name": tool.name, "description": tool.description, "inputSchema": tool.input_schema}
        for tool in TOOLS.values()
    ]


def handle_initialize(request_id: Any, params: Dict[str, Any]) -> None:
    protocol_version = params.get("protocolVersion") or PROTOCOL_VERSION
    result = {
        "protocolVersion": protocol_version,
        "serverInfo": SERVER_INFO,
        "capabilities": {"tools": {"listChanged": False}},
        "instructions": INSTRUCTIONS,
    }
    send(json_rpc_response(request_id, result=result))


def handle_tools_list(request_id: Any) -> None:
    send(json_rpc_response(request_id, result={"tools": list_tools()}))


def handle_tools_call(request_id: Any, params: Dict[str, Any]) -> None:
    name = params.get("name")
    tool = TOOLS.get(name)
    if not tool:
        send(json_rpc_response(request_id, error={"code": -32602, "message": f"Unknown tool: {name}"}))
        return
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        send(json_rpc_response(request_id, error={"code": -32602, "message": "Tool arguments must be an object"}))
        return
    try:
        validate_schema(tool.input_schema, arguments)
        result = tool.handler(arguments)
        send(json_rpc_response(request_id, result=result))
    except Exception as exc:
        eprint(f"Tool {name} failed: {exc}")
        eprint(traceback.format_exc())
        send(json_rpc_response(request_id, result=error_result(str(exc))))


def validate_schema(schema: Dict[str, Any], value: Any, path: str = "$") -> None:
    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(value, dict):
            raise ValueError(f"{path} must be an object")
        properties = schema.get("properties") or {}
        required = schema.get("required") or []
        for key in required:
            if key not in value:
                raise ValueError(f"{path}.{key} is required")
        if schema.get("additionalProperties") is False:
            for key in value.keys():
                if key not in properties:
                    raise ValueError(f"{path}.{key} is not allowed")
        for key, prop_schema in properties.items():
            if key in value:
                validate_schema(prop_schema, value[key], f"{path}.{key}")
        return
    if expected_type == "array":
        if not isinstance(value, list):
            raise ValueError(f"{path} must be an array")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_schema(item_schema, item, f"{path}[{index}]")
        return
    if expected_type == "string":
        if not isinstance(value, str):
            raise ValueError(f"{path} must be a string")
        enum = schema.get("enum")
        if enum and value not in enum:
            raise ValueError(f"{path} must be one of {enum}")
        return
    if expected_type == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError(f"{path} must be an integer")
        return
    if expected_type == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"{path} must be a number")
        return
    if expected_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{path} must be a boolean")
        return
    if expected_type == "object" and isinstance(value, dict):
        return


def handle_message(message: Dict[str, Any]) -> None:
    if message.get("jsonrpc") != "2.0":
        return
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") or {}

    if method == "initialize":
        handle_initialize(request_id, params if isinstance(params, dict) else {})
        return
    if method == "initialized":
        return
    if method == "tools/list":
        handle_tools_list(request_id)
        return
    if method == "tools/call":
        handle_tools_call(request_id, params if isinstance(params, dict) else {})
        return
    if request_id is not None:
        send(json_rpc_response(request_id, error={"code": -32601, "message": f"Method not found: {method}"}))


def main() -> None:
    eprint(f"{SERVER_INFO['name']} MCP server starting from {ROOT}")
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            eprint("Invalid JSON from client:", exc)
            continue
        try:
            handle_message(message)
        except Exception as exc:
            eprint("Unhandled MCP server error:", exc)
            eprint(traceback.format_exc())
            if message.get("id") is not None:
                send(json_rpc_response(message.get("id"), error={"code": -32603, "message": str(exc)}))


if __name__ == "__main__":
    main()
