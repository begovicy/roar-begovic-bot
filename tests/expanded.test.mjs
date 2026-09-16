import test from "node:test";
import assert from "node:assert/strict";
import {
  rps,
  newDuel,
  duelStep,
  crashSample,
  crashMultiplier,
  crashOutcome,
} from "../src/core/social-games.mjs";
import {
  canManageRoom,
  freshInteraction,
  safeRestore,
  parseColors,
  xpLevel,
  effectiveChannelPermissions,
} from "../src/core/policy.mjs";
import { cardSVG, card } from "../src/core/cards.mjs";
import { P, target, authorize } from "../src/core/auth.mjs";
import { registry } from "../scripts/registry.mjs";
import { config } from "../src/core/config.mjs";
for (const a of ["tas", "kagit", "makas"])
  for (const b of ["tas", "kagit", "makas"])
    test("RPS " + a + "/" + b, () => {
      const z = rps(a, b);
      assert.equal(
        z,
        a === b
          ? 0
          : { tas: "makas", kagit: "tas", makas: "kagit" }[a] === b
            ? 1
            : 2,
      );
    });
test("RPS rejects invalid", () => assert.throws(() => rps("bad", "tas")));
test("duel immutable attack", () => {
  const g = newDuel(),
    n = duelStep(g, 0, "attack", 20);
  assert.equal(g.hp[1], 100);
  assert.equal(n.hp[1], 80);
  assert.equal(n.turn, 1);
});
test("duel refuses wrong turn", () =>
  assert.throws(() => duelStep(newDuel(), 1, "attack")));
test("duel max heal", () => {
  const g = newDuel();
  g.heals[0] = 3;
  assert.throws(() => duelStep(g, 0, "heal"));
});
test("duel no health overflow", () =>
  assert.equal(duelStep(newDuel(), 0, "heal", 20, 20).hp[0], 100));
test("duel knockout", () => {
  const g = newDuel();
  g.hp[1] = 5;
  assert.equal(duelStep(g, 0, "attack", 20).winner, 0);
});
test("duel withdrawal pays opponent", () =>
  assert.equal(duelStep(newDuel(), 0, "quit").winner, 1));
test("duel round cap tie", () => {
  const g = newDuel();
  g.round = 49;
  assert.equal(duelStep(g, 0, "heal", 15, 10).winner, -1);
});
test("finished duel cannot replay", () => {
  const g = newDuel();
  g.winner = 0;
  assert.throws(() => duelStep(g, 0, "attack"));
});
for (const u of [0.000001, 0.01, 0.5, 0.97, 1])
  test("crash sample bounds " + u, () => {
    const n = crashSample(u);
    assert.ok(n >= 1 && n <= 30);
  });
test("crash sample rejects zero", () => assert.throws(() => crashSample(0)));
test("crash early cash", () => {
  const x = crashOutcome(
    { startedAt: 0, crashAt: 10000, crash: 3.49, bet: 100 },
    1000,
  );
  assert.equal(x.crashed, false);
  assert.equal(x.payout, 113);
});
test("crash deadline exact", () =>
  assert.equal(
    crashOutcome({ startedAt: 0, crashAt: 1000, crash: 1.13, bet: 100 }, 1000)
      .payout,
    0,
  ));
test("crash zero elapsed", () => assert.equal(crashMultiplier(0, 0), 1));
test("room owner authority", () =>
  assert.equal(canManageRoom({ ownerId: "a" }, "a", true), true));
test("room moderator cannot delete", () =>
  assert.equal(
    canManageRoom({ ownerId: "a", moderators: ["b"] }, "b", true),
    false,
  ));
test("room stranger rejected", () =>
  assert.equal(canManageRoom({ ownerId: "a" }, "b"), false));
const sess = {
  guildId: "g",
  userId: "u",
  channelId: "c",
  expiresAt: new Date(1000),
};
for (const [g, u, c, t] of [
  ["x", "u", "c", 0],
  ["g", "x", "c", 0],
  ["g", "u", "x", 0],
  ["g", "u", "c", 1000],
])
  test("session isolation " + [g, u, c, t], () =>
    assert.throws(() => freshInteraction(sess, g, u, c, t)),
  );
test("session valid", () =>
  assert.equal(freshInteraction(sess, "g", "u", "c", 0), sess));
test("restore skips privileged managed and high roles", () =>
  assert.deepEqual(
    safeRestore(
      [
        { id: "a", permissions: "0", managed: false, position: 1 },
        { id: "b", permissions: "8", position: 1 },
        { id: "c", permissions: "0", managed: true, position: 1 },
        { id: "d", permissions: "0", position: 10 },
      ],
      5,
    ),
    ["a"],
  ));
test("solid HEX colors", () =>
  assert.equal(parseColors("#5865F2").primaryColor, 0x5865f2));
test("gradient HEX colors", () =>
  assert.equal(parseColors("5865F2 A875FF").secondaryColor, 0xa875ff));
test("holographic colors", () =>
  assert.equal(parseColors("holografik").tertiaryColor, 16761760));
for (const s of ["bad", "holografik extra", "#12345", "#fff #fff #fff"])
  test("reject color " + s, () => assert.throws(() => parseColors(s)));
