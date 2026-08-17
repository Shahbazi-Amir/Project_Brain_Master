#!/usr/bin/env python3
"""Conservative GitHub Actions artifact inventory, cleanup, and dashboard updater.

Safety model:
- unknown artifact families are preserved by default;
- active/queued run artifacts are always preserved;
- protected evidence/release families are always preserved;
- deletion requires provenance plus a newer valid replacement or a byte-identical newer copy.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"
DASHBOARD_ISSUE_NUMBER = os.environ.get("DASHBOARD_ISSUE_NUMBER", "").strip()
CENTRAL_DASHBOARD_URL = os.environ.get("CENTRAL_DASHBOARD_URL", "").strip()
NOW = datetime.now(timezone.utc)

PROTECTED_RE = re.compile(
    r"(?:^|[-_.])(release|deploy|deployment|governance|audit|evidence|proof|attestation|attest|sbom|signature|signed|production|final)(?:$|[-_.])",
    re.I,
)
TEMP_RE = re.compile(r"(?:^|[-_.])(temp|tmp|diagnostic|debug|validation|preview|render-check|scratch)(?:$|[-_.])", re.I)
QA_RE = re.compile(r"(?:^|[-_.])(qa|test|tests|coverage|lint|report|reports)(?:$|[-_.])", re.I)
BUILD_RE = re.compile(r"(?:^|[-_.])(build|package|dist|bundle)(?:$|[-_.])", re.I)
FAILED_CONCLUSIONS = {"failure", "cancelled", "timed_out", "action_required", "startup_failure"}


def request(method: str, path: str, payload: Any | None = None) -> Any:
    url = path if path.startswith("http") else f"{API}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "project-brain-actions-storage",
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
        raise RuntimeError(f"GitHub API {method} {path} failed: {exc.code} {body[:500]}") from exc


def paginate(path: str, key: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    separator = "&" if "?" in path else "?"
    while True:
        payload = request("GET", f"{path}{separator}per_page=100&page={page}")
        batch = payload.get(key, []) if isinstance(payload, dict) else []
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return items


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def age_days(artifact: dict[str, Any]) -> float:
    created = parse_time(artifact.get("created_at"))
    if not created:
        return 0.0
    return max(0.0, (NOW - created).total_seconds() / 86400)


def mib(value: int) -> str:
    return f"{value / 1024 / 1024:.2f}"


def classify_family(name: str) -> str:
    if PROTECTED_RE.search(name):
        return "protected"
    if TEMP_RE.search(name):
        return "temporary"
    if QA_RE.search(name):
        return "routine_qa"
    if BUILD_RE.search(name):
        return "build"
    return "unknown"


def retention_days(bucket: str) -> int | None:
    return {"temporary": 7, "routine_qa": 14, "build": 30}.get(bucket)


def artifact_run(artifact: dict[str, Any], runs: dict[int, dict[str, Any]]) -> dict[str, Any]:
    run_id = int((artifact.get("workflow_run") or {}).get("id") or 0)
    return runs.get(run_id, {})


def inventory() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    artifacts = paginate(f"/repos/{REPO}/actions/artifacts?", "artifacts")
    runs = paginate(f"/repos/{REPO}/actions/runs?", "workflow_runs")
    workflows = paginate(f"/repos/{REPO}/actions/workflows?", "workflows")
    return artifacts, runs, workflows


def live_metrics(artifacts: list[dict[str, Any]]) -> dict[str, int]:
    live = [a for a in artifacts if not a.get("expired")]
    expired = [a for a in artifacts if a.get("expired")]
    return {
        "records": len(artifacts),
        "live_count": len(live),
        "live_bytes": sum(int(a.get("size_in_bytes") or 0) for a in live),
        "expired_count": len(expired),
        "expired_bytes": sum(int(a.get("size_in_bytes") or 0) for a in expired),
    }


def choose_cleanup(
    artifacts: list[dict[str, Any]], runs_by_id: dict[int, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for artifact in artifacts:
        by_name[str(artifact.get("name") or "unnamed")].append(artifact)
    for values in by_name.values():
        values.sort(key=lambda a: a.get("created_at") or "", reverse=True)

    active_run_ids = {
        int(run["id"])
        for run in runs_by_id.values()
        if run.get("status") in {"in_progress", "queued", "requested", "waiting", "pending"}
    }

    candidates: list[dict[str, Any]] = []
    preserved: list[dict[str, Any]] = []

    for name, family in by_name.items():
        bucket = classify_family(name)
        newer_success = next(
            (
                artifact
                for artifact in family
                if not artifact.get("expired")
                and artifact_run(artifact, runs_by_id).get("conclusion") == "success"
            ),
            None,
        )
        digest_first: dict[str, int] = {}
        for artifact in family:
            digest = str(artifact.get("digest") or "")
            if digest and digest not in digest_first:
                digest_first[digest] = int(artifact["id"])

        for index, artifact in enumerate(family):
            run = artifact_run(artifact, runs_by_id)
            run_id = int((artifact.get("workflow_run") or {}).get("id") or 0)
            artifact_id = int(artifact["id"])
            reason = ""

            if run_id in active_run_ids:
                reason = "active-or-queued-run"
            elif bucket == "protected":
                reason = "protected-release-or-evidence-family"
            elif len(family) == 1:
                reason = "only-surviving-family-copy"
            elif newer_success and artifact_id == int(newer_success["id"]):
                reason = "latest-valid-successful-family-copy"
            elif bucket == "unknown":
                reason = "unknown-family-preserved-by-default"
            else:
                digest = str(artifact.get("digest") or "")
                duplicate_of_newer = bool(digest and digest_first.get(digest) != artifact_id)
                has_newer_valid = bool(newer_success and artifact_id != int(newer_success["id"]))
                conclusion = str(run.get("conclusion") or "")
                days = age_days(artifact)
                limit = retention_days(bucket)

                if duplicate_of_newer:
                    candidates.append({"artifact": artifact, "reason": "older-byte-identical-duplicate", "bucket": bucket})
                    continue
                if artifact.get("expired") and has_newer_valid:
                    candidates.append({"artifact": artifact, "reason": "expired-with-newer-valid-copy", "bucket": bucket})
                    continue
                if conclusion in FAILED_CONCLUSIONS and has_newer_valid and days >= 3:
                    candidates.append({"artifact": artifact, "reason": f"obsolete-{conclusion}-run-artifact", "bucket": bucket})
                    continue
                if limit is not None and has_newer_valid and days >= limit and index >= 1:
                    candidates.append({"artifact": artifact, "reason": f"superseded-{bucket}-older-than-{limit}d", "bucket": bucket})
                    continue
                reason = "within-retention-or-no-proven-replacement"

            preserved.append({"artifact": artifact, "reason": reason, "bucket": bucket})

    return candidates, preserved


def family_rows(artifacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for artifact in artifacts:
        groups[str(artifact.get("name") or "unnamed")].append(artifact)
    rows = []
    for name, values in groups.items():
        values.sort(key=lambda a: a.get("created_at") or "")
        rows.append(
            {
                "name": name,
                "count": len(values),
                "bytes": sum(int(a.get("size_in_bytes") or 0) for a in values if not a.get("expired")),
                "oldest_run": int((values[0].get("workflow_run") or {}).get("id") or 0),
                "latest_run": int((values[-1].get("workflow_run") or {}).get("id") or 0),
            }
        )
    return sorted(rows, key=lambda row: row["bytes"], reverse=True)


def active_run_details(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for run in runs:
        if run.get("status") not in {"in_progress", "queued", "requested", "waiting", "pending"}:
            continue
        jobs_payload = request("GET", f"/repos/{REPO}/actions/runs/{run['id']}/jobs?per_page=100")
        jobs = jobs_payload.get("jobs", []) if isinstance(jobs_payload, dict) else []
        if not jobs:
            rows.append(
                {
                    "workflow": run.get("name") or "—",
                    "branch": run.get("head_branch") or "—",
                    "sha": run.get("head_sha") or "—",
                    "run_id": run["id"],
                    "job": "queued",
                    "current_step": "waiting for job",
                    "completed_steps": 0,
                    "total_steps": 0,
                    "elapsed": elapsed(run.get("run_started_at") or run.get("created_at")),
                }
            )
            continue
        for job in jobs:
            steps = job.get("steps") or []
            current = next((s for s in steps if s.get("status") == "in_progress"), None)
            rows.append(
                {
                    "workflow": run.get("name") or "—",
                    "branch": run.get("head_branch") or "—",
                    "sha": run.get("head_sha") or "—",
                    "run_id": run["id"],
                    "job": job.get("name") or "—",
                    "current_step": (current or {}).get("name") or ("queued" if job.get("status") == "queued" else job.get("status") or "—"),
                    "completed_steps": sum(1 for s in steps if s.get("status") == "completed"),
                    "total_steps": len(steps),
                    "elapsed": elapsed(job.get("started_at") or run.get("run_started_at") or run.get("created_at")),
                }
            )
    return rows


def elapsed(value: str | None) -> str:
    start = parse_time(value)
    if not start:
        return "—"
    seconds = max(0, int((NOW - start).total_seconds()))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def dashboard_issue() -> int:
    if DASHBOARD_ISSUE_NUMBER:
        return int(DASHBOARD_ISSUE_NUMBER)
    payload = request("GET", f"/repos/{REPO}/issues?state=all&per_page=100")
    for issue in payload:
        if issue.get("pull_request"):
            continue
        if "<!-- artifact-storage-dashboard -->" in str(issue.get("body") or "") or str(issue.get("title") or "").startswith("Artifact Storage Dashboard —"):
            return int(issue["number"])
    created = request(
        "POST",
        f"/repos/{REPO}/issues",
        {"title": "Artifact Storage Dashboard — initializing", "body": "<!-- artifact-storage-dashboard -->\nInitializing…"},
    )
    return int(created["number"])


def artifact_table(entries: list[dict[str, Any]], limit: int = 80) -> str:
    if not entries:
        return "_none_"
    lines = ["| ID | Name | MiB | Run | Branch | SHA | Reason |", "|---:|---|---:|---:|---|---|---|"]
    for entry in entries[:limit]:
        artifact = entry["artifact"]
        wr = artifact.get("workflow_run") or {}
        lines.append(
            f"| {artifact['id']} | `{artifact.get('name','')}` | {mib(int(artifact.get('size_in_bytes') or 0))} | {wr.get('id','—')} | `{wr.get('head_branch','—')}` | `{str(wr.get('head_sha','—'))[:12]}` | {entry.get('reason','—')} |"
        )
    if len(entries) > limit:
        lines.append(f"\n_... {len(entries) - limit} more entries omitted from issue display; runner summary retains counts._")
    return "\n".join(lines)


def build_dashboard(
    before_artifacts: list[dict[str, Any]],
    after_artifacts: list[dict[str, Any]],
    runs: list[dict[str, Any]],
    workflows: list[dict[str, Any]],
    deleted: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    preserved: list[dict[str, Any]],
    errors: list[str],
) -> tuple[str, str]:
    before = live_metrics(before_artifacts)
    after = live_metrics(after_artifacts)
    freed = max(0, before["live_bytes"] - after["live_bytes"])
    active = active_run_details(runs)
    completed = [r for r in runs if r.get("status") == "completed"]
    latest = completed[:5]
    families = family_rows(after_artifacts)
    quota_state = "CLEANUP_RECOMMENDED" if candidates and DRY_RUN else "NORMAL"
    if errors:
        quota_state = "HIGH_USAGE" if after["live_bytes"] else "NORMAL"

    family_md = "_none_"
    if families:
        family_md = "\n".join(
            ["| Artifact family | Count | Live MiB | Latest run | Oldest run |", "|---|---:|---:|---:|---:|"]
            + [f"| `{row['name']}` | {row['count']} | {mib(row['bytes'])} | {row['latest_run']} | {row['oldest_run']} |" for row in families[:20]]
        )

    latest_md = "_none_" if not latest else "\n".join(
        f"- [{r.get('name','workflow')} run {r['id']}]({r.get('html_url')}) — `{r.get('conclusion')}` on `{r.get('head_branch')}` @ `{str(r.get('head_sha'))[:12]}`"
        for r in latest
    )

    active_md = "No in-progress or queued runs."
    if active:
        active_md = "\n".join(
            ["| Workflow | Branch | SHA | Run ID | Job | Current step | Steps | Elapsed |", "|---|---|---|---:|---|---|---:|---|"]
            + [
                f"| {row['workflow']} | `{row['branch']}` | `{str(row['sha'])[:12]}` | [{row['run_id']}](https://github.com/{REPO}/actions/runs/{row['run_id']}) | {row['job']} | {row['current_step']} | {row['completed_steps']} / {row['total_steps']} | {row['elapsed']} |"
                for row in active
            ]
        )

    central = f"[Central dashboard]({CENTRAL_DASHBOARD_URL})" if CENTRAL_DASHBOARD_URL else "Central dashboard URL not configured yet."
    cleanup_run = os.environ.get("GITHUB_RUN_ID", "—")
    cleanup_url = f"https://github.com/{REPO}/actions/runs/{cleanup_run}" if cleanup_run != "—" else "—"

    body = f"""<!-- artifact-storage-dashboard -->
