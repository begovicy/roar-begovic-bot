import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
let n = 0;
function walk(p) {
  for (const f of readdirSync(p, { withFileTypes: true })) {
    const q = join(p, f.name);
    if (f.isDirectory()) walk(q);
    else if (q.endsWith(".mjs")) {
      const r = spawnSync(process.execPath, ["--check", q], {
        encoding: "utf8",
      });
      if (r.status) {
        console.error(r.stderr);
        process.exit(1);
      }
      n++;
    }
  }
}
for (const p of ["src", "scripts", "tests"]) walk(p);
console.log(`${n} JavaScript dosyası sözdizimi kontrolünü geçti.`);
