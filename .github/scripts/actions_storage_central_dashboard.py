#!/usr/bin/env python3
"""Aggregate GitHub Actions storage/activity across dynamically discovered repositories.

The updater never relies on a hard-coded repository list. With a repository-scoped
GITHUB_TOKEN it may only see public/host-repository data. Configure
CENTRAL_DASHBOARD_TOKEN for complete cross-repository visibility when needed.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

HOST_REPO = os.environ["GITHUB_REPOSITORY"]
OWNER = HOST_REPO.split("/", 1)[0]
TOKEN = os.environ.get("CENTRAL_DASHBOARD_TOKEN") or os.environ["GITHUB_TOKEN"]
HOST_TOKEN = os.environ["GITHUB_TOKEN"]
API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
CENTRAL_ISSUE_NUMBER = int(os.environ.get("CENTRAL_DASHBOARD_ISSUE_NUMBER", "11"))
NOW = datetime.now(timezone.utc)


def request(method: str, path: str, token: str = TOKEN, payload: Any | None = None) -> Any:
    url = path if path.startswith("http") else f"{API}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "project-brain-central-actions-storage",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {path} failed: {exc.code} {body[:400]}") from exc


def paginate(path: str, key: str | None = None, token: str = TOKEN) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 1
    separator = "&" if "?" in path else "?"
    while True:
        payload = request("GET", f"{path}{separator}per_page=100&page={page}", token=token)
        batch = payload.get(key, []) if key and isinstance(payload, dict) else payload
        batch = batch if isinstance(batch, list) else []
        rows.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return rows


def discover_repositories() -> tuple[list[dict[str, Any]], str]:
    """Prefer authenticated accessible repos; fall back to public owner repos."""
    try:
        repos = paginate("/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc", token=TOKEN)
        owned = [r for r in repos if (r.get("owner") or {}).get("login") == OWNER and not r.get("archived")]
        if owned:
            return owned, "AUTHENTICATED_ACCESSIBLE_REPOSITORIES"
    except Exception:
        pass

    repos = paginate(f"/users/{urllib.parse.quote(OWNER)}/repos?sort=updated&direction=desc", token=TOKEN)
    owned = [r for r in repos if not r.get("archived")]
    if HOST_REPO not in {r.get("full_name") for r in owned}:
        try:
            owned.append(request("GET", f"/repos/{HOST_REPO}", token=HOST_TOKEN))
        except Exception:
            pass
    return owned, "PUBLIC_OWNER_REPOSITORIES_ONLY"


def count_runs(repo: str, status: str | None = None) -> int:
    suffix = f"?status={status}&per_page=1" if status else "?per_page=1"
    payload = request("GET", f"/repos/{repo}/actions/runs{suffix}")
    return int(payload.get("total_count") or 0)


def all_artifacts(repo: str) -> list[dict[str, Any]]:
    return paginate(f"/repos/{repo}/actions/artifacts?", key="artifacts")


def local_dashboard(repo: str) -> tuple[str, str, int | None]:
    try:
        issues = paginate(f"/repos/{repo}/issues?state=open&", token=TOKEN)
    except Exception:
        return "—", "—", None
    for issue in issues:
        if issue.get("pull_request"):
            continue
        body = str(issue.get("body") or "")
        title = str(issue.get("title") or "")
        if "<!-- artifact-storage-dashboard -->" in body or title.startswith("Artifact Storage Dashboard —"):
            quota_match = re.search(r"Repository quota state:\s*\*\*([^*]+)\*\*", body)
            freed_match = re.search(r"Bytes freed:\s*\*\*([0-9]+)", body)
            quota = quota_match.group(1).strip() if quota_match else "UNKNOWN_ACCOUNT_CAPACITY"
            freed = freed_match.group(1) if freed_match else "—"
            return str(issue.get("html_url") or "—"), quota, int(freed) if freed.isdigit() else None
    return "—", "UNKNOWN_ACCOUNT_CAPACITY", None


def cleanup_workflow(repo: str) -> tuple[str, str, str]:
    try:
        workflows = paginate(f"/repos/{repo}/actions/workflows?", key="workflows")
    except Exception:
        return "—", "—", "—"
    target = next((w for w in workflows if w.get("path") == ".github/workflows/actions-artifact-retention.yml"), None)
    if not target:
        return "—", "—", "—"
    workflow_url = f"https://github.com/{repo}/actions/workflows/actions-artifact-retention.yml"
    try:
        runs = request("GET", f"/repos/{repo}/actions/workflows/{target['id']}/runs?per_page=1")
        latest = (runs.get("workflow_runs") or [None])[0]
    except Exception:
        latest = None
    if not latest:
        return workflow_url, "—", "—"
    return workflow_url, str(latest.get("html_url") or "—"), str(latest.get("updated_at") or latest.get("created_at") or "—")


def active_runs(repo: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for status in ("in_progress", "queued"):
        try:
            payload = request("GET", f"/repos/{repo}/actions/runs?status={status}&per_page=100")
            runs = payload.get("workflow_runs") or []
        except Exception:
            continue
        for run in runs:
            jobs = []
            try:
                jobs = (request("GET", f"/repos/{repo}/actions/runs/{run['id']}/jobs?per_page=100").get("jobs") or [])
            except Exception:
                pass
            if not jobs:
                rows.append({
                    "repo": repo, "workflow": run.get("name") or "—", "branch": run.get("head_branch") or "—",
                    "sha": run.get("head_sha") or "—", "run_id": run["id"], "job": "queued", "step": "waiting for job",
                    "completed": 0, "total": 0, "elapsed": elapsed(run.get("run_started_at") or run.get("created_at")),
                })
                continue
            for job in jobs:
                steps = job.get("steps") or []
                current = next((s for s in steps if s.get("status") == "in_progress"), None)
                rows.append({
                    "repo": repo, "workflow": run.get("name") or "—", "branch": run.get("head_branch") or "—",
                    "sha": run.get("head_sha") or "—", "run_id": run["id"], "job": job.get("name") or "—",
                    "step": (current or {}).get("name") or job.get("status") or "—",
                    "completed": sum(1 for s in steps if s.get("status") == "completed"), "total": len(steps),
                    "elapsed": elapsed(job.get("started_at") or run.get("run_started_at") or run.get("created_at")),
                })
    return rows


def elapsed(value: str | None) -> str:
    if not value:
        return "—"
    try:
        start = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return "—"
    seconds = max(0, int((NOW - start).total_seconds()))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def format_mib(value: int) -> str:
    return f"{value / 1024 / 1024:.2f}"


def main() -> int:
    repos, discovery_mode = discover_repositories()
    repo_rows: list[str] = []
    active_rows: list[dict[str, Any]] = []
    errors: list[str] = []

    for repo_obj in sorted(repos, key=lambda r: str(r.get("full_name") or "").lower()):
        repo = str(repo_obj.get("full_name") or "")
        if not repo:
            continue
        try:
            artifacts = all_artifacts(repo)
            live = [a for a in artifacts if not a.get("expired")]
            live_bytes = sum(int(a.get("size_in_bytes") or 0) for a in live)
            total_runs = count_runs(repo)
            running = count_runs(repo, "in_progress")
            queued = count_runs(repo, "queued")
            dash_url, quota_state, bytes_freed = local_dashboard(repo)
            cleanup_url, cleanup_run_url, cleanup_date = cleanup_workflow(repo)
            active_rows.extend(active_runs(repo))
            dashboard_cell = f"[dashboard]({dash_url})" if dash_url != "—" else "not onboarded"
            cleanup_cell = f"[{cleanup_date}]({cleanup_run_url})" if cleanup_run_url != "—" else "—"
            cleanup_workflow_cell = f"[workflow]({cleanup_url})" if cleanup_url != "—" else "—"
            repo_rows.append(
                f"| `{repo}` | {len(live)} | {format_mib(live_bytes)} | {quota_state} | {total_runs} | {running} | {queued} | {cleanup_cell} | {bytes_freed if bytes_freed is not None else '—'} | {dashboard_cell} | [Actions](https://github.com/{repo}/actions) · {cleanup_workflow_cell} |"
            )
        except Exception as exc:
            errors.append(f"{repo}: {exc}")
            repo_rows.append(f"| `{repo}` | error | — | UNKNOWN_ACCOUNT_CAPACITY | — | — | — | — | — | — | [Actions](https://github.com/{repo}/actions) |")

    active_md = "No active or queued runs visible to the current token."
    if active_rows:
        active_md = "\n".join(
            ["| Repository | Workflow | Branch | SHA | Run ID | Job | Current Step | Completed Steps | Total Steps | Elapsed |", "|---|---|---|---|---:|---|---|---:|---:|---|"]
            + [
                f"| `{r['repo']}` | {r['workflow']} | `{r['branch']}` | `{str(r['sha'])[:12]}` | [{r['run_id']}](https://github.com/{r['repo']}/actions/runs/{r['run_id']}) | {r['job']} | {r['step']} | {r['completed']} | {r['total']} | {r['elapsed']} |"
                for r in active_rows
            ]
        )

    credential_note = "Cross-repository authenticated discovery is available."
    if discovery_mode == "PUBLIC_OWNER_REPOSITORIES_ONLY":
        credential_note = (
            "The current workflow token could not prove full cross-repository access. Public owner repositories are shown; "
            "configure `CENTRAL_DASHBOARD_TOKEN` (or an equivalent GitHub App token) for private/all-repository coverage."
        )

    body = f"""<!-- central-actions-storage-dashboard -->