# Artifact Storage Dashboard

Updated UTC: {NOW.isoformat().replace('+00:00','Z')}
Repository: `{REPO}`

## Storage

- Total artifact records: **{after['records']}**
- Live artifact count: **{after['live_count']}**
- Live artifact bytes: **{after['live_bytes']}**
- Live artifact MiB: **{mib(after['live_bytes'])}**
- Expired artifacts: **{after['expired_count']} / {after['expired_bytes']} bytes**
- Storage freed by last cleanup: **{freed} bytes ({mib(freed)} MiB)**

### Largest artifact families

{family_md}

`REPOSITORY_LIVE_ARTIFACT_STORAGE` is repository-local. It is not the entire account usage.

## Workflow activity

- Active workflows: **{sum(1 for w in workflows if w.get('state') == 'active')}**
- Total workflow runs: **{len(runs)}**
- In progress: **{sum(1 for r in runs if r.get('status') == 'in_progress')}**
- Queued: **{sum(1 for r in runs if r.get('status') == 'queued')}**
- Completed: **{sum(1 for r in runs if r.get('status') == 'completed')}**

### Latest completed runs

{latest_md}

## Current active runs

{active_md}

> `completed steps / total steps` is workflow progress only, not overall project progress.

## Cleanup

- Last cleanup date: **{NOW.date().isoformat()}**
- Cleanup run: **[{cleanup_run}]({cleanup_url})**
- Mode: **{'DRY_RUN' if DRY_RUN else 'APPLY'}**
- Artifacts before: **{before['live_count']}**
- Bytes before: **{before['live_bytes']}**
- Artifacts deleted: **{len(deleted)}**
- Bytes freed: **{freed}**
- Artifacts after: **{after['live_count']}**
- Bytes after: **{after['live_bytes']}**
- Safe-to-delete candidates seen: **{len(candidates)}**
- Artifacts preserved by policy: **{len(preserved)}**
- Cleanup errors: **{len(errors)}**

