import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const cleanupWorkflow = readFileSync(".github/workflows/actions-artifact-retention.yml", "utf8");
const cleanupScript = readFileSync(".github/scripts/actions_artifact_retention.py", "utf8");
const controlCenter = readFileSync("tools/github-control-center/server.mjs", "utf8");
const startAll = readFileSync("tools/start-all.mjs", "utf8");
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

test("local control center covers account inventory, alerts and safe cleanup", () => {
  assert.match(controlCenter, /\/user\/repos\?affiliation=owner/);
  assert.match(controlCenter, /actions\/artifacts/);
  assert.match(controlCenter, /actions\/caches/);
  assert.match(controlCenter, /actions\/runs/);
  assert.match(controlCenter, /settings\/billing\/usage/);
  assert.match(controlCenter, /Repo اکنون اجرای فعال\/صف‌شده دارد/);
  assert.match(controlCenter, /CLEANUP_PREVIEW_TTL_MS/);
  assert.match(controlCenter, /پاکسازی موارد امن/);
  assert.doesNotMatch(controlCenter, /actions\/runs\/\$\{item\.id\}/);
});

test("npm start launches Project Brain and GitHub Control Center together", () => {
  assert.equal(pkg.version, "0.6.0");
  assert.equal(pkg.scripts.start, "node tools/start-all.mjs");
  assert.equal(pkg.scripts["github:ops"], "node tools/github-control-center/server.mjs");
  assert.match(startAll, /src\/server\.ts/);
  assert.match(startAll, /github-control-center\/server\.mjs/);
});
