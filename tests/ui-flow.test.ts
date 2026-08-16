import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("public/app.js", "utf8");
const html = readFileSync("public/index.html", "utf8");
const css = readFileSync("public/ui-v2.css", "utf8");

test("voice is one hard 15 second implementation without runtime overlay", () => {
  assert.match(app, /VOICE_LIMIT_SECONDS = 15/);
  assert.match(html, /گفتن ایده · ۱۵ث/);
  assert.doesNotMatch(html, /runtime-fixes/);
  assert.doesNotMatch(app, /۳۰ث|30\s*ثانیه/);
});

test("idea framing locks inputs and exposes a real cancel action", () => {
  assert.match(app, /setIdeaLocked\(true\)/);
  assert.match(app, /\/api\/discovery\/cancel/);
  assert.match(html, /id="cancelDiscoveryBtn"/);
});

test("final contract is directly editable and create is not gated by stale open decisions", () => {
  for (const id of ["finalName", "finalGoal", "finalOutcome", "finalFeatures", "finalStrategy", "finalFormats", "finalWorkspace"]) {
    assert.match(app, new RegExp(`id=\\"${id}\\"`));
  }
  assert.match(app, /id="saveEditsBtn"/);
  assert.match(app, /id="createProjectBtn" class="primary large final-create" type="button"/);
  assert.match(app, /definition\.humanDecisionsRequired = \[\]/);
});

test("compact RTL layout keeps sidebar on the right and choices linear", () => {
  assert.match(css, /shell>aside\{grid-column:2!important/);
  assert.match(css, /choice-line\{display:flex!important/);
  assert.match(css, /choice-check\{display:inline-flex!important/);
});

test("default UI does not surface privacy or legal review sections", () => {
  const visible = `${app}\n${html}`;
  assert.doesNotMatch(visible, /حریم خصوصی|حق نشر|مجوز حقوقی/);
});
