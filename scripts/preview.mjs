import fs from "node:fs";
import path from "node:path";
import { cardSVG, card } from "../src/core/cards.mjs";
const output = process.argv[2] || "previews/generated";
fs.mkdirSync(output, { recursive: true });
const examples = {
  bank: ["bank", { name: "begovic", balance: 123456789012, gold: 2500 }],
  ranking: [
    "ranking",
    {
      title: "Mesaj Sıralaması",
      rows: Array.from({ length: 10 }, (_, i) => ({
        name: [
          "begovic",
          "Sapphire",
          "ROAR topluluğu",
          "Uzun Kullanıcı İsim Denemesi",
        ][i % 4],
        value: 10000 - i * 717 + " mesaj",
        rank: i + 1,
      })),
    },
  ],
  rankingEmpty: ["ranking", { title: "Kamera Sıralaması", rows: [] }],
  blackjackActive: [
    "blackjack",
    {
      name: "begovic",
      game: {
        status: "active",
        type: "blackjack",
        bet: 1000,
        player: [0, 5, 14, 28, 42],
        dealer: [9, 20],
      },
    },
  ],
  blackjackWin: [
    "blackjack",
    {
      name: "begovic",
      game: {
        status: "finished",
        type: "blackjack",
        bet: 1000,
        player: [9, 8],
        dealer: [22, 19],
        result: "KAZANDIN",
        payout: 2000,
      },
    },
  ],
  blackjackLoss: [
    "blackjack",
    {
      name: "begovic",
      game: {
        status: "finished",
        type: "blackjack",
        bet: 1000,
        player: [9, 6, 7],
        dealer: [22, 19],
        result: "BATTIN",
        payout: 0,
      },
    },
  ],
  aviatorActive: [
    "aviator",
    { multiplier: 2.58, game: { status: "active", bet: 1000 } },
  ],
  aviatorLoss: [
    "aviator",
    { multiplier: 5.65, game: { status: "finished", bet: 1000, payout: 0 } },
  ],
  aviatorWin: [
    "aviator",
    { multiplier: 1.13, game: { status: "finished", bet: 100, payout: 113 } },
  ],
  duel: [
    "pvp",
    {
      names: ["begovic", "Sapphire"],
      game: {
        type: "duello",
        status: "active",
        bet: 1000,
        duel: { hp: [65, 80] },
      },
    },
  ],
  rps: [
    "pvp",
    {
      names: ["begovic", "Sapphire"],
      game: {
        type: "tkm",
        status: "active",
        bet: 1000,
        choices: ["tas", null],
      },
    },
  ],
  pvpWinner: [
    "pvp",
    {
      names: ["Uzun Kullanıcı İsim Denemesi", "Sapphire"],
      game: {
        type: "tkm",
        status: "finished",
        bet: 1000,
        choices: ["tas", "makas"],
        winner: 0,
      },
    },
  ],
  pvpPending: [
    "pvp",
    {
      names: ["begovic", "Sapphire"],
      game: { type: "duello", status: "pending", bet: 1000 },
    },
  ],
  pvpTie: [
    "pvp",
    {
      names: ["begovic", "Sapphire"],
      game: {
        type: "tkm",
        status: "finished",
        bet: 1000,
        choices: ["tas", "tas"],
        winner: -1,
      },
    },
  ],
  quiz: ["quiz", { quiz: { a: 240, b: 161, reward: 825 } }],
};
for (const [name, [type, data]] of Object.entries(examples)) {
  fs.writeFileSync(
    path.join(output, name + ".svg"),
    cardSVG(type, { ...data, demo: true }),
  );
  fs.writeFileSync(
    path.join(output, name + ".png"),
    await card(type, { ...data, demo: true }),
  );
}
console.log(Object.keys(examples).join("\n"));
