import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["src/server.ts"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["tools/github-control-center/server.mjs"], { stdio: "inherit", env: process.env })
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (code === 0 || signal) return;
    console.error(`A Project Brain service exited unexpectedly (${code ?? signal}).`);
    stop();
    process.exitCode = code || 1;
  });
}

process.on("SIGINT", () => { stop("SIGINT"); });
process.on("SIGTERM", () => { stop("SIGTERM"); });
