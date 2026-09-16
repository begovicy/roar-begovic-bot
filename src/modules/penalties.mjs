import { effectiveChannelPermissions } from "../core/policy.mjs";
import {
  embed,
  row,
  button,
  select,
  session,
  readSession,
  EPH,
} from "../core/ui.mjs";
import { P, authorize, target } from "../core/auth.mjs";
import { id, snowflake, duration, clean, amount } from "../core/util.mjs";
const reasons = [
  ["Kışkırtma, trol ve dalgacı davranış", 3],
  ["ROAR ortamını kötülemek", 5],
  ["Küfür, hakaret ve rahatsızlık", 1],
  ["Sunucu düzenini bozmak", 4],
];
export async function install(ctx) {
  const { db, c } = ctx;
  await db
    .collection("forceRules")
    .createIndex({ guildId: 1, userId: 1 }, { unique: true });
  await db
    .collection("cases")
    .createIndex(
      { guildId: 1, caseNo: 1 },
      { unique: true, partialFilterExpression: { caseNo: { $exists: true } } },
    );
  async function record(guildId, userId, actorId, type, reason, extra = {}) {
    const n = await db
      .collection("sequences")
      .findOneAndUpdate(
        { _id: guildId + ":case" },
        { $inc: { value: 1 } },
        { upsert: true, returnDocument: "after", includeResultMetadata: false },
      );
    const r = {
      _id: id(),
      caseNo: n.value,
      guildId,
      userId,
      actorId,
      type,
      reason: clean(reason),
      status: "pending",
      at: new Date(),
      ...extra,
    };
    await db.collection("cases").insertOne(r);
    return r;
  }
  async function safeRole(g, rid) {
    if (!rid) throw Error("Ceza rolü ayarlanmamış.");
    const r = await g.roles.fetch(rid);
    if (!r || r.managed || !r.editable || r.permissions.bitfield !== 0n)
      throw Error("Ceza rolü sıfır yetkili ve botun altında olmalı.");
    return r;
  }
  async function checkAcl(g, m, type) {
    if (!["jail", "cmute"].includes(type)) return;
    await g.channels.fetch();
    const chosen =
      type === "jail"
        ? [
            g.roles.everyone,
            ...m.roles.cache.filter((r) => r.managed).values(),
            await safeRole(g, c.jailRoleId),
          ]
        : [...m.roles.cache.values(), await safeRole(g, c.textMuteRoleId)];
    for (const ch of g.channels.cache.values()) {
      if (ch.isThread() || !ch.permissionOverwrites) continue;
      const bits = effectiveChannelPermissions(
        m.id,
        g.id,
        chosen.map((r) => ({ id: r.id, permissions: r.permissions.bitfield })),
        ch.permissionOverwrites.cache.map((o) => ({
          id: o.id,
          allow: o.allow.bitfield,
          deny: o.deny.bitfield,
        })),
      );
      if (
        type === "jail" &&
        ch.id !== c.jailChannelId &&
        (bits & P.ViewChannel) !== 0n
      )
        throw Error(
          "Jail izinleri eksik veya başka izin tarafından geçersiz kılınıyor. Önce .cezaizin jail kullanın; özel üye izinlerini inceleyin.",
        );
      if (
        type === "cmute" &&
        (bits & P.ViewChannel) !== 0n &&
        (bits &
          (P.SendMessages |
            P.SendMessagesInThreads |
            P.CreatePublicThreads |
            P.CreatePrivateThreads)) !==
          0n
      )
        throw Error(
          "Metin mute bu üyede etkili değil. .cezaizin cmute ile kurulumu yapın; rol/üye izinleri çakışıyorsa Discord timeout kullanın.",
        );
    }
  }
  ctx.add(["cezaizin"], async (m, a) => {
    await authorize(ctx, m, null, true);
    if (!["jail", "cmute"].includes(a[0]))
      throw Error(".cezaizin jail / cmute");
    const role = await safeRole(
        m.guild,
        a[0] === "jail" ? c.jailRoleId : c.textMuteRoleId,
      ),
      token = await session(
        ctx,
        "penaltySetup",
        m.author.id,
        m.channelId,
        { type: a[0], roleId: role.id },
        60,
      );
    await m.reply({
      ...embed(
        "Ceza rolü izinlerini kur?",
        `<@&${role.id}> için mevcut kanallara kısıtlama eklenecek. Özel üye/diğer rol izinleri kısıtlamayı geçersiz kılabilir; ceza öncesi etkili izin ayrıca denetlenir. Yeni kanallar için kurulumu yeniden çalıştırın.`,
      ),
      components: [
        row(button("m:pen:" + token + ":setup", "Onayla ve Kur", 4)),
      ],
    });
  });
  async function apply(g, m, r) {
    await checkAcl(g, m, r.type);
    if (r.type === "jail") {
      await safeRole(g, c.jailRoleId);
      const keep = m.roles.cache
        .filter((x) => x.managed && x.id !== g.id)
        .map((x) => x.id);
      await m.roles.set([...keep, c.jailRoleId], `ROAR ceza #${r.caseNo}`);
    } else if (r.type === "cmute") {
      await safeRole(g, c.textMuteRoleId);
      await m.roles.add(c.textMuteRoleId);
    } else if (r.type === "vmute" && m.voice.channelId && !m.voice.serverMute) {
      await m.voice.setMute(true, `ROAR ceza #${r.caseNo}`);
      await db
        .collection("cases")
        .updateOne({ _id: r._id }, { $set: { appliedMute: true } });
    }
  }
  async function release(g, r, actorId = "system") {
    r = await db
      .collection("cases")
      .findOne({
        _id: r._id,
        status: { $in: ["active", "pending", "review_required"] },
      });
    if (!r) return;
    const m = await g.members.fetch(r.userId).catch((e) => {
      if (e.code === 10007) return null;
      throw e;
    });
    const skipped = [];
    if (m) {
      if (r.type === "jail") {
        const restore = [];
        for (const rid of r.savedRoles || []) {
          const role = await g.roles.fetch(rid);
          if (
            role &&
            !role.managed &&
            role.editable &&
            role.permissions.bitfield === 0n
          )
            restore.push(rid);
          else if (role) skipped.push(rid);
        }
        if (restore.length) await m.roles.add(restore);
        await m.roles.remove(r.roleId || c.jailRoleId);
      } else if (r.type === "cmute")
        await m.roles.remove(r.roleId || c.textMuteRoleId);
      else if (r.type === "vmute" && r.appliedMute && m.voice.channelId)
        await m.voice.setMute(false, `ROAR ceza kaldırma #${r.caseNo}`);
    }
    await db
      .collection("cases")
      .updateOne(
        { _id: r._id },
        {
          $set: {
            status: actorId === "system" ? "expired" : "revoked",
            revokedBy: actorId,
            revokedAt: new Date(),
            restoreSkipped: skipped,
            cleanupNeeded:
              r.type === "vmute" && !!r.appliedMute && !m?.voice.channelId,
          },
        },
      );
    await ctx.log(
      g,
      "Ceza kaldırıldı",
      `<@${r.userId}> · ${r.type} · #${r.caseNo}\n${skipped.length ? "Güçlü roller otomatik geri verilmedi; kurucu incelemeli." : "Süreç tamamlandı."}`,
    );
  }
  async function punish(m, uid, type, ms, reason) {
    const perm = type === "vmute" ? P.MuteMembers : P.ManageRoles,
      t = await target(ctx, m, uid, perm);
    if (t.user.bot) throw Error("Bu ceza botlara uygulanmaz.");
    if (type === "vmute" && t.voice.serverMute)
      throw Error("Üye zaten sunucu tarafından susturulmuş.");
    await checkAcl(m.guild, t, type);
    return ctx.lock("pen:" + uid, async () => {
      if (
        await db
          .collection("cases")
          .findOne({
            guildId: m.guildId,
            userId: uid,
            type,
            status: { $in: ["active", "pending", "review_required"] },
          })
      )
        throw Error("Bu türde açık ceza var; önce inceleyin.");
      const roleId =
        type === "jail"
          ? c.jailRoleId
          : type === "cmute"
            ? c.textMuteRoleId
            : null;
      if (roleId) await safeRole(m.guild, roleId);
      const r = await record(
        m.guildId,
        uid,
        m.author?.id || m.user.id,
        type,
        reason,
        {
          expiresAt: new Date(Date.now() + ms),
          roleId,
          savedRoles:
            type === "jail"
              ? t.roles.cache
                  .filter((x) => !x.managed && x.id !== m.guildId)
                  .map((x) => x.id)
              : [],
        },
      );
      try {
        await apply(m.guild, t, r);
        await db
          .collection("cases")
          .updateOne({ _id: r._id }, { $set: { status: "active" } });
      } catch (e) {
        await db
          .collection("cases")
          .updateOne({ _id: r._id }, { $set: { status: "review_required" } });
        throw e;
      }
      await ctx.log(
        m.guild,
        "Ceza uygulandı",
        `<@${uid}> · ${type} · #${r.caseNo}\n${r.reason}`,
      );
      return r;
    });
  }
  ctx.add(["jail", "karantina", "cezali"], async (m, a) => {
    const uid = snowflake(a[0]);
    await target(ctx, m, uid, P.ManageRoles);
    const token = await session(ctx, "jail", m.author.id, m.channelId, { uid });
    await m.reply({
      ...embed("Ceza sebebi", `<@${uid}> için ceza sebebi seçin.`),
      components: [
        select(
          `m:pen:${token}:jail`,
          "Sebep seçin",
          reasons.map(([label, days], i) => ({
            label,
            value: String(i),
            description: `${days} gün`,
          })),
        ),
      ],
    });
  });
  for (const [type, names] of [
    ["cmute", ["mute", "cmute", "chatmute"]],
    ["vmute", ["voicemute", "vmute"]],
  ])
    ctx.add(names, async (m, a) => {
      const r = await punish(
        m,
        snowflake(a[0]),
        type,
        duration(a[1]),
        a.slice(2).join(" ") || "Sebep belirtilmedi",
      );
      await m.reply(
        embed("Ceza uygulandı", `#${r.caseNo} · <@${r.userId}> · ${type}`),
      );
    });
  for (const [type, names] of [
    ["jail", ["unjail"]],
    ["cmute", ["unmute", "uncmute"]],
    ["vmute", ["unvmute", "unvoicemute"]],
  ])
    ctx.add(names, async (m, a) => {
      const uid = snowflake(a[0]);
      await target(
        ctx,
        m,
        uid,
        type === "vmute" ? P.MuteMembers : P.ManageRoles,
      );
      await ctx.lock("pen:" + uid, async () => {
        const r = await db
          .collection("cases")
          .findOne({
            guildId: m.guildId,
            userId: uid,
            type,
            status: { $in: ["active", "review_required", "pending"] },
          });
        if (!r) throw Error("Aktif ceza yok.");
        await release(m.guild, r, m.author.id);
      });
      await m.reply(embed("Ceza kaldırıldı", `<@${uid}> · ${type}`));
    });
  ctx.add(["forceban"], async (m, a) => {
    const uid = snowflake(a[0]);
    await target(ctx, m, uid, P.BanMembers);
    const reason = clean(a.slice(1).join(" ") || "Sebep belirtilmedi");
    await ctx.lock("force:" + uid, async () => {
      if (
        await db
          .collection("forceRules")
          .findOne({ guildId: m.guildId, userId: uid })
      )
        throw Error("Kullanıcı forceban listesinde.");
      const r = await record(m.guildId, uid, m.author.id, "forceban", reason);
      await db
        .collection("forceRules")
        .insertOne({
          guildId: m.guildId,
          userId: uid,
          caseId: r._id,
          actorId: m.author.id,
          reason,
        });
      try {
        await m.guild.members.ban(uid, { reason });
        await db
          .collection("cases")
          .updateOne({ _id: r._id }, { $set: { status: "active" } });
      } catch (e) {
        await db
          .collection("cases")
          .updateOne({ _id: r._id }, { $set: { status: "review_required" } });
        throw e;
      }
      await m.reply(
        embed(
          "Forceban uygulandı",
          `<@${uid}> · #${r.caseNo}\nSunucu içi kalıcı yasak; IP yasağı değildir.`,
        ),
      );
    });
  });
  ctx.add(["unforceban"], async (m, a) => {
    await authorize(ctx, m, P.BanMembers, true);
    const uid = snowflake(a[0]);
    await ctx.lock("force:" + uid, async () => {
      const r = await db
        .collection("forceRules")
        .findOne({ guildId: m.guildId, userId: uid });
      if (!r) throw Error("Forceban kaydı yok.");
      await db
        .collection("forceRules")
        .updateOne(
          { _id: r._id },
          { $set: { releasing: true, releasingBy: m.author.id } },
        );
      try {
        await m.guild.members.unban(uid, `ROAR • ${m.author.id}`).catch((e) => {
          if (e.code !== 10026) throw e;
        });
        await db
          .collection("cases")
          .updateOne(
            { _id: r.caseId },
            { $set: { status: "revoked", revokedBy: m.author.id } },
          );
        await db.collection("forceRules").deleteOne({ _id: r._id });
      } catch (e) {
        await db
          .collection("forceRules")
          .updateOne({ _id: r._id }, { $unset: { releasing: "" } });
        throw e;
      }
    });
    await m.reply(embed("Forceban kaldırıldı", `<@${uid}>`));
  });
  ctx.replace(["unban"], async (m, a) => {
    await authorize(ctx, m, P.BanMembers);
    const uid = snowflake(a[0]);
    if (
      await db
        .collection("forceRules")
        .findOne({ guildId: m.guildId, userId: uid })
    )
      throw Error("Önce kurucu .unforceban kullanmalı.");
    await m.guild.members.unban(uid);
    await db
      .collection("cases")
      .updateMany(
        { guildId: m.guildId, userId: uid, type: "ban", status: "active" },
        { $set: { status: "revoked", revokedBy: m.author.id } },
      );
    await m.reply(embed("Ban kaldırıldı", `<@${uid}>`));
  });
  ctx.add(["ceza"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers);
    const n = Number(a[0]),
      r = await db
        .collection("cases")
        .findOne({
          guildId: m.guildId,
          ...(Number.isSafeInteger(n) ? { caseNo: n } : { _id: a[0] }),
        });
    if (!r) throw Error("Ceza yok.");
    await m.reply(
      embed(
        "Ceza #" + (r.caseNo || r._id),
        `Hedef: <@${r.userId}>\nYetkili: <@${r.actorId}>\nTür: ${r.type}\nDurum: ${r.status}\nSebep: ${r.reason}\nBitiş: ${r.expiresAt ? `<t:${Math.floor(r.expiresAt / 1000)}:F>` : "Süresiz"}`,
      ),
    );
  });
  ctx.add(["cezapuan"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers);
    const uid = snowflake(a[0]),
      rows = await db
        .collection("cases")
        .find({
          guildId: m.guildId,
          userId: uid,
          status: { $in: ["active", "expired", "revoked"] },
        })
        .toArray();
    const points = rows.reduce(
      (sum, r) =>
        sum +
        ({
          ban: 50,
          forceban: 100,
          jail: 30,
          cmute: 10,
          vmute: 10,
          timeout: 10,
        }[r.type] || 0),
      0,
    );
    await m.reply(
      embed(
        "Ceza puanı",
        `<@${uid}> · **${points} puan**\nPuan bilgi amaçlıdır; otomatik ceza uygulanmaz.`,
      ),
    );
  });
  ctx.add(["soncezalar"], async (m) => {
    await authorize(ctx, m, P.ModerateMembers);
    const a = await db
      .collection("cases")
      .find({ guildId: m.guildId })
      .sort({ at: -1 })
      .limit(10)
      .toArray();
    await m.reply(
      embed(
        "Son cezalar",
        a
          .map(
            (x) =>
              `#${x.caseNo || x._id} · <@${x.userId}> · ${x.type} · ${x.status}`,
          )
          .join("\n") || "Kayıt yok.",
      ),
    );
  });
  ctx.onInteraction(async (i) => {
    const [, , token, action] = i.customId.split(":");
    const s = await readSession(ctx, i, token);
    if (action === "setup" && s.kind === "penaltySetup") {
      await authorize(ctx, i, null, true);
      await i.deferUpdate();
      await safeRole(i.guild, s.data.roleId);
      const channels = await i.guild.channels.fetch();
      for (const ch of channels.values()) {
        if (ch.isThread() || !ch.permissionOverwrites) continue;
        await ch.permissionOverwrites.edit(
          s.data.roleId,
          s.data.type === "jail"
            ? {
                ViewChannel: ch.id === c.jailChannelId,
                Connect: ch.id === c.jailChannelId,
              }
            : {
                SendMessages: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
              },
        );
      }
      await db.collection("sessions").deleteOne({ _id: token });
      return i.editReply({
        ...embed(
          "Ceza rolü kurulumu tamamlandı",
          "Ceza öncesinde etkili izinler yine kontrol edilir.",
        ),
        components: [],
      });
    }
    if (s.kind !== "jail" || action !== "jail" || !reasons[Number(i.values[0])])
      throw Error("Geçersiz seçim.");
    await i.deferUpdate();
    const [reason, days] = reasons[Number(i.values[0])],
      r = await punish(i, s.data.uid, "jail", days * 86400000, reason);
    await db.collection("sessions").deleteOne({ _id: token });
    await i.editReply({
      ...embed("Ceza uygulandı", `<@${r.userId}> · Jail · #${r.caseNo}`),
      components: [],
    });
  }, "m:pen:");
  ctx.event("guildMemberAdd", async (m) => {
    if (m.guild.id !== c.guildId) return;
    const f = await db
      .collection("forceRules")
      .findOne({ guildId: c.guildId, userId: m.id, releasing: { $ne: true } });
    if (f) {
      await m.ban({ reason: f.reason });
      return;
    }
    for (const r of await db
      .collection("cases")
      .find({
        guildId: c.guildId,
        userId: m.id,
        status: "active",
        type: { $in: ["jail", "cmute"] },
      })
      .toArray())
      if (r.expiresAt > Date.now()) await apply(m.guild, m, r);
  });
  ctx.event("guildBanRemove", async (ban) => {
    if (ban.guild.id !== c.guildId) return;
    const f = await db
      .collection("forceRules")
      .findOne({
        guildId: c.guildId,
        userId: ban.user.id,
        releasing: { $ne: true },
      });
    if (f) await ban.guild.members.ban(ban.user.id, { reason: f.reason });
  });
  ctx.event("voiceStateUpdate", async (_, s) => {
    if (s.guild.id !== c.guildId || !s.channelId) return;
    const r = await db
      .collection("cases")
      .findOne({
        guildId: c.guildId,
        userId: s.id,
        type: "vmute",
        status: "active",
        expiresAt: { $gt: new Date() },
      });
    if (r && !s.serverMute) {
      await s.setMute(true);
      await db
        .collection("cases")
        .updateOne({ _id: r._id }, { $set: { appliedMute: true } });
    } else if (!r) {
      const old = await db
        .collection("cases")
        .findOne({
          guildId: c.guildId,
          userId: s.id,
          type: "vmute",
          cleanupNeeded: true,
          status: { $in: ["expired", "revoked"] },
        });
      if (old) {
        if (s.serverMute) await s.setMute(false);
        await db
          .collection("cases")
          .updateOne({ _id: old._id }, { $set: { cleanupNeeded: false } });
      }
    }
  });
  ctx.every(30000, async () => {
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (!g) return;
    for (const r of await db
      .collection("cases")
      .find({
        guildId: c.guildId,
        status: "active",
        type: { $in: ["jail", "cmute", "vmute"] },
        expiresAt: { $lte: new Date() },
      })
      .limit(100)
      .toArray())
      await ctx.lock("pen:" + r.userId, () => release(g, r));
  });
  ctx.every(30000, async () => {
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (!g) return;
    for (const old of await db
      .collection("forceRules")
      .find({ guildId: c.guildId, releasing: true })
      .limit(50)
      .toArray())
      await ctx.lock("force:" + old.userId, async () => {
        const r = await db
          .collection("forceRules")
          .findOne({ _id: old._id, releasing: true });
        if (!r) return;
        await g.members.unban(r.userId).catch((e) => {
          if (e.code !== 10026) throw e;
        });
        await db
          .collection("cases")
          .updateOne(
            { _id: r.caseId },
            {
              $set: { status: "revoked", revokedBy: r.releasingBy || "system" },
            },
          );
        await db.collection("forceRules").deleteOne({ _id: r._id });
      });
  });
}
