import test from "node:test";
import assert from "node:assert/strict";
import { memoryDB } from "./memory-db.mjs";
import { install } from "../src/modules/economy.mjs";
async function fixture() {
  const store = memoryDB(),
    commands = new Map(),
    ctx = {
      ...store,
      c: { guildId: "g", owners: [], dailyReward: 1000 },
      add: (names, fn) => names.forEach((n) => commands.set(n, fn)),
      onInteraction() {},
      every() {},
    };
  await install(ctx);
  return { ...store, commands, ...ctx.economy };
}
test("mock transactions: daily concurrency credits once", async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 20 }, () => f.daily("u")));
  assert.equal((await f.wallet("u")).balance, 1000);
  assert.equal(f.dump().ledger.length, 1);
});
test("mock transactions: duplicate ledger rolls balance back", async () => {
  const f = await fixture();
  await f.tx((s) => f.move("u", 500, "x", "grant", s));
  await assert.rejects(() => f.tx((s) => f.move("u", 500, "x", "grant", s)));
  assert.equal((await f.wallet("u")).balance, 500);
});
test("mock transactions: insufficient debit has no effect", async () => {
  const f = await fixture();
  await f.tx((s) => f.move("u", 100, "x", "grant", s));
  await assert.rejects(() => f.tx((s) => f.move("u", -101, "y", "bet", s)));
  assert.equal((await f.wallet("u")).balance, 100);
});
test("mock transactions: concurrent debits cannot overspend", async () => {
  const f = await fixture();
  await f.tx((s) => f.move("u", 100, "x", "grant", s));
  const r = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      f.tx((s) => f.move("u", -10, "bet" + i, "bet", s)),
    ),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 10);
  assert.equal((await f.wallet("u")).balance, 0);
});
test("mock transactions: payout and rollback atomic", async () => {
  const f = await fixture();
  await assert.rejects(() =>
    f.tx(async (s) => {
      await f.move("u", 100, "x", "payout", s);
      throw Error("failure");
    }),
  );
  assert.equal((await f.wallet("u")).balance, 0);
  assert.equal(f.dump().ledger?.length || 0, 0);
});
test("mock transactions: transfer replay credits once", async () => {
  const f = await fixture(),
    uid = "123456789012345678";
  await f.tx((s) => f.move("sender", 1000, "grant", "grant", s));
  const m = {
    id: "message",
    author: { id: "sender" },
    guild: { members: { fetch: async () => ({ user: { bot: false } }) } },
    reply: async () => {},
  };
  await f.commands.get("transfer")(m, [uid, "100"]);
  await f.commands.get("transfer")(m, [uid, "100"]);
  assert.equal((await f.wallet("sender")).balance, 900);
  assert.equal((await f.wallet(uid)).balance, 100);
});
test("mock transactions: invalid money rejected", async () => {
  const f = await fixture();
  for (const n of [NaN, Infinity, 0.5, 0])
    await assert.rejects(() => f.tx((s) => f.move("u", n, "x", "grant", s)));
});