test("level zero", () => assert.equal(xpLevel(0, 0), 0));
test("level formula", () => assert.equal(xpLevel(500, 0), 10));
const roles = [
  { id: "g", permissions: P.ViewChannel | P.SendMessages },
  { id: "r", permissions: 0n },
];
test("channel role deny", () =>
  assert.equal(
    effectiveChannelPermissions("u", "g", roles, [
      { id: "r", allow: 0n, deny: P.SendMessages },
    ]) & P.SendMessages,
    0n,
  ));
test("member allow overrides mute role", () =>
  assert.equal(
    effectiveChannelPermissions("u", "g", roles, [
      { id: "r", allow: 0n, deny: P.SendMessages },
      { id: "u", allow: P.SendMessages, deny: 0n },
    ]) & P.SendMessages,
    P.SendMessages,
  ));
test("admin bypass recognized", () =>
  assert.notEqual(
    effectiveChannelPermissions(
      "u",
      "g",
      [...roles, { id: "a", permissions: 8n }],
      [{ id: "u", allow: 0n, deny: P.ViewChannel }],
    ) & P.ViewChannel,
    0n,
  ));
test("config defaults valid without secrets", () =>
  assert.equal(config({ requireSecrets: false }).boosterShareLimit, 12));
test("modules wire without conflicting aliases or handlers", async () => {
  const r = await registry();
  assert.equal(r.length, 4);
  assert.ok(r.flatMap((x) => x.entries).length > 70);
  for (const g of r)
    assert.equal(
      new Set(g.handlers.map((x) => x.prefix)).size,
      g.handlers.length,
    );
});
test("longest namespace selects one handler", async () => {
  const r = (await registry()).find((x) => x.role === "economy");
  const x = r.handlers
    .filter((h) => "e:pvp:abc:1:attack".startsWith(h.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  assert.equal(x.prefix, "e:pvp:");
});
test("SVG escapes user text", () => {
  const x = cardSVG("bank", { name: "<script>alert(1)</script>" });
  assert.ok(!x.includes("<script>"));
  assert.ok(x.includes("&lt;script&gt;"));
});
test("SVG contains no remote image URL", () =>
  assert.ok(!cardSVG("bank", {}).includes('href="http')));
test("PNG actual renderer", async () => {
  const png = await card("bank", { balance: 100, name: "ROAR" });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.length < 5e6);
});
function mockTarget({
  actorOwner = false,
  targetOwner = false,
  actorPos = 10,
  targetPos = 1,
  botPos = 20,
  allowed = true,
} = {}) {
  const actor = {
      id: actorOwner ? "owner" : "actor",
      permissions: { has: () => allowed },
      roles: {
        highest: {
          position: actorPos,
          comparePositionTo: (r) => actorPos - r.position,
        },
      },
    },
    victim = {
      id: targetOwner ? "owner" : "victim",
      roles: { highest: { position: targetPos } },
    },
    bot = {
      id: "bot",
      permissions: { has: () => true },
      roles: { highest: { comparePositionTo: (r) => botPos - r.position } },
    };
  const m = {
    author: { id: actor.id },
    guild: {
      ownerId: "owner",
      members: {
        fetch: async (x) => (x === actor.id ? actor : victim),
        fetchMe: async () => bot,
      },
    },
  };
  return [{ c: { owners: [] } }, m, victim.id, P.BanMembers];
}
test("permission gate rejects nonstaff", async () =>
  assert.rejects(() => target(...mockTarget({ allowed: false }))));
test("cannot punish guild owner", async () =>
  assert.rejects(() => target(...mockTarget({ targetOwner: true }))));
test("cannot punish equal hierarchy", async () =>
  assert.rejects(() => target(...mockTarget({ targetPos: 10 }))));
test("cannot bypass bot hierarchy", async () =>
  assert.rejects(() =>
    target(...mockTarget({ actorOwner: true, targetPos: 25 })),
  ));
test("valid moderation target", async () =>
  assert.equal((await target(...mockTarget())).id, "victim"));

test("registration cannot grant a role above actor", async () => {
  const r = (await registry()).find((x) => x.role === "manager");
  r.ctx.c.registeredRoleId = "123456789012345679";
  const actor = {
      id: "actor",
      permissions: { has: () => true },
      roles: {
        highest: { position: 5, comparePositionTo: (x) => 5 - x.position },
      },
    },
    member = {
      id: "123456789012345678",
      user: { bot: false },
      roles: { highest: { position: 1 } },
    },
    bot = {
      id: "bot",
      permissions: { has: () => true },
      roles: { highest: { comparePositionTo: (x) => 30 - x.position } },
    },
    role = {
      id: r.ctx.c.registeredRoleId,
      position: 10,
      editable: true,
      managed: false,
      permissions: { bitfield: 0n },
    };
  const m = {
    author: { id: "actor" },
    guild: {
      ownerId: "owner",
      members: {
        fetch: async (uid) => (uid === "actor" ? actor : member),
        fetchMe: async () => bot,
      },
      roles: { fetch: async () => role },
    },
  };
  await assert.rejects(
    () => r.commands.get("key")(m, [member.id]),
    /yetkilinin altında/,
  );
});
