#!/usr/bin/env python3
"""Refresh repository-local Actions storage/activity dashboard without cleanup.

This monitor deliberately does not delete artifacts. It preserves the Cleanup section
written by the retention workflow and refreshes storage/activity after monitored runs
finish so the dashboard does not remain stuck on an in-progress snapshot.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
ISSUE_NUMBER = int(os.environ.get("DASHBOARD_ISSUE_NUMBER", "10"))
CURRENT_RUN_ID = int(os.environ.get("GITHUB_RUN_ID", "0") or 0)
NOW = datetime.now(timezone.utc)


def request(method: str, path: str, payload: Any | None = None) -> Any:
    url = path if path.startswith("http") else f"{API}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "project-brain-actions-storage-monitor",
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


def paginate(path: str, key: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 1
    separator = "&" if "?" in path else "?"
    while True:
        payload = request("GET", f"{path}{separator}per_page=100&page={page}")
        batch = payload.get(key, []) if isinstance(payload, dict) else []
        rows.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return rows


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def elapsed(value: str | None) -> str:
    start = parse_time(value)
    if not start:
        return "—"
    seconds = max(0, int((NOW - start).total_seconds()))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def mib(value: int) -> str:
    return f"{value / 1024 / 1024:.2f}"


def storage_section(artifacts: list[dict[str, Any]]) -> str:
    live = [a for a in artifacts if not a.get("expired")]
    expired = [a for a in artifacts if a.get("expired")]
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for artifact in live:
        groups[str(artifact.get("name") or "unnamed")].append(artifact)
    family_rows = sorted(
        (
            (
                name,
                len(values),
                sum(int(v.get("size_in_bytes") or 0) for v in values),
                max((int((v.get("workflow_run") or {}).get("id") or 0) for v in values), default=0),
                min((int((v.get("workflow_run") or {}).get("id") or 0) for v in values), default=0),
            )
            for name, values in groups.items()
        ),
        key=lambda row: row[2],
        reverse=True,
    )
    family_md = "_none_"
    if family_rows:
        family_md = "\n".join(
            ["| Artifact family | Count | Live MiB | Latest run | Oldest run |", "|---|---:|---:|---:|---:|"]
            + [f"| `{name}` | {count} | {mib(size)} | {latest} | {oldest} |" for name, count, size, latest, oldest in family_rows[:20]]
        )
    live_bytes = sum(int(a.get("size_in_bytes") or 0) for a in live)
    expired_bytes = sum(int(a.get("size_in_bytes") or 0) for a in expired)
    return f"""## Storage

- Total artifact records: **{len(artifacts)}**
- Live artifact count: **{len(live)}**
- Live artifact bytes: **{live_bytes}**
- Live artifact MiB: **{mib(live_bytes)}**
- Expired artifacts: **{len(expired)} / {expired_bytes} bytes**

### Largest artifact families

{family_md}

`REPOSITORY_LIVE_ARTIFACT_STORAGE` is repository-local. It is not the entire account usage.
"""


def active_run_rows(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for run in runs:
        if int(run.get("id") or 0) == CURRENT_RUN_ID:
            continue
        if run.get("status") not in {"in_progress", "queued", "requested", "waiting", "pending"}:
            continue
        jobs_payload = request("GET", f"/repos/{REPO}/actions/runs/{run['id']}/jobs?per_page=100")
        jobs = jobs_payload.get("jobs", []) if isinstance(jobs_payload, dict) else []
        if not jobs:
            rows.append({
                "workflow": run.get("name") or "—", "branch": run.get("head_branch") or "—", "sha": run.get("head_sha") or "—",
                "run_id": run["id"], "job": "queued", "step": "waiting for job", "completed": 0, "total": 0,
                "elapsed": elapsed(run.get("run_started_at") or run.get("created_at")),
            })
            continue
        for job in jobs:
            steps = job.get("steps") or []
            current = next((s for s in steps if s.get("status") == "in_progress"), None)
            rows.append({
                "workflow": run.get("name") or "—", "branch": run.get("head_branch") or "—", "sha": run.get("head_sha") or "—",
                "run_id": run["id"], "job": job.get("name") or "—", "step": (current or {}).get("name") or job.get("status") or "—",
                "completed": sum(1 for s in steps if s.get("status") == "completed"), "total": len(steps),
                "elapsed": elapsed(job.get("started_at") or run.get("run_started_at") or run.get("created_at")),
            })
    return rows


def workflow_sections(runs: list[dict[str, Any]], workflows: list[dict[str, Any]]) -> tuple[str, str]:
    completed = [r for r in runs if r.get("status") == "completed"]
    latest_md = "_none_" if not completed else "\n".join(
        f"- [{r.get('name','workflow')} run {r['id']}]({r.get('html_url')}) — `{r.get('conclusion')}` on `{r.get('head_branch')}` @ `{str(r.get('head_sha'))[:12]}`"
        for r in completed[:5]
    )
    activity = f"""## Workflow activity

