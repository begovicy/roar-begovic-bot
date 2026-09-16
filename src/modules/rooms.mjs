import fs from "node:fs";
import { P } from "../core/auth.mjs";
import {
  embed,
  row,
  button,
  modal,
  EPH,
  session,
  readSession,
} from "../core/ui.mjs";
import { snowflake, clean } from "../core/util.mjs";
export function overwriteValue(o, bit) {
  const deny = o?.deny?.bitfield ?? o?.deny ?? 0n,
    allow = o?.allow?.bitfield ?? o?.allow ?? 0n;
  return (deny & bit) !== 0n ? false : (allow & bit) !== 0n ? true : null;
}
export const roomControls = [
  ["name", "Ad"],
  ["allow", "Ekle"],
  ["lock", "Kilit"],
  ["list", "Liste"],
  ["delete", "Sil"],
  ["hide", "Gizle"],
  ["block", "Engel"],
  ["transfer", "Devret"],
  ["limit", "Limit"],
];
export async function roomPanel(ctx) {
  const assets = await ctx.db
    .collection("uiAssets")
    .findOne({ _id: ctx.c.guildId });
  const fallbackEmoji = {
    name: "📝",
    allow: "✅",
    lock: "🔒",
    list: "📋",
    delete: "🗑️",
    hide: "🙈",
    block: "🚫",
    transfer: "🔄",
    limit: "🔢",
  };
  const controls = roomControls.map(([a]) => ({
    type: 2,
    custom_id: "m:room:" + a,
    style: 2,
    emoji: assets?.roomEmoji?.[a] || { name: fallbackEmoji[a] },
  }));
  return {
    files: [{ attachment: "assets/rooms.png", name: "rooms.png" }],
    components: [row(...controls.slice(0, 5)), row(...controls.slice(5))],
    allowedMentions: { parse: [] },
  };
}
export function checkTransfer(
  r,
  actor,
  target,
  voice,
  targetHasRoom,
  bot = false,
) {
  if (!r || r.ownerId !== actor) throw Error("Yalnız oda sahibi devredebilir.");
  if (r.transferPending) throw Error("Önceki devir tamamlanmayı bekliyor.");
  if (actor === target || bot)
    throw Error("Kendinize veya bota devredemezsiniz.");
  if (voice !== r._id) throw Error("Yeni sahip odada bulunmalı.");
  if (targetHasRoom) throw Error("Bu üyenin zaten bir odası var.");
}
async function mine(ctx, i, channelId) {
  const member = await i.guild.members.fetch(i.user.id);
  const cid = channelId || member.voice.channelId;
  const r = await ctx.db
    .collection("rooms")
    .findOne({ _id: cid, guildId: i.guildId });
  if (!r || ![r.ownerId, ...(r.moderators || [])].includes(i.user.id))
    throw Error(
      "Yalnız kendi odanızı veya moderatör olduğunuz odayı yönetebilirsiniz.",
    );
  if (r.transferPending) throw Error("Devir tamamlanmayı bekliyor.");
  const ch = await i.guild.channels.fetch(r._id);
  if (!ch) throw Error("Oda artık mevcut değil.");
  return { r, ch, member };
}
export async function roomInteraction(ctx, i) {
  const [, type, a, b] = i.customId.split(":");
  if (type === "roomtransfer") {
    const invited = await readSession(ctx, i, a);
    if (invited.kind !== "roomTransfer") throw Error("Geçersiz devir.");
    await i.deferUpdate();
    if (b === "no") {
      await ctx.db.collection("sessions").deleteOne({ _id: a });
      return i.editReply({
        content: "Oda devri reddedildi.",
        components: [],
        embeds: [],
      });
    }
    if (b !== "yes") throw Error("Geçersiz seçim.");
    return ctx.lock("room:" + invited.data.channelId, async () => {
      const target = await i.guild.members.fetch(i.user.id),
        ch = await i.guild.channels.fetch(invited.data.channelId);
      if (!ch) throw Error("Oda bulunamadı.");
      await ctx.tx(async (session) => {
        const opts = { session };
        const current = await ctx.db
            .collection("rooms")
            .findOne({ _id: ch.id, guildId: i.guildId }, opts),
          existing = await ctx.db
            .collection("rooms")
            .findOne({ guildId: i.guildId, ownerId: i.user.id }, opts);
        checkTransfer(
          current,
          invited.data.ownerId,
          i.user.id,
          target.voice.channelId,
          Boolean(existing),
          target.user.bot,
        );
        const active = await ctx.db
          .collection("sessions")
          .findOne({ _id: a, expiresAt: { $gt: new Date() } }, opts);
        if (!active) throw Error("Onay kullanılmış veya süresi dolmuş.");
        const changed = await ctx.db
          .collection("rooms")
          .updateOne(
            { _id: ch.id, ownerId: invited.data.ownerId },
            {
              $set: {
                ownerId: i.user.id,
                moderators: [],
                transferPending: {
                  token: a,
                  oldOwnerId: invited.data.ownerId,
                  newOwnerId: i.user.id,
                  at: new Date(),
                },
              },
            },
            opts,
          );
        if (!changed.matchedCount) throw Error("Sahiplik değişti.");
        await ctx.db.collection("sessions").deleteOne({ _id: a }, opts);
      });
      try {
        await ch.permissionOverwrites.edit(i.user.id, {
          ViewChannel: true,
          Connect: true,
        });
        await ctx.db
          .collection("rooms")
          .updateOne(
            { _id: ch.id, "transferPending.token": a },
            { $unset: { transferPending: "" } },
          );
      } catch (e) {
        ctx.report("Oda devir izni bekliyor", e);
        return i.editReply({
          content:
            "Sahiplik kaydedildi; Discord izin güncellemesi bekliyor. Otomatik tekrar denenecek.",
          components: [],
          embeds: [],
        });
      }
      return i.editReply({
        content: `Oda <@${i.user.id}> üyesine devredildi. Eski moderatör atamaları kaldırıldı.`,
        components: [],
        embeds: [],
        allowedMentions: { parse: [] },
      });
    });
  }
  if (type === "roommodal") {
    const { r, ch } = await mine(ctx, i, a);
    await i.deferReply({ flags: EPH });
    const value = i.fields.getTextInputValue("value").trim();
    await ctx.lock(`room:${ch.id}`, async () => {
      const r = await ctx.db
        .collection("rooms")
        .findOne({ _id: ch.id, guildId: i.guildId });
      if (
        !r ||
        r.transferPending ||
        ![r.ownerId, ...(r.moderators || [])].includes(i.user.id)
      )
        throw Error("Oda yönetim yetkiniz değişti.");
      if (b === "transfer") {
        const uid = snowflake(value),
          target = await i.guild.members.fetch(uid),
          existing = await ctx.db
            .collection("rooms")
            .findOne({ guildId: i.guildId, ownerId: uid });
        checkTransfer(
          r,
          i.user.id,
          uid,
          target.voice.channelId,
          Boolean(existing),
          target.user.bot,
        );
        const token = await session(
          ctx,
          "roomTransfer",
          uid,
          i.channelId,
          { channelId: ch.id, ownerId: r.ownerId },
          60,
        );
        await i.channel.send({
          ...embed(
            "Oda sahipliği devri",
            `<@${uid}>, <@${r.ownerId}> odasını sana devretmek istiyor. 60 saniye içinde onayla. Önceki moderatör atamaları kaldırılır.`,
          ),
          components: [
            row(
              button(`m:roomtransfer:${token}:yes`, "Kabul Et", 3),
              button(`m:roomtransfer:${token}:no`, "Reddet", 4),
            ),
          ],
          allowedMentions: { parse: [], users: [uid] },
        });
      } else if (b === "name") {
        if (value.length < 2 || value.length > 50)
          throw Error("İsim 2–50 karakter olmalı.");
        await ch.setName(clean(value));
      } else if (b === "limit") {
        if (!/^\d{1,2}$/.test(value))
          throw Error("Limit 0–99 olmalı; 0 sınırsızdır.");
        await ch.setUserLimit(Number(value));
      } else if (["allow", "block", "mod"].includes(b)) {
        const uid = snowflake(value);
        const target = await i.guild.members.fetch(uid);
        if (target.user.bot || uid === r.ownerId)
          throw Error("Oda sahibi veya bot üzerinde bu işlem yapılamaz.");
        if (b === "mod") {
          if (i.user.id !== r.ownerId)
            throw Error("Yalnız oda sahibi moderatör seçebilir.");
          const isMod = (r.moderators || []).includes(uid);
          if (!isMod && (r.moderators || []).length >= 5)
            throw Error("En fazla 5 moderatör.");
          await ctx.db
            .collection("rooms")
            .updateOne(
              { _id: r._id },
              isMod
                ? { $pull: { moderators: uid } }
                : { $addToSet: { moderators: uid } },
            );
        } else {
          if (b === "block" && (r.moderators || []).includes(uid))
            throw Error("Önce moderatörlüğünü kaldırın.");
          await ch.permissionOverwrites.edit(uid, {
            ViewChannel: b === "allow",
            Connect: b === "allow",
          });
          if (b === "block" && target.voice.channelId === ch.id)
            await target.voice.disconnect("ROAR oda sahibi engeli");
        }
      } else throw Error("Geçersiz oda işlemi.");
    });
    return i.editReply({
      content:
        b === "transfer"
          ? "Devir isteği gönderildi. Karşı tarafın onayı bekleniyor."
          : "Oda ayarı güncellendi.",
    });
  }
  if (type === "roomdelete") {
    const s = await readSession(ctx, i, a);
    if (s.kind !== "roomdelete") throw Error("Geçersiz onay.");
    const { r, ch } = await mine(ctx, i, s.data.channelId);
    if (r.ownerId !== i.user.id) throw Error("Yalnız oda sahibi silebilir.");
    await i.deferUpdate();
    if (b === "yes") {
      await ctx.lock("room:" + ch.id, async () => {
        const fresh = await ctx.db
          .collection("rooms")
          .findOne({ _id: ch.id, guildId: i.guildId });
        if (!fresh || fresh.ownerId !== i.user.id || fresh.transferPending)
          throw Error("Oda sahipliği değişti.");
        const claimed = await ctx.db
          .collection("sessions")
          .findOneAndDelete({ _id: a });
        if (!claimed) throw Error("Onay kullanılmış.");
        await ch.delete("ROAR oda sahibi onayladı");
        await ctx.db.collection("rooms").deleteOne({ _id: r._id });
        await i
          .editReply({ content: "Oda silindi.", components: [] })
          .catch(() => {});
      });
    } else await i.editReply({ content: "İptal edildi.", components: [] });
    return;
  }
  const { r, ch } = await mine(ctx, i);
  if (["name", "limit", "allow", "block", "mod", "transfer"].includes(a)) {
    if (["mod", "transfer"].includes(a) && i.user.id !== r.ownerId)
      throw Error("Yalnız oda sahibi moderatör seçebilir.");
    const labels = {
      transfer: "Yeni sahibin kullanıcı ID değeri",
      name: "Yeni oda adı",
      limit: "Kişi limiti (0–99)",
      allow: "İzin verilecek kullanıcı ID",
      block: "Engellenecek kullanıcı ID",
      mod: "Moderatör ekle/kaldır: kullanıcı ID",
    };
    return i.showModal(
      modal(`m:roommodal:${ch.id}:${a}`, "ROAR · Oda Ayarı", labels[a]),
    );
  }
  await i.deferReply({ flags: EPH });
  if (a === "delete") {
    if (r.ownerId !== i.user.id) throw Error("Yalnız oda sahibi silebilir.");
    const token = await session(
      ctx,
      "roomdelete",
      i.user.id,
      i.channelId,
      { channelId: ch.id },
      30,
    );
    return i.editReply({
      content: `${clean(ch.name)} odasını silmek istiyor musunuz? Oda sohbeti de kaybolur.`,
      components: [
        row(
          button(`m:roomdelete:${token}:yes`, "Evet, Sil", 4),
          button(`m:roomdelete:${token}:no`, "Vazgeç"),
        ),
      ],
    });
  }
  if (a === "list")
    return i.editReply({
      content: `Sahip: <@${r.ownerId}>\nOdadakiler: ${ch.members.map((m) => `<@${m.id}>`).join(", ") || "Yok"}\nModeratörler: ${(r.moderators || []).map((uid) => `<@${uid}>`).join(", ") || "Yok"}`,
    });
  await ctx.lock(`room:${ch.id}`, async () => {
    const latest = await ctx.db.collection("rooms").findOne({ _id: r._id });
    if (!latest) throw Error("Oda bulunamadı.");
    if (
      latest.transferPending ||
      ![latest.ownerId, ...(latest.moderators || [])].includes(i.user.id)
    )
      throw Error("Oda yönetim yetkiniz değişti.");
    if (a === "lock") {
      if (!latest.aclBaseline) {
        if (latest.locked || latest.hidden)
          throw Error(
            "Eski oda başlangıç izni bilinmiyor; kurucu izinleri incelemeli.",
          );
        latest.aclBaseline = {
          connect: overwriteValue(
            ch.permissionOverwrites.cache.get(i.guild.id),
            P.Connect,
          ),
          view: overwriteValue(
            ch.permissionOverwrites.cache.get(i.guild.id),
            P.ViewChannel,
          ),
        };
        await ctx.db
          .collection("rooms")
          .updateOne(
            { _id: r._id },
            { $set: { aclBaseline: latest.aclBaseline } },
          );
      }
      const locked = !latest.locked;
      await ch.permissionOverwrites.edit(i.guild.id, {
        Connect: locked ? false : latest.aclBaseline.connect,
      });
      await ctx.db
        .collection("rooms")
        .updateOne({ _id: r._id }, { $set: { locked } });
      await i.editReply({
        content: locked
          ? "Oda kilitlendi. Önceden izin verilen üyeler girebilir."
          : "Oda kilidi açıldı.",
      });
    } else if (a === "hide") {
      if (!latest.aclBaseline) {
        if (latest.locked || latest.hidden)
          throw Error(
            "Eski oda başlangıç izni bilinmiyor; kurucu izinleri incelemeli.",
          );
        latest.aclBaseline = {
          connect: overwriteValue(
            ch.permissionOverwrites.cache.get(i.guild.id),
            P.Connect,
          ),
          view: overwriteValue(
            ch.permissionOverwrites.cache.get(i.guild.id),
            P.ViewChannel,
          ),
        };
        await ctx.db
          .collection("rooms")
          .updateOne(
            { _id: r._id },
            { $set: { aclBaseline: latest.aclBaseline } },
          );
      }
      const hidden = !latest.hidden;
      await ch.permissionOverwrites.edit(i.guild.id, {
        ViewChannel: hidden ? false : latest.aclBaseline.view,
      });
      await ctx.db
        .collection("rooms")
        .updateOne({ _id: r._id }, { $set: { hidden } });
      await i.editReply({
        content: hidden
          ? "Oda gizlendi. Özel izinli üyeler ve yöneticiler görebilir."
          : "Oda görünür oldu.",
      });
    } else throw Error("Geçersiz işlem.");
  });
}
export function installRooms(ctx) {
  const { db, c } = ctx;
  ctx.every(30000, async () => {
    const pending = await db
      .collection("rooms")
      .find({ guildId: c.guildId, transferPending: { $exists: true } })
      .toArray();
    for (const r of pending) {
      try {
        await ctx.lock("room:" + r._id, async () => {
          const fresh = await db.collection("rooms").findOne({ _id: r._id });
          if (!fresh?.transferPending) return;
          const guild = await ctx.client.guilds.fetch(c.guildId);
          await guild.members.fetch(fresh.ownerId);
          const ch = await guild.channels.fetch(r._id);
          if (!ch) throw Error("Devir odası bulunamadı.");
          await ch.permissionOverwrites.edit(fresh.ownerId, {
            ViewChannel: true,
            Connect: true,
          });
          await db
            .collection("rooms")
            .updateOne(
              {
                _id: r._id,
                "transferPending.token": fresh.transferPending.token,
              },
              { $unset: { transferPending: "" } },
            );
        });
      } catch (e) {
        ctx.report("Oda devir kurtarma", e);
      }
    }
  });
  const cooldown = new Map();
  ctx.event("voiceStateUpdate", async (old, now) => {
    if (
      now.guild.id !== c.guildId ||
      now.member?.user.bot ||
      now.channelId !== c.privateRoomLobbyId ||
      old.channelId === now.channelId
    )
      return;
    // Serialize the whole guild: two simultaneous creators must not race positions.
    await ctx.lock(`createRoom:${now.guild.id}`, async () => {
      const member = await now.guild.members.fetch(now.id);
      if (member.voice.channelId !== c.privateRoomLobbyId) return;
      const lobby = await now.guild.channels.fetch(c.privateRoomLobbyId);
      if (lobby?.type !== 2)
        throw Error("Oda oluşturma kanalı standart ses kanalı olmalı.");
      const existing = await db
        .collection("rooms")
        .findOne({ guildId: c.guildId, ownerId: now.id });
      if (existing) {
        const ch = await now.guild.channels.fetch(existing._id).catch((e) => {
          if (e.code === 10003) return null;
          throw e;
        });
        if (ch) {
          if (ch.type !== 2)
            throw Error(
              "Kayıtlı özel oda ses kanalı değil; kurucu incelemeli.",
            );
          if (member.voice.channelId !== lobby.id) return;
          await member.voice.setChannel(ch);
          return;
        }
        await db.collection("rooms").deleteOne({ _id: existing._id });
      }
      if (Date.now() - (cooldown.get(now.id) || 0) < 30000) return;
      cooldown.set(now.id, Date.now());
      // The lobby's actual parent is authoritative, not an unrelated config category.
      const parentId = lobby.parentId ?? null;
      if (parentId) {
        const category = await now.guild.channels.fetch(parentId);
        if (category?.type !== 4)
          throw Error("Giriş kanalının kategorisi bulunamadı.");
      }
      const me = await now.guild.members.fetchMe();
      if (!me.permissions.has([P.ManageChannels, P.MoveMembers]))
        throw Error("Oda oluşturma izinleri eksik.");
      // Preserve the lobby audience; never make a restricted category public.
      const overwrites = new Map(
        [...lobby.permissionOverwrites.cache.values()].map((o) => [
          o.id,
          {
            id: o.id,
            type: o.type,
            allow: o.allow.bitfield,
            deny: o.deny.bitfield,
          },
        ]),
      );
      const grant = (uid, permissions) => {
        const prev = overwrites.get(uid) || {
          id: uid,
          type: 1,
          allow: 0n,
          deny: 0n,
        };
        const bits = permissions.reduce((a, b) => a | b, 0n);
        overwrites.set(uid, {
          ...prev,
          allow: prev.allow | bits,
          deny: prev.deny & ~bits,
        });
      };
      grant(now.id, [P.ViewChannel, P.Connect]);
      grant(me.id, [
        P.ViewChannel,
        P.Connect,
        P.ManageChannels,
        P.MoveMembers,
        P.SendMessages,
        P.EmbedLinks,
        P.AttachFiles,
      ]);
      let ch;
      try {
        ch = await now.guild.channels.create({
          name: clean(now.member.displayName),
          type: 2,
          parent: parentId,
          position: lobby.rawPosition + 1,
          permissionOverwrites: [...overwrites.values()],
          reason: `ROAR oda sahibi: ${now.id}`,
        });
        // Explicitly order after creation too: creation's suggested position alone
        // is not treated as a guarantee of Discord's final channel order.
        await ch.setPosition(lobby.rawPosition + 1);
        await db.collection("rooms").insertOne({
          _id: ch.id,
          guildId: c.guildId,
          ownerId: now.id,
          moderators: [],
          aclBaseline: {
            connect: overwriteValue(overwrites.get(c.guildId), P.Connect),
            view: overwriteValue(overwrites.get(c.guildId), P.ViewChannel),
          },
          locked: false,
          hidden: false,
          createdAt: new Date(),
          emptySince: null,
        });
        if (member.voice.channelId !== lobby.id)
          throw Error("Üye oda oluşmadan giriş kanalından ayrıldı.");
        await member.voice.setChannel(ch);
        // A panel delivery failure must not delete an otherwise working room.
        try {
          await ch.send(await roomPanel(ctx));
        } catch (e) {
          ctx.report("Özel oda paneli gönderilemedi", e);
        }
      } catch (e) {
        if (ch) {
          try {
            await ch.delete("ROAR başarısız oda oluşturma temizliği");
            await db.collection("rooms").deleteOne({ _id: ch.id });
          } catch (cleanupError) {
            await db.collection("rooms").updateOne(
              { _id: ch.id },
              {
                $set: {
                  guildId: c.guildId,
                  ownerId: now.id,
                  cleanupNeeded: true,
                  createdAt: new Date(),
                },
              },
              { upsert: true },
            );
            ctx.report("Özel oda temizliği inceleme bekliyor", cleanupError);
          }
        }
        throw e;
      }
    });
  });
  ctx.every(1000, async () => {
    const guild = ctx.client.guilds.cache.get(c.guildId);
    if (!guild) return;
    const rooms = await db
      .collection("rooms")
      .find({ guildId: c.guildId })
      .toArray();
    for (const r of rooms)
      await ctx.lock(`room:${r._id}`, async () => {
        const ch = await guild.channels.fetch(r._id).catch((e) => {
          if (e.code === 10003) return null;
          throw e;
        });
        if (!ch) {
          await db.collection("rooms").deleteOne({ _id: r._id });
          return;
        }
        if (ch.members.size) {
          if (r.emptySince)
            await db
              .collection("rooms")
              .updateOne({ _id: r._id }, { $set: { emptySince: null } });
        } else if (!r.emptySince)
          await db
            .collection("rooms")
            .updateOne({ _id: r._id }, { $set: { emptySince: new Date() } });
        else if (Date.now() - r.emptySince >= 10000) {
          await ch.delete("ROAR boş oda temizliği");
          await db.collection("rooms").deleteOne({ _id: r._id });
        }
      });
    for (const [k, t] of cooldown)
      if (Date.now() - t > 60000) cooldown.delete(k);
  });
}
