import { attachCard } from "../core/cards.mjs";
import {
  embed,
  row,
  button,
  select,
  session,
  readSession,
} from "../core/ui.mjs";
import {
  day,
  chunks,
  elapsed,
  money,
  snowflake,
  amount,
} from "../core/util.mjs";
export async function install(ctx) {
  const { db, c } = ctx,
    live = new Map();
  const valid = (s) =>
    s?.channelId &&
    !s.member?.user.bot &&
    s.channelId !== s.guild.afkChannelId &&
    !c.ignoredStatChannelIds.includes(s.channelId);
  const seed = () => {
    live.clear();
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (g)
      for (const s of g.voiceStates.cache.values())
        if (valid(s))
          live.set(s.id, {
            at: Date.now(),
            channelId: s.channelId,
            stream: s.streaming,
            camera: s.selfVideo,
          });
  };
  async function tick(s) {
    await ctx.lock("stat:" + s.id, async () => {
      const now = Date.now(),
        old = live.get(s.id);
      if (old && now > old.at && now - old.at <= 60000)
        await ctx.tx(async (sess) => {
          for (const p of chunks(old.at, now))
            await db.collection("stats").updateOne(
              {
                guildId: c.guildId,
                userId: s.id,
                channelId: old.channelId,
                day: p.day,
              },
              {
                $inc: {
                  voice: p.ms,
                  stream: old.stream ? p.ms : 0,
                  camera: old.camera ? p.ms : 0,
                },
              },
              { session: sess, upsert: true },
            );
        });
      if (valid(s))
        live.set(s.id, {
          at: now,
          channelId: s.channelId,
          stream: s.streaming,
          camera: s.selfVideo,
        });
      else live.delete(s.id);
    });
  }
  ctx.onReady(seed);
  ctx.event("shardDisconnect", () => live.clear());
  ctx.event("shardResume", seed);
  ctx.event("voiceStateUpdate", async (_, s) => {
    if (s.guild.id === c.guildId) await tick(s);
  });
  ctx.every(30000, async () => {
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (g) for (const s of g.voiceStates.cache.values()) await tick(s);
  });
  await db
    .collection("statEvents")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  ctx.event("messageCreate", async (m) => {
    if (
      m.guildId !== c.guildId ||
      m.author.bot ||
      c.ignoredStatChannelIds.includes(m.channelId)
    )
      return;
    try {
      await ctx.tx(async (s) => {
        if (
          await db
            .collection("statEvents")
            .findOne({ _id: m.id }, { session: s })
        )
          return;
        await db
          .collection("statEvents")
          .insertOne(
            { _id: m.id, expiresAt: new Date(Date.now() + 604800000) },
            { session: s },
          );
        await db.collection("stats").updateOne(
          {
            guildId: c.guildId,
            userId: m.author.id,
            channelId: m.channelId,
            day: day(m.createdTimestamp),
          },
          { $inc: { messages: 1 } },
          { session: s, upsert: true },
        );
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  });
  const match = (days, uid) => ({
    guildId: c.guildId,
    ...(uid ? { userId: uid } : {}),
    ...(days ? { day: { $gte: day(Date.now() - (days - 1) * 86400000) } } : {}),
  });
  ctx.add(["stat", "me", "stats"], async (m, a) => {
    let uid = m.author.id,
      days = 7;
    if (a[0] && (/^<@/.test(a[0]) || /^\d{17,20}$/.test(a[0]))) {
      uid = snowflake(a.shift());
      await m.guild.members.fetch(uid);
    }
    if (a[0]) days = amount(a[0], 365);
    const res = await db
        .collection("stats")
        .aggregate([
          { $match: match(days, uid) },
          {
            $group: {
              _id: null,
              messages: { $sum: "$messages" },
              voice: { $sum: "$voice" },
              stream: { $sum: "$stream" },
              camera: { $sum: "$camera" },
            },
          },
        ])
        .toArray(),
      z = res[0] || {};
    await m.reply(
      embed(
        "ROAR · İstatistik",
        `<@${uid}> · ${days} takvim günü (bugün dahil)\nMesaj: ${money(z.messages || 0)}\nSes: ${elapsed(z.voice || 0)}\nYayın: ${elapsed(z.stream || 0)}\nKamera: ${elapsed(z.camera || 0)}\nSaat dilimi: Europe/Istanbul. Çevrimdışı süre sayılmaz.`,
      ),
    );
  });
  const metrics = {
    messages: "Mesaj",
    voice: "Ses",
    stream: "Yayın",
    camera: "Kamera",
  };
  async function view(token, data) {
    const type = metrics[data.type] ? data.type : "messages",
      pipe = [
        { $match: match(data.days) },
        { $group: { _id: "$userId", value: { $sum: "$" + type } } },
        { $match: { value: { $gt: 0 } } },
        { $sort: { value: -1, _id: 1 } },
      ],
      count = await db
        .collection("stats")
        .aggregate([...pipe, { $count: "n" }])
        .toArray(),
      pages = Math.max(1, Math.ceil((count[0]?.n || 0) / 10)),
      page = Math.min(Math.max(0, data.page), pages - 1),
      list = await db
        .collection("stats")
        .aggregate([...pipe, { $skip: page * 10 }, { $limit: 10 }])
        .toArray(),
      p = embed(
        "ROAR · " + metrics[type] + " Sıralaması",
        `${data.days ? data.days + " takvim günü" : "Tüm zamanlar"}\n\n` +
          (list
            .map(
              (x, j) =>
                `\`${page * 10 + j + 1}\` <@${x._id}> · **${type === "messages" ? money(x.value) + " mesaj" : elapsed(x.value)}**`,
            )
            .join("\n") || "Henüz veri yok."),
      );
    p.components = [
      select(
        `s:${token}:days`,
        "Zaman filtresi",
        [
          ["Günlük", "1"],
          ["Haftalık", "7"],
          ["Aylık", "30"],
          ["Tüm zamanlar", "0"],
        ].map(([label, value]) => ({ label, value })),
      ),
      select(
        `s:${token}:metric`,
        "Kategori",
        Object.entries(metrics).map(([value, label]) => ({ value, label })),
      ),
      row(
        button(`s:${token}:page:${Math.max(0, page - 1)}`, "Önceki"),
        { ...button("noop", `${page + 1}/${pages}`), disabled: true },
        button(`s:${token}:page:${Math.min(pages - 1, page + 1)}`, "Sonraki"),
      ),
    ];
    const guild = ctx.client.guilds.cache.get(c.guildId);
    const rows = await Promise.all(
      list.map(async (x, j) => ({
        rank: page * 10 + j + 1,
        name:
          (await guild.members.fetch(x._id).catch(() => null))?.displayName ||
          "Ayrılan üye",
        value:
          type === "messages" ? money(x.value) + " mesaj" : elapsed(x.value),
      })),
    );
    return attachCard(p, "ranking", {
      title: metrics[type] + " Sıralaması",
      rows,
    });
  }
  ctx.add(["top", "sıralama"], async (m) => {
    const d = { type: "messages", days: 7, page: 0 },
      t = await session(ctx, "top", m.author.id, m.channelId, d, 600);
    await m.reply(await view(t, d));
  });
  ctx.onInteraction(async (i) => {
    const [, t, a, v] = i.customId.split(":");
    await i.deferUpdate();
    await ctx.lock(t, async () => {
      const s = await readSession(ctx, i, t);
      if (s.kind !== "top") throw Error("Geçersiz panel.");
      const d = { ...s.data };
      if (a === "days") {
        if (!["0", "1", "7", "30"].includes(i.values[0]))
          throw Error("Geçersiz gün.");
        d.days = Number(i.values[0]);
        d.page = 0;
      } else if (a === "metric") {
        if (!metrics[i.values[0]]) throw Error("Geçersiz kategori.");
        d.type = i.values[0];
        d.page = 0;
      } else if (a === "page") {
        if (!/^\d+$/.test(v)) throw Error("Geçersiz sayfa.");
        d.page = Math.min(Number(v), 100000);
      } else throw Error("Geçersiz işlem.");
      await db
        .collection("sessions")
        .updateOne({ _id: t }, { $set: { data: d } });
      await i.editReply(await view(t, d));
    });
  });
}
