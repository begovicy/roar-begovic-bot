import test from "node:test";
import assert from "node:assert/strict";
import {
  amount,
  duration,
  day,
  chunks,
  snowflake,
  shuffled,
  makeLock,
} from "../src/core/util.mjs";
import {
  score,
  createGame,
  advance,
  expireGame,
  mineMultiplier,
} from "../src/core/games.mjs";
import { panel, embed, readSession } from "../src/core/ui.mjs";
import { catalog } from "../src/core/catalog.mjs";
import { readFileSync } from "node:fs";
test("amount accepts positive integer", () => assert.equal(amount("100"), 100));
for (const v of ["0", "-1", "1.2", "1e6", "NaN", "9007199254740992"])
  test("amount rejects " + v, () => assert.throws(() => amount(v)));
test("duration bounds", () => {
  assert.equal(duration("10m"), 600000);
  assert.throws(() => duration("29d"));
  assert.throws(() => duration("0s"));
});
test("mention validation", () => {
  assert.equal(snowflake("<@!123456789012345678>"), "123456789012345678");
  assert.throws(() => snowflake("abc"));
});
test("Istanbul midnight", () =>
  assert.equal(day(Date.parse("2026-09-08T21:00:00Z")), "2026-09-09"));
test("split midnight", () => {
  const a = Date.parse("2026-09-08T20:59:50Z");
  assert.deepEqual(chunks(a, a + 20000), [
    { day: "2026-09-08", ms: 10000 },
    { day: "2026-09-09", ms: 10000 },
  ]);
});
test("shuffle uniqueness", () => assert.equal(new Set(shuffled(52)).size, 52));
test("aces", () => assert.equal(score([0, 13, 8]), 21));
test("natural blackjack score", () => assert.equal(score([0, 12]), 21));
const mine = () => ({
  type: "mine",
  bet: 1000,
  bombs: [0, 1, 2],
  opened: [],
  status: "active",
  version: 0,
});
test("three bombs", () =>
  assert.equal(new Set(createGame("mine", 100).bombs).size, 3));
test("bomb zero payout", () =>
  assert.equal(advance(mine(), "cell0").payout, 0));
test("no early cash", () => assert.throws(() => advance(mine(), "cash")));
test("immutable safe reveal", () => {
  const a = mine(),
    b = advance(a, "cell3");
  assert.equal(a.opened.length, 0);
  assert.equal(b.opened.length, 1);
});
test("cash payout", () =>
  assert.equal(advance(advance(mine(), "cell3"), "cash").payout, 1455));
test("repeat cell denied", () =>
  assert.throws(() => advance(advance(mine(), "cell3"), "cell3")));
test("invalid cell denied", () =>
  assert.throws(() => advance(mine(), "cell9")));
test("all safe cells", () => {
  let g = mine();
  for (let i = 3; i < 9; i++) g = advance(g, "cell" + i);
  assert.equal(g.payout, Math.floor(1000 * mineMultiplier(6)));
});
test("finished game immutable", () =>
  assert.throws(() => advance(expireGame(mine()), "cash")));
const bj = () => ({
  type: "blackjack",
  bet: 100,
  player: [9, 6],
  dealer: [22, 7],
  deck: [1],
  status: "active",
  version: 0,
});
test("blackjack lose", () => assert.equal(advance(bj(), "stand").payout, 0));
test("blackjack tie", () => {
  const g = bj();
  g.player = [9, 20];
  assert.equal(advance(g, "stand").payout, 100);
});
test("blackjack win", () => {
  const g = bj();
  g.player = [9, 8];
  assert.equal(advance(g, "stand").payout, 200);
});
test("blackjack double", () => {
  const g = advance(bj(), "double");
  assert.equal(g.bet, 200);
  assert.equal(g.status, "finished");
});
test("blackjack double only first hand", () => {
  const g = bj();
  g.player.push(1);
  assert.throws(() => advance(g, "double"));
});
test("new blackjack deck unique", () => {
  for (let j = 0; j < 100; j++) {
    const g = createGame("blackjack", 100);
    assert.equal(new Set([...g.deck, ...g.player, ...g.dealer]).size, 52);
  }
});
test("V2 shape", () => {
  const p = panel("A", "B");
  assert.equal(p.flags, 32768);
  assert.equal(p.embeds, undefined);
});
test("safe mentions", () =>
  assert.deepEqual(embed("A", "B").allowedMentions.parse, []));
test("unique catalog", () =>
  assert.equal(new Set(catalog.map((x) => x[1])).size, catalog.length));
test("catalog registrations", async () => {
  const { registry } = await import("../scripts/registry.mjs");
  const names = new Set(
    (await registry()).flatMap((x) => [...x.commands.keys()]),
  );
  for (const x of catalog) assert.ok(names.has(x[1]), x[1]);
});
test("session owner", async () => {
  const ctx = {
    db: {
      collection: () => ({
        findOne: async () => ({
          userId: "a",
          channelId: "c",
          expiresAt: new Date(Date.now() + 5000),
        }),
      }),
    },
  };
  await assert.rejects(() =>
    readSession(ctx, { guildId: "g", user: { id: "b" }, channelId: "c" }, "x"),
  );
});
test("session expiry", async () => {
  const ctx = {
    db: {
      collection: () => ({
        findOne: async () => ({
          userId: "a",
          channelId: "c",
          expiresAt: new Date(0),
        }),
      }),
    },
  };
  await assert.rejects(() =>
    readSession(ctx, { guildId: "g", user: { id: "a" }, channelId: "c" }, "x"),
  );
});
test("serial lock", async () => {
  const lock = makeLock(),
    out = [];
  await Promise.all([
    lock("x", async () => {
      out.push(1);
      await new Promise((r) => setTimeout(r, 5));
      out.push(2);
    }),
    lock("x", async () => out.push(3)),
  ]);
  assert.deepEqual(out, [1, 2, 3]);
});
test("lock after error", async () => {
  const lock = makeLock();
  await assert.rejects(() =>
    lock("x", async () => {
      throw Error("x");
    }),
  );
  assert.equal(await lock("x", async () => 5), 5);
});