<details><summary>Deleted artifacts</summary>

{artifact_table(deleted)}
</details>

<details><summary>Preserved artifacts</summary>

{artifact_table(preserved)}
</details>

<details><summary>Cleanup errors</summary>

{chr(10).join(f'- {e}' for e in errors) if errors else '_none_'}
</details>

## Quota state

- Repository quota state: **{quota_state}**
- `ACCOUNT_QUOTA_STATUS`: **UNKNOWN_ACCOUNT_CAPACITY**
- Capacity percentage: **not calculated** (authoritative account plan/quota not available to this repository-local workflow).
- GitHub billing/quota accounting can lag repository artifact API state; a lower live-byte count does not imply immediate billing refresh.

## Central dashboard

{central}

## Retention policy

- protected release/deployment/governance/audit/evidence families: **preserve**
- active/queued runs: **preserve**
- only surviving family copy: **preserve**
- unknown family: **preserve by default**
- temporary/diagnostic family: candidate only after **7 days** and only with a newer valid replacement
- routine QA family: candidate only after **14 days** and only with a newer valid replacement
- build/package family: candidate only after **30 days** and only with a newer valid replacement
- failed/cancelled artifacts: candidate after **3 days** only when a newer valid same-family copy exists
- byte-identical older duplicate: candidate when a newer same-family copy exists

