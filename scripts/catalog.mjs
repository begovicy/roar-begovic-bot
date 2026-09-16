import fs from "node:fs";
import { registry } from "./registry.mjs";
const usage = {
  yardım: "yardım",
  rol: "rol @üye rolID ver/al",
  ban: "ban @üye sebep",
  timeout: "timeout @üye 10m sebep",
  slowmode: "slowmode saniye",
  sil: "sil 10",
  git: "git @üye",
  çek: "çek @üye",
  stat: "stat @üye 7",
  transfer: "transfer @üye 100",
  addbalance: "addbalance para @üye 1000",
  mine: "mine 100",
  blackjack: "blackjack 100",
  cezaizin: "cezaizin jail/cmute",
  jail: "jail @üye",
  mute: "mute @üye 10m sebep",
  voicemute: "voicemute @üye 10m sebep",
  forceban: "forceban @üye sebep",
  ceza: "ceza cezaNo",
  unforceban: "unforceban kullanıcıID",
  key: "key @üye isim",
  özelkomut: "özelkomut ekle ad rolID / sil ad / liste",
  command: "command @üye",
  uncommand: "uncommand @üye",
  ses: "ses @üye",
  ship: "ship @üye",
  emoji: "emoji :özelemoji:",
  yaz: "yaz metin",
  giveaway:
    "giveaway start 1h 1 Ödül / end|reroll|pause|unpause|edit|delete ID",
  görev: "görev ekle @üye metin / tamamla ID / onayla ID / liste",
  kilit: "kilit kapat/aç",
  aviator: "aviator 100",
  tkm: "tkm @üye 100",
  duello: "duello @üye 100",
  altinal: "altinal 1",
  altinsat: "altinsat 1",
  iade: "iade işlemID",
  guardmode: "guardmode observe/enforce",
  yetki: "yetki [olayID]",
  "yedek-plan": "yedek-plan yedekID",
};
const meta = {statDetails:["İstatistik","Statistics"],
  mecraManager: ["Kullanıcı", "Manager"],
  manager: ["Kullanıcı", "Manager"],
  penalties: ["Ceza", "Manager"],
  booster: ["Booster", "Manager"],
  community: ["Topluluk", "Manager"],
  communityOps: ["Yönetim", "Manager"],
  "requested-commands": ["Yönetim", "Manager"],
  statistics: ["İstatistik", "Statistics"],
  statExtras: ["İstatistik", "Statistics"],
  economy: ["Ekonomi", "Economy"],
  economyExtras: ["Oyun ve Mağaza", "Economy"],
  guard: ["Guard", "Guard"],
  guardExtras: ["Guard", "Guard"],
};
const entries = (await registry()).flatMap((x) => x.entries),
  rows = entries.map((x) => [
    meta[x.module][0],
    x.name,
    `${meta[x.module][1]} botu. ${x.aliases.length ? "Alternatif: " + x.aliases.join(", ") : "Kullanım ve izinler: docs/KOMUTLAR.md."}`,
    usage[x.name] || x.name,
  ]);
fs.writeFileSync(
  new URL("../src/core/catalog.mjs", import.meta.url),
  "// Generated from actual module registration; do not edit by hand.\nexport const catalog = " +
    JSON.stringify(rows, null, 2) +
    ";\n",
);
fs.writeFileSync(
  new URL("../docs/KOMUTLAR.md", import.meta.url),
  "# ROAR v0.3 — Komutlar\n\n" +
    entries.length +
    " ana komut; takma adlar ayrıca sayılmaz. Bütün komutlar slash değil, önek komutudur. Varsayılan önek `.`.\n\n| Bot | Komut | Alternatifler |\n|---|---|---|\n" +
    entries
      .map(
        (x) =>
          `| ${x.role} | \`.${(usage[x.name] || x.name).replaceAll("|", " / ")}\` | ${x.aliases.join(", ")} |`,
      )
      .join("\n") +
    "\n\nGiveaway start ücretsiz çekiliş başlatır. end bitirir; reroll önceki kazananlar dışından seçer; pause/unpause süreyi durdurur/devam ettirir; edit yalnız ödül metnini değiştirir; delete onay ister. Görevler manuel onaylıdır; otomatik terfi/ödül yoktur. Mağaza rolleri config.json ile tanımlanır. Daha fazla ayrıntı: README ve KAPSAM.md.\n",
);
console.log(
  entries.length +
    " primary commands; " +
    entries.reduce((s, x) => s + x.aliases.length + 1, 0) +
    " aliases total",
);
