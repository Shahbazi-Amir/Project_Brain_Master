import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertNoSuspiciousSecrets, assertSafeBranch, assertSafeChangedPaths, makeBrainBranch, normalizeGitHubRepository } from "../src/github-workspace.ts";

const githubRuntime = readFileSync("src/github-workspace.ts", "utf8");
const loop = readFileSync("src/loop.ts", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const html = readFileSync("public/index.html", "utf8");
const ui = readFileSync("public/github-integration.js", "utf8");

test("GitHub repository input is normalized without shell syntax", () => {
  assert.equal(normalizeGitHubRepository("https://github.com/Shahbazi-Amir/demo.git"), "Shahbazi-Amir/demo");
  assert.throws(() => normalizeGitHubRepository("owner/repo; rm -rf /"));
});

test("Project Brain only creates dedicated brain branches", () => {
  const branch = makeBrainBranch("12345678-abcd", "My Project");
  assert.match(branch, /^brain\/12345678-/);
  assert.doesNotThrow(() => assertSafeBranch(branch));
  assert.throws(() => assertSafeBranch("main"));
  assert.throws(() => assertSafeBranch("feature/test"));
});

test("sensitive paths and obvious secrets stop delivery", () => {
  assert.throws(() => assertSafeChangedPaths([".env"]));
  assert.throws(() => assertSafeChangedPaths(["keys/private.pem"]));
  assert.throws(() => assertNoSuspiciousSecrets("GITHUB_TOKEN=secret-value-123456"));
  assert.doesNotThrow(() => assertSafeChangedPaths(["src/app.ts", "README.md"]));
});

test("runtime disables executor push and protects non-brain remote refs", () => {
  assert.match(githubRuntime, /project-brain-push-disabled/);
  assert.match(githubRuntime, /refs\/heads\/brain\/\*/);
  assert.match(githubRuntime, /remote\.origin\.pushurl/);
  assert.doesNotMatch(githubRuntime, /--force|force-with-lease/);
});

test("reviewed PASS checkpoints are the only automatic commit and push path", () => {
  assert.match(loop, /review\.status !== "PASS"/);
  assert.match(loop, /checkpointGitHub/);
  assert.match(loop, /ensureDraftPullRequest/);
  assert.match(githubRuntime, /brain: checkpoint/);
  assert.match(githubRuntime, /"--draft"/);
  assert.doesNotMatch(githubRuntime, /gh[^\n]+pr[^\n]+merge/);
});

test("project creation can opt into isolated GitHub workspace and UI exposes it", () => {
  assert.match(server, /githubRepository/);
  assert.match(server, /prepareGitHubWorkspace/);
  assert.match(html, /github-integration\.js\?v=0\.8\.0/);
  assert.match(ui, /finalGitHubRepo/);
  assert.match(ui, /Branch امن/);
});
