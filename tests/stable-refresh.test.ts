import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("public/index.html", "utf8");
const guard = readFileSync("public/stable-project-refresh.js", "utf8");

test("project polling no longer replaces the whole project page every three seconds", () => {
  const guardIndex = html.indexOf("stable-project-refresh.js");
  const appIndex = html.indexOf("app.js");
  assert.ok(guardIndex >= 0 && appIndex > guardIndex);
  assert.match(guard, /source\.includes\('renderProject\(\)'\)/);
  assert.match(guard, /lightweightProjectRefresh/);
  assert.match(guard, /\.project-hero \.pill/);
});
