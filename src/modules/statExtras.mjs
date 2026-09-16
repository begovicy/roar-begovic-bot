import { embed } from "../core/ui.mjs";
import { P, authorize } from "../core/auth.mjs";
import { snowflake, id, day } from "../core/util.mjs";
import { xpLevel } from "../core/policy.mjs";
export async function install(ctx) {
  const { db, c } = ctx;
  let invites = new Map();
  await db
    .collection("inviteJoins")
    .createIndex({ guildId: 1, userId: 1, joinedAt: 1 }, { unique: true });
  async function snapshot(g) {
    try {
      const fetched = await g.invites.fetch();
      return new Map(
        fetched.map((x) => [
          x.code,
          { uses: x.uses || 0, inviterId: x.inviterId },
        ]),
      );
    } catch (e) {
      ctx.report("Davet listesi alınamadı; Manage Guild gerekli", e);
      return null;
    }
  }
  ctx.onReady(async () => {
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (g) invites = (await snapshot(g)) || new Map();
  });
  ctx.event("inviteCreate", async (invite) => {
    if (invite.guild.id === c.guildId)
      invites = (await snapshot(invite.guild)) || invites;
  });
  ctx.event("inviteDelete", async (invite) => {
    if (invite.guild.id === c.guildId) invites.delete(invite.code);
  });
  ctx.event("guildMemberAdd", async (m) => {
    if (m.guild.id !== c.guildId || m.user.bot) return;
    await ctx.lock("invites", async () => {
      const fresh = await snapshot(m.guild),
        delta = fresh
          ? [...fresh].filter(
              ([code, v]) =>
                (!invites.has(code) && v.uses > 0) ||
                (invites.has(code) && v.uses !== invites.get(code).uses),
            )
          : [];
      const inviterId =
        delta.length === 1 &&
        invites.has(delta[0][0]) &&
        delta[0][1].uses - invites.get(delta[0][0]).uses === 1
          ? delta[0][1].inviterId
          : null;
      const record = {
        guildId: c.guildId,
        userId: m.id,
        joinedAt: new Date(m.joinedTimestamp),
        inviterId,
        source: inviterId ? "invite" : "unknown",
        active: true,
      };
      try {
        await db.collection("inviteJoins").insertOne(record);
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
      if (fresh) invites = fresh;
    });
  });
  ctx.event("guildMemberRemove", async (m) => {
    if (m.guild.id === c.guildId)
      await db
        .collection("inviteJoins")
        .updateMany(
          { guildId: c.guildId, userId: m.id, active: true },
          { $set: { active: false, leftAt: new Date() } },
        );
  });
  ctx.add(["davet", "invites"], async (m, a) => {
    const uid = a[0] ? snowflake(a[0]) : m.author.id;
    const all = await db
        .collection("inviteJoins")
        .countDocuments({ guildId: m.guildId, inviterId: uid }),
      active = await db
        .collection("inviteJoins")
        .countDocuments({ guildId: m.guildId, inviterId: uid, active: true });
    await m.reply(
      embed(
        "Davet istatistiği",
        `<@${uid}>\nTespit edilen katılımlar: ${all}\nKayda göre aktif: ${active}\nAyrılan: ${all - active}\nVanity, silinen/tek kullanımlık ve eşzamanlı belirsiz davetler kişiye yazılmaz.`,
      ),
    );
  });
  ctx.add(["davet-top"], async (m) => {
    const rows = await db
      .collection("inviteJoins")
      .aggregate([
        { $match: { guildId: m.guildId, inviterId: { $ne: null } } },
        { $group: { _id: "$inviterId", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 30 },
      ])
      .toArray();
    await m.reply(
      embed(
        "Davet sıralaması",
        rows
          .map((x, j) => `\`${j + 1}\` <@${x._id}> · ${x.n} davet`)
          .join("\n") || "Veri yok.",
      ),
    );
  });
  ctx.event("guildMemberUpdate", async (old, m) => {
    if (m.guild.id !== c.guildId) return;
    const added = m.roles.cache
        .filter((r) => !old.roles.cache.has(r.id))
        .map((r) => r.id),
      removed = old.roles.cache
        .filter((r) => !m.roles.cache.has(r.id))
        .map((r) => r.id);
    if (added.length || removed.length)
      await db
        .collection("roleHistory")
        .insertOne({
          _id: id(),
          guildId: c.guildId,
          userId: m.id,
          added,
          removed,
          at: new Date(),
        });
  });
  ctx.add(["rollog", "rl"], async (m, a) => {
    await authorize(ctx, m, P.ManageRoles);
    const uid = snowflake(a[0]),
      list = await db
        .collection("roleHistory")
        .find({ guildId: m.guildId, userId: uid })
        .sort({ at: -1 })
        .limit(10)
        .toArray();
    await m.reply(
      embed(
        "Rol değişikliği geçmişi",
        list
          .map(
            (x) =>
              `<t:${Math.floor(x.at / 1000)}:R>\n+ ${x.added.map((r) => `<@&${r}>`).join(", ") || "—"}\n− ${x.removed.map((r) => `<@&${r}>`).join(", ") || "—"}`,
          )
          .join("\n\n") || "Kayıt yok.",
      ),
    );
  });
  ctx.add(["level", "lvl", "seviye"], async (m, a) => {
    const uid = a[0] ? snowflake(a[0]) : m.author.id,
      res = await db
        .collection("stats")
        .aggregate([
          { $match: { guildId: m.guildId, userId: uid } },
          {
            $group: {
              _id: null,
              messages: { $sum: "$messages" },
              voice: { $sum: "$voice" },
            },
          },
        ])
        .toArray(),
      z = res[0] || {};
    await m.reply(
      embed(
        "ROAR · Seviye",
        `<@${uid}> · **Seviye ${xpLevel(z.messages || 0, z.voice || 0)}**\nFormül: mesaj × 5 ve ses dakikasının toplamının karekökü / 5. Görünür istatistikten hesaplanır; bağımsız ödül vermez.`,
      ),
    );
  });
}
