import { spawn } from "node:child_process";
const roles = [
  "voucher",
  "manager",
  "main",
  "economy",
  "statistics",
  "guard",
  "moderation",
];
const children = roles.map((r) =>
  spawn(process.execPath, ["src/app.mjs", r], { stdio: "inherit" }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const c of children)
  c.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
