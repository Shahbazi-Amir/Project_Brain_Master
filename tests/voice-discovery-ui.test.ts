import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("public/index.html", "utf8");
const app = readFileSync("public/app.js", "utf8");
const server = readFileSync("src/server.ts", "utf8");

test("voice UI is explicitly bounded to fifteen seconds", () => {
  assert.match(index, /گفتن ایده · ۱۵ث/);
  assert.match(app, /VOICE_LIMIT_SECONDS = 15/);
  assert.match(app, /stopAllVoice\('ضبط پایان یافت و متن ثبت شد\.'/);
});

test("idea framing can be cancelled and locks voice while running", () => {
  assert.match(index, /cancelDiscoveryBtn/);
  assert.match(app, /setIdeaLocked\(true\)/);
  assert.match(server, /\/api\/discovery\/cancel/);
  assert.match(server, /runArchitect\([^\n]+controller\.signal\)/);
});

test("static UI responses disable browser caching and use one UI implementation", () => {
  assert.doesNotMatch(index, /runtime-fixes/);
  assert.match(index, /app\.js\?v=0\.7\.0/);
  assert.match(server, /no-store, no-cache, must-revalidate/);
});