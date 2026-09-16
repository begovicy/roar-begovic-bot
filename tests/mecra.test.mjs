import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  overwriteValue,
  roomControls,
  roomPanel,
  checkTransfer,
  roomInteraction,
} from "../src/modules/rooms.mjs";
import { mecraHelp, bannerBuffer } from "../src/modules/mecraManager.mjs";
import { makeLock } from "../src/core/util.mjs";
import { registry } from "../scripts/registry.mjs";
test("MECRA room has exact 5+4 control order", async () => {
  const p = await roomPanel({
    c: { guildId: "g" },
    db: { collection: () => ({ findOne: async () => null }) },
  });
  assert.deepEqual(
    p.components.map((r) => r.components.length),
    [5, 4],
  );
  assert.deepEqual(
    p.components.flatMap((r) =>
      r.components.map((x) => x.custom_id.split(":")[2]),
    ),
    [
      "name",
      "allow",
      "lock",
      "list",
      "delete",
      "hide",
      "block",
      "transfer",
      "limit",
    ],
  );
  assert.equal(p.embeds, undefined);
  assert.ok(
    p.components.every((r) => r.components.every((b) => b.emoji && !b.label)),
  );
});
test("configured room icons override Unicode fallback", async () => {
  const p = await roomPanel({
    c: { guildId: "g" },
    db: {
      collection: () => ({
        findOne: async () => ({
          roomEmoji: { name: { id: "emojiId", name: "roar_room_name" } },
        }),
      }),
    },
  });
  assert.equal(p.components[0].components[0].emoji.id, "emojiId");
});
const room = { _id: "r", ownerId: "old" };
test("transfer allows present target with no room", () =>
  assert.doesNotThrow(() =>
    checkTransfer(room, "old", "new", "r", false, false),
  ));
for (const [label, args] of [
  ["stranger", [room, "stranger", "new", "r", false, false]],
  ["self", [room, "old", "old", "r", false, false]],
  ["absent", [room, "old", "new", "elsewhere", false, false]],
  ["already owner", [room, "old", "new", "r", true, false]],
  ["bot", [room, "old", "new", "r", false, true]],
  [
    "pending",
    [{ ...room, transferPending: {} }, "old", "new", "r", false, false],
  ],
])
  test("transfer rejects " + label, () =>
    assert.throws(() => checkTransfer(...args)),
  );
test("help has 14 code lines and native category selector", () => {
  const p = mecraHelp("t"),
    c = p.components[0].components;
  assert.equal(p.flags, 32768);
  assert.equal(c[0].content.split("\n").length, 14);
  assert.equal(c[1].components[0].type, 3);
});
test("all help general commands resolve to real handlers", async () => {
  const regs = await registry(),
    manager = regs.find((x) => x.role === "manager");
  for (const line of mecraHelp("t").components[0].components[0].content.split(
    "\n",
  )) {
    const name = line.slice(2).split(/[ `]/)[0];
    assert.ok(manager.commands.has(name), name);
  }
});
test("all nine icon images are present", () => {
  for (const [k] of roomControls)
    assert.ok(
      fs.statSync(
        new URL("../assets/room-icons/" + k + ".png", import.meta.url),
      ).size > 100,
    );
});
test("banner markup is escaped and emits real PNG", async () => {
  const b = await bannerBuffer('<script>alert("x")</script>');
  assert.equal(b.subarray(1, 4).toString(), "PNG");
});
function fixture(fail = false) {
  const records = {
      rooms: [
        { _id: "r", guildId: "g", ownerId: "old", moderators: ["oldmod"] },
      ],
      sessions: [
        {
          _id: "s",
          guildId: "g",
          userId: "new",
          channelId: "chat",
          kind: "roomTransfer",
          expiresAt: new Date(Date.now() + 60000),
          data: { channelId: "r", ownerId: "old" },
        },
      ],
    },
    edits = [],
    replies = [];
  const get = (d, k) => k.split(".").reduce((v, x) => v?.[x], d);
  const match = (d, q) =>
    Object.entries(q).every(([k, v]) =>
      v && typeof v === "object" && "$gt" in v
        ? get(d, k) > v.$gt
        : get(d, k) === v,
    );
  const db = {
    collection: (n) => ({
      findOne: async (q) =>
        structuredClone(records[n].find((d) => match(d, q)) || null),
      updateOne: async (q, u) => {
        const d = records[n].find((d) => match(d, q));
        if (d) {
          Object.assign(d, u.$set || {});
          for (const k of Object.keys(u.$unset || {})) delete d[k];
        }
        return { matchedCount: d ? 1 : 0 };
      },
      deleteOne: async (q) => {
        records[n] = records[n].filter((d) => !match(d, q));
      },
    }),
  };
  const ch = {
    id: "r",
    permissionOverwrites: {
      edit: async (uid, permissions) => {
        edits.push({ uid, permissions });
        if (fail) throw Error("API unavailable");
      },
    },
  };
  const ctx = {
    db,
    tx: (fn) => fn({ mock: true }),
    lock: makeLock(),
    report() {},
  };
  const i = {
    customId: "m:roomtransfer:s:yes",
    guildId: "g",
    channelId: "chat",
    user: { id: "new" },
    guild: {
      channels: { fetch: async () => ch },
      members: {
        fetch: async () => ({
          id: "new",
          user: { bot: false },
          voice: { channelId: "r" },
        }),
      },
    },
    deferUpdate: async () => {},
    editReply: async (p) => replies.push(p),
  };
  return { ctx, i, records, edits, replies };
}
test("accepted transfer changes owner once and clears moderators", async () => {
  const f = fixture();
  await roomInteraction(f.ctx, f.i);
  assert.equal(f.records.rooms[0].ownerId, "new");
  assert.deepEqual(f.records.rooms[0].moderators, []);
  assert.equal(f.records.sessions.length, 0);
  assert.equal(f.records.rooms[0].transferPending, undefined);
  assert.equal(f.edits.length, 1);
  await assert.rejects(() => roomInteraction(f.ctx, f.i));
});
test("rejected transfer leaves original ownership intact", async () => {
  const f = fixture();
  f.i.customId = "m:roomtransfer:s:no";
  await roomInteraction(f.ctx, f.i);
  assert.equal(f.records.rooms[0].ownerId, "old");
  assert.equal(f.edits.length, 0);
});
test("API failure leaves durable pending transfer", async () => {
  const f = fixture(true);
  await roomInteraction(f.ctx, f.i);
  assert.equal(f.records.rooms[0].ownerId, "new");
  assert.equal(f.records.rooms[0].transferPending.newOwnerId, "new");
  assert.ok(f.replies[0].content.includes("bekliyor"));
});
test("only invited target can confirm", async () => {
  const f = fixture();
  f.i.user.id = "stranger";
  await assert.rejects(() => roomInteraction(f.ctx, f.i));
  assert.equal(f.edits.length, 0);
});
test("expired transfer cannot mutate ownership", async () => {
  const f = fixture();
  f.records.sessions[0].expiresAt = new Date(0);
  await assert.rejects(() => roomInteraction(f.ctx, f.i));
  assert.equal(f.edits.length, 0);
});

test("room ACL preserves tri-state instead of granting public access", () => {
  assert.equal(overwriteValue({ allow: 0n, deny: 8n }, 8n), false);
  assert.equal(overwriteValue({ allow: 8n, deny: 0n }, 8n), true);
  assert.equal(overwriteValue(undefined, 8n), null);
});
