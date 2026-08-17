import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cleanupWorkflow = readFileSync(".github/workflows/actions-artifact-retention.yml", "utf8");
const cleanupScript = readFileSync(".github/scripts/actions_artifact_retention.py", "utf8");
const centralWorkflow = readFileSync(".github/workflows/actions-storage-central-dashboard.yml", "utf8");
const centralScript = readFileSync(".github/scripts/actions_storage_central_dashboard.py", "utf8");
const metadata = JSON.parse(readFileSync(".github/actions-storage-monitoring.json", "utf8"));

test("cleanup workflow is scheduled, dispatchable, serialized and minimally permissioned", () => {
  assert.match(cleanupWorkflow, /workflow_dispatch:/);
  assert.match(cleanupWorkflow, /schedule:/);
  assert.match(cleanupWorkflow, /actions: write/);
  assert.match(cleanupWorkflow, /issues: write/);
  assert.match(cleanupWorkflow, /contents: read/);
  assert.match(cleanupWorkflow, /concurrency:/);
  assert.match(cleanupWorkflow, /cancel-in-progress: false/);
});

test("cleanup policy preserves ambiguous and important provenance by default", () => {
  assert.match(cleanupScript, /return "unknown"/);
  assert.match(cleanupScript, /unknown-family-preserved-by-default/);
  assert.match(cleanupScript, /active-or-queued-run/);
  assert.match(cleanupScript, /only-surviving-family-copy/);
  assert.match(cleanupScript, /latest-valid-successful-family-copy/);
  assert.match(cleanupScript, /protected-release-or-evidence-family/);
});

test("cleanup deletes artifacts only and never prunes workflow run history", () => {
  assert.match(cleanupScript, /actions\/artifacts\/\{artifact\['id'\]\}/);
  assert.doesNotMatch(cleanupScript, /request\("DELETE",\s*f"\/repos\/\{REPO\}\/actions\/runs/);
});

test("central dashboard discovers repositories dynamically and supports scoped cross-repo auth", () => {
  assert.match(centralWorkflow, /CENTRAL_DASHBOARD_TOKEN/);
  assert.match(centralScript, /\/user\/repos\?affiliation=/);
  assert.match(centralScript, /PUBLIC_OWNER_REPOSITORIES_ONLY/);
  assert.doesNotMatch(centralScript, /Book_Production|IRMA|Self-Structuring-Object-Cognition|vid_pipeline|Political|devfix_for_macintel/);
});

test("integration metadata keeps repository and account quota concepts separate", () => {
  assert.equal(metadata.quota.repository_metric, "REPOSITORY_LIVE_ARTIFACT_STORAGE");
  assert.equal(metadata.quota.account_metric, "ACCOUNT_QUOTA_STATUS");
  assert.equal(metadata.quota.account_capacity, "UNKNOWN_ACCOUNT_CAPACITY");
  assert.equal(metadata.local_dashboard.issue_number, 10);
  assert.equal(metadata.central_dashboard.issue_number, 11);
});
