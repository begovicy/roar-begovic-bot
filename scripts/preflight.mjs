import fs from "node:fs";
import { config } from "../src/core/config.mjs";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
let errors = 0;
const check = (ok, label) => {
  console.log((ok ? "OK  " : "FAIL ") + label);
  if (!ok) errors++;
};
const roles = ["voucher", "manager", "main", "economy", "statistics", "guard", "moderation"];
let c;
try {
  c = config({ requireSecrets: false });
  check(true, "Yapılandırma biçimi");
} catch (e) {
  check(false, e.message);
}
const version = process.versions.node.split(".").map(Number);
check(
  version[0] > 22 || (version[0] === 22 && version[1] >= 12),
  "Node >=22.12",
);
for (const d of ["discord.js", "mongodb", "sharp"]) {
  try {
    import.meta.resolve(d);
    check(true, d + " yüklü");
  } catch {
    check(false, d + " eksik — npm install çalıştırın");
  }
}
check(fs.existsSync(".env"), ".env yerel ortamda mevcut");
check(fs.existsSync("config.json"), "config.json mevcut");
const tokens = roles.map((r) => process.env[r.toUpperCase() + "_TOKEN"]);
check(
  tokens.every(Boolean) && new Set(tokens).size === 4,
  "Dört farklı bot tokeni tanımlı (değerler gösterilmez)",
);
check(/^\d{17,20}$/.test(c?.guildId || ""), "GUILD_ID");
check(!!c?.owners.length, "OWNER_IDS");
check(!!c?.uri, "MONGODB_URI");
for (const key of [
  "privateRoomLobbyId",
  "jailRoleId",
  "textMuteRoleId",
  "registeredRoleId",
])
  console.log(
    (c?.[key] ? "OK  " : "INFO ") +
      key +
      (c?.[key] ? " ayarlı" : " boş — ilgili özellik kurulmamış"),
  );
if (process.argv.includes("--online") && !errors) {
  for (let i = 0; i < roles.length; i++) {
    try {
      const r = await fetch("https:" + "//discord.com/api/v10/users/@me", {
        headers: { Authorization: "Bot " + tokens[i] },
        signal: AbortSignal.timeout(10000),
      });
      check(r.ok, roles[i] + " token HTTP " + r.status);
      if (r.ok) {
        const user = await r.json();
        const g = await fetch(
          "https:" +
            "//discord.com/api/v10/guilds/" +
            c.guildId +
            "/members/" +
            user.id,
          {
            headers: { Authorization: "Bot " + tokens[i] },
            signal: AbortSignal.timeout(10000),
          },
        );
        check(g.ok, roles[i] + " hedef sunucu üyeliği HTTP " + g.status);
      }
    } catch (e) {
      check(false, roles[i] + " ağ kontrolü " + e.name);
    }
  }
  let client;
  try {
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(c.uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(c.dbName),
      hello = await db.command({ hello: 1 });
    await db.command({ ping: 1 });
    check(
      !!hello.setName || hello.msg === "isdbgrid",
      "MongoDB bağlantısı ve replica set",
    );
  } catch (e) {
    check(false, "MongoDB " + e.name + (e.code ? " " + e.code : ""));
  } finally {
    await client?.close();
  }
}
console.log(
  "Bu kontrol Developer Portal intentlerini, bütün rol hiyerarşisini ve canlı iş akışlarını test etmez. --online salt okunur bağlantı kontrolüdür.",
);
process.exitCode = errors ? 1 : 0;
