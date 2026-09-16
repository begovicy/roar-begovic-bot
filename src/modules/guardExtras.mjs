import { embed, row, button, session, readSession, EPH } from "../core/ui.mjs";
import { P, authorize } from "../core/auth.mjs";
import { id } from "../core/util.mjs";
const dangerous =
  P.Administrator |
  P.ManageGuild |
  P.ManageRoles |
  P.ManageChannels |
  P.ManageWebhooks |
  P.BanMembers |
  P.KickMembers |
  P.MentionEveryone;
export async function install(ctx) {
  const { db, c } = ctx;
  ctx.replace(["guardstatus"], async (m) => {
    await authorize(ctx, m, null, true);
    const cfg = await db.collection("guardConfig").findOne({ _id: m.guildId });
    await m.reply(
      embed(
        "Guard durumu",
        `Mod: **${cfg?.mode || "observe"}**\nEnforce yalnız eşik aşımında güvenli listede olmayanların bot altındaki yönetim rollerini kaldırır. Otomatik ban yok.`,
      ),
    );
  });
  ctx.add(["guardmode"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const mode = a[0];
    if (!["observe", "enforce"].includes(mode))
      throw Error(".guardmode observe / enforce");
    if (mode === "observe") {
      await db
        .collection("guardConfig")
        .updateOne({ _id: m.guildId }, { $set: { mode } }, { upsert: true });
      return m.reply(embed("Guard modu", "Yalnız gözlem."));
    }
    const bots = await db
      .collection("botIdentities")
      .find({ guildId: m.guildId })
      .toArray();
    if (new Set(bots.map((x) => x.userId)).size < 4)
      throw Error("Önce dört botun da en az bir kez bağlanması gerekli.");
    const t = await session(
      ctx,
      "guardMode",
      m.author.id,
      m.channelId,
      { mode },
      30,
    );
    await m.reply({
      ...embed(
        "Guard müdahalesini aç?",
        `Güvenli listede olmayan kullanıcı ${c.guardWindowSeconds} saniyede ${c.guardAlertThreshold} izinli denetim olayı eşiğine ulaşırsa, yönetim yetkisi içeren **botun altındaki rolleri kaldırılır**. Sunucu sahibi, yapılandırılmış kurucular ve ROAR botları hariçtir.\nYanlış pozitif riskine karşı önce test sunucusunda dene.`,
      ),
      components: [row(button("g:control:mode:" + t, "Onayla ve Aç", 4))],
    });
  });
  ctx.add(["yetki", "yt", "guardrestore"], async (m, a) => {
    await authorize(ctx, m, null, true);
    if (!a[0]) {
      const r = await db
        .collection("guardIncidents")
        .find({ guildId: m.guildId, status: "applied" })
        .sort({ at: -1 })
        .limit(10)
        .toArray();
      return m.reply(
        embed(
          "Geri yüklenebilir müdahaleler",
          r.map((x) => `<@${x.userId}> · \`${x._id}\``).join("\n") || "Yok.",
        ),
      );
    }
    const r = await db
      .collection("guardIncidents")
      .findOne({ _id: a[0], guildId: m.guildId, status: "applied" });
    if (!r) throw Error("Geri yüklenebilir olay yok.");
    const t = await session(
      ctx,
      "restoreIncident",
      m.author.id,
      m.channelId,
      { incidentId: r._id },
      30,
    );
    await m.reply({
      ...embed(
        "Yetkileri geri ver?",
        `Hedef: <@${r.userId}>\nRoller: ${r.roles.map((x) => `<@&${x.id}>`).join(", ")}\nYalnız izinleri değişmemiş ve botun altındaki roller geri verilir.`,
      ),
      components: [
        row(button("g:control:restore:" + t, "Onayla ve Geri Ver", 4)),
      ],
    });
  });
  ctx.onInteraction(async (i) => {
    const [, , action, token] = i.customId.split(":"),
      s = await readSession(ctx, i, token);
    await authorize(ctx, i, null, true);
    await i.deferUpdate();
    if (action === "mode" && s.kind === "guardMode") {
      await db
        .collection("guardConfig")
        .updateOne(
          { _id: i.guildId },
          { $set: { mode: "enforce" } },
          { upsert: true },
        );
      await db.collection("sessions").deleteOne({ _id: token });
      return i.editReply({
        ...embed(
          "Guard modu",
          "Kontrollü rol kaldırma etkin. Otomatik ban veya kanal geri yükleme yapılmaz.",
        ),
        components: [],
      });
    }
    if (action === "restore" && s.kind === "restoreIncident") {
      await ctx.lock("restore:" + s.data.incidentId, async () => {
        const r = await db
          .collection("guardIncidents")
          .findOne({
            _id: s.data.incidentId,
            guildId: i.guildId,
            status: "applied",
          });
        if (!r) throw Error("Olay zaten işlenmiş.");
        const member = await i.guild.members.fetch(r.userId);
        for (const old of r.roles) {
          const role = await i.guild.roles.fetch(old.id);
          if (
            !role?.editable ||
            role.managed ||
            role.permissions.bitfield.toString() !== old.permissions
          )
            throw Error(
              "Rol değişmiş veya yönetilemiyor; manuel inceleme gerekli.",
            );
        }
        await member.roles.add(r.roles.map((x) => x.id));
        await db
          .collection("guardIncidents")
          .updateOne(
            { _id: r._id },
            { $set: { status: "restored", restoredBy: i.user.id } },
          );
        await db.collection("sessions").deleteOne({ _id: token });
        await i.editReply({
          ...embed("Yetkiler geri verildi", `<@${member.id}>`),
          components: [],
        });
      });
      return;
    }
    throw Error("Geçersiz onay.");
  }, "g:control:");
  ctx.event("guildAuditLogEntryCreate", async (e, g) => {
    if (
      g.id !== c.guildId ||
      !e.executorId ||
      Date.now() - e.createdTimestamp > 10000 ||
      !c.guardEnforceActions.includes(e.action)
    )
      return;
    const identities = await db
        .collection("botIdentities")
        .find({ guildId: g.id })
        .toArray(),
      safe = new Set([
        g.ownerId,
        ...c.owners,
        ...c.guardSafeUserIds,
        ...c.guardSafeBotIds,
        ...identities.map((x) => x.userId),
      ]);
    if (safe.has(e.executorId)) return;
    try {
      await db
        .collection("guardWindow")
        .insertOne({
          _id: e.id,
          guildId: g.id,
          userId: e.executorId,
          at: new Date(),
          expiresAt: new Date(Date.now() + 120000),
        });
    } catch (err) {
      if (err.code === 11000) return;
      throw err;
    }
    const n = await db
      .collection("guardWindow")
      .countDocuments({
        guildId: g.id,
        userId: e.executorId,
        at: { $gte: new Date(Date.now() - c.guardWindowSeconds * 1000) },
      });
    if (n < c.guardAlertThreshold) return;
    await ctx.lock("guard:" + e.executorId, async () => {
      const mode = await db.collection("guardConfig").findOne({ _id: g.id });
      if (mode?.mode !== "enforce") {
        await ctx.log(
          g,
          "Guard sıklık uyarısı",
          `<@${e.executorId}> · ${n} olay\nGözlem modu; müdahale yok.`,
          c.guardLogChannelId,
        );
        return;
      }
      if (new Set(identities.map((x) => x.userId)).size < 4)
        throw Error("Bot kimlikleri eksik; müdahale durduruldu.");
      if (
        await db
          .collection("guardIncidents")
          .findOne({
            guildId: g.id,
            userId: e.executorId,
            at: { $gte: new Date(Date.now() - 90000) },
          })
      )
        return;
      const member = await g.members.fetch(e.executorId),
        me = await g.members.fetchMe();
      if (
        !me.permissions.has(P.ManageRoles) ||
        me.roles.highest.comparePositionTo(member.roles.highest) <= 0
      )
        throw Error("Guard rolü müdahale için yeterli değil.");
      const roles = member.roles.cache
        .filter(
          (r) =>
            r.id !== g.id &&
            !r.managed &&
            r.editable &&
            (r.permissions.bitfield & dangerous) !== 0n,
        )
        .map((r) => ({
          id: r.id,
          permissions: r.permissions.bitfield.toString(),
        }));
      if (!roles.length) return;
      const incident = {
        _id: id(),
        guildId: g.id,
        userId: member.id,
        roles,
        status: "pending",
        at: new Date(),
        auditId: e.id,
      };
      await db.collection("guardIncidents").insertOne(incident);
      try {
        await member.roles.remove(
          roles.map((x) => x.id),
          "ROAR Guard olay limiti",
        );
        await db
          .collection("guardIncidents")
          .updateOne({ _id: incident._id }, { $set: { status: "applied" } });
      } catch (err) {
        await db
          .collection("guardIncidents")
          .updateOne(
            { _id: incident._id },
            { $set: { status: "review_required" } },
          );
        throw err;
      }
      await ctx.log(
        g,
        "Guard müdahalesi",
        `<@${member.id}> · Yönetim rolleri kaldırıldı.\nOlay: \`${incident._id}\`\nGeri verme: .guardrestore olayID`,
        c.guardLogChannelId,
      );
    });
  });
  await db
    .collection("guardWindow")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  ctx.add(["yedek-plan"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const b = await db
      .collection("backups")
      .findOne({ _id: a[0], guildId: m.guildId });
    if (!b) throw Error("Yedek bulunamadı.");
    await m.guild.roles.fetch();
    await m.guild.channels.fetch();
    const roles = b.roles.filter((x) => !m.guild.roles.cache.has(x.id)),
      channels = b.channels.filter((x) => !m.guild.channels.cache.has(x.id));
    await m.reply(
      embed(
        "Yedek karşılaştırması",
        `Eksik rol: ${roles.length}\nEksik kanal: ${channels.length}\nBu komut değişiklik yapmaz. Eski mesajlar/aynı Discord ID’leri geri getirilemez.`,
      ),
    );
  });
}
