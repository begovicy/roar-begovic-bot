import fs from "node:fs";
import sharp from "sharp";
import { xml, money, elapsed } from "./util.mjs";
import { score, cardLabel } from "./games.mjs";
const image =
  "data:image/jpeg;base64," +
  fs
    .readFileSync(new URL("../../assets/aquatic.jpg", import.meta.url))
    .toString("base64");
const text = (x, y, s, size = 24, color = "#F2F3FA", extra = "") =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" ${extra}>${xml(s)}</text>`;
const rect = (x, y, w, h, fill, rx = 12, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}" ${extra}/>`;
const base = (w, h, body, aquatic = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:Arial,'Liberation Sans',sans-serif;font-weight:600}</style>${aquatic ? `<image href="${image}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>${rect(0, 0, w, h, "#071224", 0, 'opacity=".4"')}` : rect(0, 0, w, h, "#282939", 24)}${body}</svg>`;
const footer = (y, demo = false) =>
  text(
    500,
    y,
    (demo ? "ÖRNEK VERİ • " : "") + "ROAR • begovic",
    16,
    "#C9CDDA",
    'text-anchor="middle"',
  );
function initials(x, y, name) {
  return (
    rect(x, y, 120, 120, "#18273F", 16) +
    text(
      x + 60,
      y + 77,
      String(name || "?")
        .slice(0, 2)
        .toUpperCase(),
      40,
      "#D7DDF0",
      'text-anchor="middle"',
    )
  );
}
export function cardSVG(type, d = {}) {
  if (type === "bank")
    return base(
      1000,
      420,
      `${rect(20, 20, 960, 380, "none", 22, 'stroke="#C4AA61" stroke-width="2"')}${text(54, 76, "ROAR", 40, "#EFDA94", 'letter-spacing="8"')}${text(944, 70, "BANK", 26, "#EFDA94", 'text-anchor="end" letter-spacing="5"')}${rect(58, 112, 72, 52, "#E4D18B", 9)}<path d="M58 130h72M58 147h72M82 112v52M106 112v52" stroke="#83733F"/>${text(54, 232, money(d.balance || 0), 64)}${text(58, 269, "ROAR PARASI", 16, "#C7D6E5", 'letter-spacing="3"')}${text(58, 337, String(d.name || "Üye").slice(0, 30), 24)}${text(58, 371, "SUNUCU İÇİ SANAL BAKİYE", 15, "#C7D6E5")}${text(944, 332, (d.gold || 0) + " G", 29, "#EFDA94", 'text-anchor="end"')}${text(944, 371, "ROAR • begovic", 16, "#C7D6E5", 'text-anchor="end"')}${d.demo ? text(944, 110, "ÖRNEK VERİ", 14, "#DDD3AC", 'text-anchor="end"') : ""}`,
    );
  if (type === "ranking") {
    const rows = d.rows || [];
    return base(
      1000,
      790,
      `<path d="M25 90H295L315 34H685L705 90H975V750Q975 770 955 770H45Q25 770 25 750Z" fill="#30313F" stroke="#BBA362" stroke-width="2"/>${text(500, 78, d.title || "Sıralama", 34, "#F7F7FB", 'text-anchor="middle"')}${rows
        .slice(0, 10)
        .map((r, i) => {
          const y = 138 + i * 59,
            c = ["#37C6EB", "#FFE252", "#52DB96"][i] || "#F1F2FA";
          return `<line x1="61" y1="${y + 22}" x2="942" y2="${y + 22}" stroke="#88764F"/>${rect(63, y - 24, 40, 40, "#202333", 20)}${text(83, y + 3, String(r.name).slice(0, 1).toUpperCase(), 18, "#D2D7E9", 'text-anchor="middle"')}${text(123, y + 4, "#" + (r.rank || i + 1) + " " + String(r.name).slice(0, 22), 24, c)}${text(938, y + 4, r.value, 22, c, 'text-anchor="end"')}`;
        })
        .join(
          "",
        )}${!rows.length ? text(500, 300, "Henüz istatistik yok.", 28, "#CFCDDE", 'text-anchor="middle"') : ""}${footer(750, d.demo)}`,
      false,
    );
  }
  if (type === "blackjack") {
    const g = d.game,
      active = g.status === "active";
    const hand = (a, x, y, hide) =>
      a
        .map((c, i) => {
          const xx = x + i * Math.min(65, 410 / Math.max(1, a.length - 1)),
            hidden = hide && i > 0;
          return (
            rect(
              xx,
              y,
              80,
              110,
              hidden ? "#283F66" : "#F7F8FC",
              8,
              'stroke="#BFCDE0"',
            ) +
            text(
              xx + 9,
              y + 34,
              hidden ? "?" : cardLabel(c),
              25,
              hidden
                ? "#DDE5FF"
                : [1, 2].includes(Math.floor(c / 13))
                  ? "#DA3B5B"
                  : "#263548",
            )
          );
        })
        .join("");
    return base(
      1000,
      590,
      `${rect(22, 22, 956, 546, "none", 20, 'stroke="#BAA35E" stroke-width="2"')}${text(52, 68, "ROAR BLACKJACK", 28, "#ECD78C")}${text(946, 68, "BAHİS " + money(g.bet), 22, "#E5E9F5", 'text-anchor="end"')}${text(54, 122, "KRUPİYE", 16, "#C6D3E3")}${hand(g.dealer, 340, 114, active)}${text(930, 170, active ? "?" : score(g.dealer), 30, "#FFFFFF", 'text-anchor="end"')}${text(54, 286, String(d.name || "Oyuncu").slice(0, 20), 22)}${hand(g.player, 340, 290, false)}${text(930, 348, score(g.player), 30, "#FFFFFF", 'text-anchor="end"')}${rect(52, 444, 896, 76, "#071827")}${text(500, 490, active ? "KART ÇEK · DUR · KATLA" : g.result + " · ÖDEME " + money(g.payout || 0), 28, active ? "#E6DFC2" : g.payout ? "#77EBC0" : "#FF7D9F", 'text-anchor="middle"')}${footer(548, d.demo)}`,
    );
  }
  if (type === "aviator") {
    const g = d.game,
      active = g.status === "active",
      color = active ? "#F1F3FC" : g.payout ? "#6AE9B2" : "#FF527F",
      mult = d.multiplier || g.crash;
    return base(
      1000,
      520,
      `${rect(0, 0, 1000, 520, "#301326", 0, 'opacity=".86"')}${Array.from({ length: 12 }, (_, i) => `<path d="M65 440L${250 + i * 75} 15" stroke="#F1C7E8" stroke-width="${5 + (i % 3)}" opacity=".08"/>`).join("")}${text(42, 56, "ROAR AVIATOR", 28, "#EFDA94")}${text(956, 54, active ? "CANLI" : "SONUÇ", 16, color, 'text-anchor="end"')}${text(500, 258, Number(mult).toFixed(2) + "×", 105, color, 'text-anchor="middle"')}${text(500, 313, active ? "PATLAMADAN BOZDUR" : g.payout ? "BOZDURULDU" : "UÇAK PATLADI", 29, color, 'text-anchor="middle"')}<path d="M72 431 Q270 425 495 355" fill="none" stroke="${color}" stroke-width="6"/><path d="M477 358l48-15-20 35-4-16-24-4" fill="${color}"/>${text(42, 473, "BAHİS " + money(g.bet), 22)}${text(955, 473, active ? "" : `ÖDEME ${money(g.payout || 0)}`, 22, color, 'text-anchor="end"')}${footer(507, d.demo)}`,
      false,
    );
  }
  if (type === "pvp") {
    const g = d.game,
      names = d.names || ["Oyuncu 1", "Oyuncu 2"],
      active = g.status === "active";
    return base(
      1000,
      520,
      `${rect(0, 0, 500, 520, "#163968", 0, 'opacity=".86"')}${rect(500, 0, 500, 520, "#5A1D35", 0, 'opacity=".86"')}${text(40, 53, "ROAR " + (g.type === "tkm" ? "TAŞ KÂĞIT MAKAS" : "DÜELLO"), 26, "#EFE0A7")}${text(959, 53, "POT " + money(g.bet * 2), 22, "#EAE5D5", 'text-anchor="end"')}${initials(100, 147, names[0])}${initials(780, 147, names[1])}${text(160, 308, names[0].slice(0, 18), 22, "#F2F3FA", 'text-anchor="middle"')}${text(840, 308, names[1].slice(0, 18), 22, "#F2F3FA", 'text-anchor="middle"')}${text(500, 219, "VS", 70, "#FFDE70", 'text-anchor="middle"')}${g.type === "duello" ? text(160, 365, (g.duel?.hp[0] ?? 100) + " HP", 28, "#BFE7FF", 'text-anchor="middle"') + text(840, 365, (g.duel?.hp[1] ?? 100) + " HP", 28, "#FFC0CE", 'text-anchor="middle"') : text(160, 365, g.status === "finished" ? g.choices?.[0] || "—" : g.choices?.[0] ? "SEÇİLDİ" : "BEKLİYOR", 24, "#BFE7FF", 'text-anchor="middle"') + text(840, 365, g.status === "finished" ? g.choices?.[1] || "—" : g.choices?.[1] ? "SEÇİLDİ" : "BEKLİYOR", 24, "#FFC0CE", 'text-anchor="middle"')}${rect(66, 408, 868, 59, "#171723")}${text(500, 446, g.status === "pending" ? "DAVET BEKLİYOR" : active ? "KARŞILAŞMA SÜRÜYOR" : g.winner === -1 ? "BERABERE / İPTAL" : names[g.winner]?.slice(0, 20) + " KAZANDI", 26, active ? "#F1E9D3" : "#75E9B8", 'text-anchor="middle"')}${footer(500, d.demo)}`,
    );
  }
  if (type === "quiz") {
    const q = d.quiz;
    return base(
      1000,
      420,
      `${text(500, 78, "ROAR BOTMATİK", 38, "#F2F4FB", 'text-anchor="middle"')}${text(500, 183, `${q.a} + ${q.b} = ?`, 60, "#F2F4FB", 'text-anchor="middle"')}${text(500, 259, money(q.reward) + " ROAR PARASI", 32, "#DFD69E", 'text-anchor="middle"')}${text(500, 305, "30 SANİYE · TEK CEVAP HAKKI", 22, "#C8D8E5", 'text-anchor="middle"')}${footer(390, d.demo)}`,
    );
  }
  throw Error("Kart türü desteklenmiyor.");
}
export async function card(type, data) {
  return sharp(Buffer.from(cardSVG(type, data)))
    .png()
    .toBuffer();
}
export async function attachCard(payload, type, data) {
  payload.files = [
    { attachment: await card(type, data), name: "roar-card.png" },
  ];
  payload.embeds[0].image = { url: "attachment://roar-card.png" };
  payload.attachments = [];
  return payload;
}
