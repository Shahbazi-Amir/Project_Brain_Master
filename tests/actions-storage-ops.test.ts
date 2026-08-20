import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const cleanupWorkflow = readFileSync(".github/workflows/actions-artifact-retention.yml", "utf8");
const cleanupScript = readFileSync(".github/scripts/actions_artifact_retention.py", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("repository cleanup workflow is manual-only", () => {
  assert.match(cleanupWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(cleanupWorkflow, /schedule:/);
  assert.doesNotMatch(cleanupWorkflow, /\npush:/);
  assert.match(cleanupWorkflow, /actions: write/);
  assert.match(cleanupWorkflow, /cancel-in-progress: false/);
});

test("legacy Actions-powered live dashboards are disabled", () => {
  assert.equal(existsSync(".github/workflows/actions-storage-monitor.yml"), false);
  assert.equal(existsSync(".github/workflows/actions-storage-central-dashboard.yml"), false);
});

test("cleanup policy preserves ambiguous and important provenance by default", () => {
  assert.match(cleanupScript, /unknown-family-preserved-by-default/);
  assert.match(cleanupScript, /active-or-queued-run/);
  assert.match(cleanupScript, /only-surviving-family-copy/);
  assert.match(cleanupScript, /latest-valid-successful-family-copy/);
  assert.match(cleanupScript, /protected-release-or-evidence-family/);
  assert.doesNotMatch(cleanupScript, /request\("DELETE",\s*f"\/repos\/\{REPO\}\/actions\/runs/);
});

test("Project Brain no longer embeds GitHub Control Center runtime", () => {
  assert.equal(existsSync("tools/github-control-center/server.mjs"), false);
  assert.equal(existsSync("tools/start-all.mjs"), false);
  assert.equal(pkg.version, "0.8.1");
  assert.equal(pkg.scripts.start, "node src/server.ts");
  assert.equal(pkg.scripts["github:ops"], undefined);
  assert.equal(pkg.scripts["check:github-ops"], undefined);
});