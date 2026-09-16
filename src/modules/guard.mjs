import { embed } from "../core/ui.mjs";
import { authorize } from "../core/auth.mjs";
import { id } from "../core/util.mjs";
export async function install(ctx) {
  const { db, c } = ctx;
  ctx.event("guildAuditLogEntryCreate", async (e, g) => {
    if (g.id !== c.guildId) return;
    const actor = e.executorId,
      safe =
        actor &&
        (c.owners.includes(actor) ||
          c.guardSafeUserIds.includes(actor) ||
          actor === g.ownerId);
    try {
      await db.collection("audit").insertOne({
        _id: e.id,
        guildId: g.id,
        actorId: actor || null,
        targetId: e.targetId || null,
        action: e.action,
        safe: !!safe,
        at: new Date(e.createdTimestamp),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      });
    } catch (err) {
      if (err.code === 11000) return;
      throw err;
    }
    await ctx.log(
      g,
      "ROAR Guard · Gözlem",
      `İşlem: ${e.action}\nYetkili: ${actor ? `<@${actor}>` : "Bilinmiyor"}\nHedef: \`${e.targetId || "—"}\`\nGüvenli listede: ${safe ? "Evet" : "Hayır / bilinmiyor"}\nBu mesaj olay kaydıdır. Müdahale varsa ayrı bir Guard bildirimi gönderilir.`,
      c.guardLogChannelId,
    );
  });
  ctx.add(["guardstatus"], async (m) => {
    await authorize(ctx, m, null, true);
    const n = await db.collection("audit").countDocuments({
      guildId: c.guildId,
      at: { $gte: new Date(Date.now() - 86400000) },
    });
    await m.reply(
      embed(
        "ROAR Guard",
        "Mod: **yalnız gözlem**\nSon 24 saat: " +
          n +
          " olay.\nOtomatik ceza ve geri yükleme kapalı.",
      ),
    );
  });
  ctx.add(["yedek"], async (m) => {
    await authorize(ctx, m, null, true);
    await m.guild.roles.fetch();
    await m.guild.channels.fetch();
    const snap = {
      _id: id(),
      guildId: c.guildId,
      at: new Date(),
      actorId: m.author.id,
      roles: m.guild.roles.cache.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
        managed: r.managed,
        permissions: r.permissions.bitfield.toString(),
      })),
      channels: m.guild.channels.cache
        .filter((x) => !x.isThread())
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type,
          parentId: ch.parentId,
          position: ch.rawPosition,
          overwrites:
            ch.permissionOverwrites?.cache.map((o) => ({
              id: o.id,
              type: o.type,
              allow: o.allow.bitfield.toString(),
              deny: o.deny.bitfield.toString(),
            })) || [],
        })),
    };
    await db.collection("backups").insertOne(snap);
    await m.reply(
      embed(
        "Yapı yedeği kaydedildi",
        `\`${snap._id}\`\nMongoDB'ye rol/kanal yapısı kaydedildi. Mesajlar, üye-rol eşleşmeleri ve otomatik geri yükleme dahil değil.`,
      ),
    );
  });
}
