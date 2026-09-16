import test from "node:test";
import assert from "node:assert/strict";
import { installRooms } from "../src/modules/rooms.mjs";
import { makeLock } from "../src/core/util.mjs";

function fixture(options = {}) {
  const events = new Map(),
    records = new Map(),
    members = new Map(),
    calls = [],
    reports = [];
  const lobby = {
    id: "lobby",
    type: 2,
    parentId: options.parent === undefined ? "actual-category" : options.parent,
    rawPosition: 7,
    permissionOverwrites: {
      cache: new Map([
        [
          "guild",
          {
            id: "guild",
            type: 0,
            allow: { bitfield: 0n },
            deny: { bitfield: 1024n },
          },
        ],
      ]),
    },
  };
  const created = new Map();
  let next = 0,
    creating = 0,
    maxCreating = 0;
  const guild = {
    id: "guild",
    channels: {
      fetch: async (id) => {
        if (id === "lobby") return lobby;
        if (id === "actual-category") return { id, type: 4 };
        if (options.fetchFailure && id === "existing") {
          const e = Error("Network failure");
          e.code = 50013;
          throw e;
        }
        if (id === "existing") return { id, type: 2 };
        if (created.has(id)) return created.get(id);
        const e = Error("Missing");
        e.code = 10003;
        throw e;
      },
      create: async (data) => {
        creating++;
        maxCreating = Math.max(maxCreating, creating);
        await new Promise((r) => setTimeout(r, 2));
        creating--;
        const id = "room" + ++next;
        calls.push({ kind: "create", id, data });
        const ch = {
          id,
          type: 2,
          setPosition: async (position) => {
            calls.push({ kind: "position", id, position });
            if (options.positionFailure) throw Error("position failed");
          },
          send: async () => {
            calls.push({ kind: "panel", id });
            if (options.panelFailure) throw Error("panel failed");
          },
          delete: async () => {
            calls.push({ kind: "delete", id });
            if (options.cleanupFailure) throw Error("delete failed");
            created.delete(id);
          },
        };
        created.set(id, ch);
        if (options.leaveDuringCreate) members.get("u").voice.channelId = null;
        return ch;
      },
    },
    members: {
      fetch: async (uid) => members.get(uid),
      fetchMe: async () => ({ id: "bot", permissions: { has: () => true } }),
    },
  };
  const collection = {
    findOne: async (q) =>
      [...records.values()].find((r) =>
        Object.entries(q).every(([k, v]) => r[k] === v),
      ) || null,
    insertOne: async (r) => {
      records.set(r._id, r);
    },
    deleteOne: async (q) => records.delete(q._id),
    updateOne: async (q, u) =>
      records.set(q._id, {
        ...(records.get(q._id) || { _id: q._id }),
        ...u.$set,
      }),
  };
  const ctx = {
    c: {
      guildId: "guild",
      privateRoomLobbyId: "lobby",
      privateRoomCategoryId: "old-unrelated-category",
    },
    db: { collection: () => collection },
    lock: makeLock(),
    event: (n, fn) => events.set(n, fn),
    every() {},
    report: (...a) => reports.push(a),
  };
  installRooms(ctx);
  function member(uid = "u", channelId = "lobby") {
    const m = {
      id: uid,
      displayName: uid,
      user: { bot: false },
      voice: {
        channelId,
        setChannel: async (ch) => {
          calls.push({ kind: "move", uid, id: ch.id });
          m.voice.channelId = ch.id;
        },
      },
    };
    members.set(uid, m);
    return m;
  }
  member();
  if (options.existing)
    records.set("existing", {
      _id: "existing",
      guildId: "guild",
      ownerId: "u",
    });
  const join = (uid) =>
    events.get("voiceStateUpdate")(
      { channelId: null },
      { id: uid, guild, member: members.get(uid), channelId: "lobby" },
    );
  return {
    ctx,
    guild,
    lobby,
    records,
    members,
    calls,
    reports,
    join,
    member,
    getMaxCreating: () => maxCreating,
  };
}

test("room joins create directly below lobby and move owner after ordering", async () => {
  const f = fixture();
  await f.join("u");
  const c = f.calls.find((x) => x.kind === "create");
  assert.equal(c.data.parent, "actual-category");
  assert.equal(c.data.position, 8);
  assert.deepEqual(
    f.calls.map((x) => x.kind),
    ["create", "position", "move", "panel"],
  );
  assert.equal(f.calls[1].position, 8);
  assert.equal(f.members.get("u").voice.channelId, "room1");
});
test("room can be created below a root-level lobby", async () => {
  const f = fixture({ parent: null });
  await f.join("u");
  assert.equal(f.calls[0].data.parent, null);
});
test("existing room reused without changing location or creating duplicate", async () => {
  const f = fixture({ existing: true });
  await f.join("u");
  assert.deepEqual(f.calls, [{ kind: "move", uid: "u", id: "existing" }]);
});
test("transient existing-room fetch failure preserves its record", async () => {
  const f = fixture({ existing: true, fetchFailure: true });
  await assert.rejects(() => f.join("u"));
  assert.ok(f.records.has("existing"));
  assert.equal(f.calls.length, 0);
});
test("leaving lobby before worker starts does not move the member", async () => {
  const f = fixture();
  f.members.get("u").voice.channelId = "other";
  await f.join("u");
  assert.equal(f.calls.length, 0);
});
test("leaving during creation removes unused new room", async () => {
  const f = fixture({ leaveDuringCreate: true });
  await assert.rejects(() => f.join("u"));
  assert.ok(f.calls.some((x) => x.kind === "delete"));
  assert.ok(!f.calls.some((x) => x.kind === "move"));
  assert.equal(f.records.size, 0);
});
test("ordering failure compensates new channel before movement", async () => {
  const f = fixture({ positionFailure: true });
  await assert.rejects(() => f.join("u"));
  assert.deepEqual(
    f.calls.map((x) => x.kind),
    ["create", "position", "delete"],
  );
  assert.equal(f.records.size, 0);
});
test("panel failure does not destroy occupied room", async () => {
  const f = fixture({ panelFailure: true });
  await f.join("u");
  assert.ok(f.records.has("room1"));
  assert.equal(f.members.get("u").voice.channelId, "room1");
  assert.ok(!f.calls.some((x) => x.kind === "delete"));
  assert.equal(f.reports.length, 1);
});
test("simultaneous members serialize creation and ordering", async () => {
  const f = fixture();
  f.member("v");
  await Promise.all([f.join("u"), f.join("v")]);
  assert.equal(f.getMaxCreating(), 1);
  assert.equal(f.records.size, 2);
  assert.equal(f.members.get("u").voice.channelId, "room1");
  assert.equal(f.members.get("v").voice.channelId, "room2");
});
test("failed compensation retains a recoverable room record", async () => {
  const f = fixture({ positionFailure: true, cleanupFailure: true });
  await assert.rejects(() => f.join("u"));
  assert.equal(f.records.get("room1").cleanupNeeded, true);
});

test("new room preserves lobby access restrictions", async () => {
  const f = fixture();
  await f.join("u");
  const ow = f.calls.find((x) => x.kind === "create").data.permissionOverwrites;
  const everyone = ow.find((x) => x.id === "guild"),
    owner = ow.find((x) => x.id === "u");
  assert.equal(everyone.deny, 1024n);
  assert.equal(everyone.allow, 0n);
  assert.notEqual(owner.allow & 1024n, 0n);
  assert.equal(owner.deny & 1024n, 0n);
});