# Central GitHub Actions Storage Dashboard

Updated UTC: {NOW.isoformat().replace('+00:00','Z')}
Discovery mode: **{discovery_mode}**

{credential_note}

| Repository | Live Artifacts | Live MiB | Quota State | Total Runs | Running | Queued | Latest Cleanup | Bytes Freed | Dashboard Issue | Actions / Cleanup |
|---|---:|---:|---|---:|---:|---:|---|---:|---|---|
{chr(10).join(repo_rows) if repo_rows else '| _none visible_ | — | — | — | — | — | — | — | — | — | — |'}

## Current active runs

{active_md}

> `Completed Steps / Total Steps` is workflow progress only. It is not overall project completion percentage.

## Account quota

`ACCOUNT_QUOTA_STATUS`: **UNKNOWN_ACCOUNT_CAPACITY**

The dashboard intentionally keeps repository live artifact storage separate from account-level billing/quota accounting. No quota percentage is calculated without authoritative account capacity.

## Cross-repository access

For complete private/multi-repository aggregation, use a fine-grained credential or GitHub App installation token with only the access actually needed: Actions read, Metadata read, and Issues read for local dashboard discovery. The central host needs Issues write to update this issue. No credential value belongs in the repository.

## Update errors

{chr(10).join(f'- {e}' for e in errors) if errors else '_none_'}
"""

    request("PATCH", f"/repos/{HOST_REPO}/issues/{CENTRAL_ISSUE_NUMBER}", token=HOST_TOKEN, payload={"title": "Central GitHub Actions Storage Dashboard", "body": body, "state": "open"})
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "w", encoding="utf-8") as fh:
            fh.write(body)
    print(json.dumps({"repositories": len(repos), "active_rows": len(active_rows), "discovery_mode": discovery_mode, "errors": errors}, indent=2))
    return 1 if errors and len(errors) == len(repos) else 0


if __name__ == "__main__":
    raise SystemExit(main())