Workflow run history is **not** deleted by this cleanup.
"""
    title = f"Artifact Storage Dashboard — {mib(after['live_bytes'])} MiB live / {after['live_count']} artifacts"
    return title, body


def write_summary(title: str, body: str) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    Path(summary_path).write_text(f"# {title}\n\n{body}\n", encoding="utf-8")


def main() -> int:
    before_artifacts, runs, workflows = inventory()
    runs_by_id = {int(r["id"]): r for r in runs}
    candidates, preserved = choose_cleanup(before_artifacts, runs_by_id)
    deleted: list[dict[str, Any]] = []
    errors: list[str] = []

    if not DRY_RUN:
        for entry in candidates:
            artifact = entry["artifact"]
            try:
                request("DELETE", f"/repos/{REPO}/actions/artifacts/{artifact['id']}")
                deleted.append(entry)
            except Exception as exc:  # keep processing but surface every failure
                errors.append(f"artifact {artifact['id']} ({artifact.get('name')}): {exc}")

    after_artifacts = paginate(f"/repos/{REPO}/actions/artifacts?", "artifacts")
    title, body = build_dashboard(before_artifacts, after_artifacts, runs, workflows, deleted, candidates, preserved, errors)
    issue_number = dashboard_issue()
    request("PATCH", f"/repos/{REPO}/issues/{issue_number}", {"title": title, "body": body, "state": "open"})
    write_summary(title, body)

    evidence = {
        "repository": REPO,
        "dry_run": DRY_RUN,
        "artifacts_before": live_metrics(before_artifacts),
        "artifacts_after": live_metrics(after_artifacts),
        "candidate_ids": [int(e["artifact"]["id"]) for e in candidates],
        "deleted_ids": [int(e["artifact"]["id"]) for e in deleted],
        "preserved_ids": [int(e["artifact"]["id"]) for e in preserved],
        "errors": errors,
        "dashboard_issue": issue_number,
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