- Active workflows: **{sum(1 for w in workflows if w.get('state') == 'active')}**
- Total workflow runs: **{len(runs)}**
- In progress: **{sum(1 for r in runs if r.get('status') == 'in_progress' and int(r.get('id') or 0) != CURRENT_RUN_ID)}**
- Queued: **{sum(1 for r in runs if r.get('status') == 'queued' and int(r.get('id') or 0) != CURRENT_RUN_ID)}**
- Completed: **{sum(1 for r in runs if r.get('status') == 'completed')}**

### Latest completed runs

{latest_md}
"""

    active = active_run_rows(runs)
    active_md = "No in-progress or queued runs."
    if active:
        active_md = "\n".join(
            ["| Workflow | Branch | SHA | Run ID | Job | Current step | Steps | Elapsed |", "|---|---|---|---:|---|---|---:|---|"]
            + [
                f"| {r['workflow']} | `{r['branch']}` | `{str(r['sha'])[:12]}` | [{r['run_id']}](https://github.com/{REPO}/actions/runs/{r['run_id']}) | {r['job']} | {r['step']} | {r['completed']} / {r['total']} | {r['elapsed']} |"
                for r in active
            ]
        )
    current = f"""## Current active runs

{active_md}

> `completed steps / total steps` is workflow progress only, not overall project progress.
"""
    return activity, current


def replace_section(body: str, heading: str, next_heading: str, replacement: str) -> str:
    pattern = re.compile(rf"{re.escape(heading)}\n.*?(?=\n{re.escape(next_heading)}\n)", re.S)
    if not pattern.search(body):
        raise RuntimeError(f"dashboard section missing: {heading}")
    return pattern.sub(replacement.rstrip() + "\n", body, count=1)


def main() -> int:
    # Compute fresh metrics first. These calls can take long enough for the retention
    # workflow to update the same issue, so we intentionally do NOT hold an old issue
    # body while collecting activity.
    artifacts = paginate(f"/repos/{REPO}/actions/artifacts?", "artifacts")
    runs = paginate(f"/repos/{REPO}/actions/runs?", "workflow_runs")
    workflows = paginate(f"/repos/{REPO}/actions/workflows?", "workflows")
    storage = storage_section(artifacts)
    activity, current = workflow_sections(runs, workflows)

    # Re-fetch immediately before PATCH. Only our three monitoring sections are
    # replaced; a newer Cleanup section written concurrently is therefore preserved.
    issue = request("GET", f"/repos/{REPO}/issues/{ISSUE_NUMBER}")
    body = str(issue.get("body") or "")
    body = re.sub(r"Updated UTC: .*", f"Updated UTC: {NOW.isoformat().replace('+00:00','Z')}", body, count=1)
    body = replace_section(body, "## Storage", "## Workflow activity", storage)
    body = replace_section(body, "## Workflow activity", "## Current active runs", activity)
    body = replace_section(body, "## Current active runs", "## Cleanup", current)

    live = [a for a in artifacts if not a.get("expired")]
    live_bytes = sum(int(a.get("size_in_bytes") or 0) for a in live)
    title = f"Artifact Storage Dashboard — {mib(live_bytes)} MiB live / {len(live)} artifacts"
    request("PATCH", f"/repos/{REPO}/issues/{ISSUE_NUMBER}", {"title": title, "body": body, "state": "open"})

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "w", encoding="utf-8") as fh:
            fh.write(body)
    print(json.dumps({"repository": REPO, "artifacts": len(artifacts), "runs": len(runs), "dashboard_issue": ISSUE_NUMBER}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
