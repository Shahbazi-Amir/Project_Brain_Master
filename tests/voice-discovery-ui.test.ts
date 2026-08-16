import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("public/index.html", "utf8");
const runtime = readFileSync("public/runtime-fixes.js", "utf8");
const server = readFileSync("src/server.ts", "utf8");

test("voice UI is explicitly bounded to fifteen seconds", () => {
  assert.match(index, /گفتن ایده · ۱۵ث/);
  assert.match(runtime, /VOICE_LIMIT_SECONDS = 15/);
  assert.match(runtime, /stopAllVoice\('ضبط پایان یافت و متن ثبت شد\.'/);
});

test("idea framing can be cancelled and locks voice while running", () => {
  assert.match(runtime, /cancelDiscoveryBtn/);
  assert.match(runtime, /ideaVoiceBtn/);
  assert.match(runtime, /setDiscoveryLocked\(true\)/);
  assert.match(server, /\/api\/discovery\/cancel/);
  assert.match(server, /runArchitect\([^\n]+controller\.signal\)/);
});

test("static UI responses disable browser caching", () => {
  assert.match(index, /runtime-fixes\.js\?v=0\.4\.1/);
  assert.match(index, /app\.js\?v=0\.4\.1/);
  assert.match(server, /no-store, no-cache, must-revalidate/);
});
