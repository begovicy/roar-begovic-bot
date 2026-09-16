import {
  panel,
  embed,
  row,
  button,
  modal,
  session,
  readSession,
  EPH,
} from "../core/ui.mjs";
import { authorize } from "../core/auth.mjs";
import { snowflake, clean } from "../core/util.mjs";
import { parseColors } from "../core/policy.mjs";
export async function install(ctx) {
  const { db, c } = ctx;
  await db
    .collection("boostRoles")
    .createIndex({ guildId: 1, ownerId: 1 }, { unique: true });
  const controls = () =>
    row(
      button("m:boost:create", "Oluştur", 3),
      button("m:boost:rename", "Düzenle"),
      button("m:boost:color", "Renk", 1),
      button("m:boost:share", "Paylaşım"),
      button("m:boost:delete", "Sil", 4),
    );
  ctx.add(["boosterpanel", "booster-panel"], async (m) => {
    await authorize(ctx, m, null, true);
    await m.channel.send(
      panel(
        "Booster Özel Rol Sistemi",
        `Aktif boost sahiplerine **kendine ait bir rol**.\n\n• Oluştur — kişi başına bir rol\n• Düzenle — rol adını değiştir\n• Renk — HEX / gradyan / holografik (sunucu desteğine bağlı)\n• Paylaşım — en fazla **${c.boosterShareLimit} arkadaş**\n• Sil — onayla ve kaldır\n\nBoost biterse rol askıya alınır; **3 gün** içinde yeniden boost ile geri gelir.`,
        [controls()],
      ),
    );
  });
  async function own(i) {
    const member = await i.guild.members.fetch(i.user.id);
    if (!member.premiumSinceTimestamp)
      throw Error("Aktif sunucu boostunuz bulunmalı.");
    const record = await db
      .collection("boostRoles")
      .findOne({ guildId: i.guildId, ownerId: i.user.id });
    return { member, record };
  }
  async function roleOf(i, record) {
    if (!record?.roleId) throw Error("Önce rol oluşturun.");
    const role = await i.guild.roles.fetch(record.roleId);
    if (
      !role ||
      !role.editable ||
      role.managed ||
      role.permissions.bitfield !== 0n
    )
      throw Error(
        "Rol kayıp, yönetilemiyor veya izinleri değiştirilmiş. Kurucu incelemeli.",
      );
    return role;
  }
  ctx.onInteraction(async (i) => {
    const [, , action, sub] = i.customId.split(":");
    if (action === "confirmDelete") {
      const s = await readSession(ctx, i, sub);
      if (s.kind !== "boostDelete") throw Error("Geçersiz onay.");
      await i.deferUpdate();
      await ctx.lock("boost:" + i.user.id, async () => {
        const rec = await db
          .collection("boostRoles")
          .findOne({ guildId: i.guildId, ownerId: i.user.id });
        if (!rec || rec.roleId !== s.data.roleId) throw Error("Rol değişti.");
        const role = await roleOf(i, rec);
        await role.delete("ROAR sahibi onayladı");
        await db.collection("boostRoles").deleteOne({ _id: rec._id });
        await db.collection("sessions").deleteOne({ _id: sub });
      });
      return i.editReply({ content: "Özel rol silindi.", components: [] });
    }
    if (action !== "modal") {
      const { record } = await own(i);
      if (action === "delete") {
        const role = await roleOf(i, record),
          token = await session(
            ctx,
            "boostDelete",
            i.user.id,
            i.channelId,
            { roleId: role.id },
            30,
          );
        return i.reply({
          content: "Özel rolün herkesin üzerinden kaldırılıp silinsin mi?",
          components: [
            row(button("m:boost:confirmDelete:" + token, "Evet, Sil", 4)),
          ],
          flags: EPH,
        });
      }
      const labels = {
        create: "Rol adı (2–50 karakter)",
        rename: "Yeni rol adı",
        color: "HEX renk(ler) veya holografik",
        share: "Ekle/kaldır: arkadaş kullanıcı ID",
      };
      if (!labels[action]) throw Error("Geçersiz işlem.");
      if (action === "create" && record)
        throw Error("Zaten bir özel rolünüz var.");
      if (action !== "create") await roleOf(i, record);
      return i.showModal(
        modal("m:boost:modal:" + action, "ROAR · Booster Rolü", labels[action]),
      );
    }
    await i.deferReply({ flags: EPH });
    await ctx.lock("boost:" + i.user.id, async () => {
      const { member, record } = await own(i),
        value = i.fields.getTextInputValue("value").trim();
      if (sub === "create") {
        if (record) throw Error("Zaten rolünüz var.");
        if (value.length < 2 || value.length > 50)
          throw Error("İsim 2–50 karakter olmalı.");
        const rec = {
          guildId: i.guildId,
          ownerId: i.user.id,
          roleId: null,
          shared: [],
          createdAt: new Date(),
          state: "creating",
        };
        await db.collection("boostRoles").insertOne(rec);
        let role;
        try {
          role = await i.guild.roles.create({
            name: clean(value),
            permissions: [],
            colors: { primaryColor: 0x8b79dd },
            mentionable: false,
            hoist: false,
            reason: "ROAR booster özel rolü",
          });
          await db
            .collection("boostRoles")
            .updateOne({ _id: rec._id }, { $set: { roleId: role.id } });
          await member.roles.add(role.id);
          await db
            .collection("boostRoles")
            .updateOne(
              { _id: rec._id },
              { $set: { roleId: role.id, state: "active" } },
            );
        } catch (e) {
          if (role)
            await role.delete("ROAR başarısız oluşturma").catch(() => {});
          await db.collection("boostRoles").deleteOne({ _id: rec._id });
          throw e;
        }
      } else {
        const role = await roleOf(i, record);
        if (sub === "rename") {
          if (value.length < 2 || value.length > 50)
            throw Error("İsim 2–50 karakter olmalı.");
          await role.setName(clean(value));
        } else if (sub === "color") await role.setColors(parseColors(value));
        else if (sub === "share") {
          const uid = snowflake(value);
          if (uid === i.user.id)
            throw Error("Kendinizi paylaşım listesine ekleyemezsiniz.");
          const target = await i.guild.members.fetch(uid);
          if (target.user.bot) throw Error("Bot hesaplarıyla paylaşılmaz.");
          const has = (record.shared || []).includes(uid);
          if (!has && record.shared.length >= c.boosterShareLimit)
            throw Error("Paylaşım limiti doldu.");
          if (has) {
            await db
              .collection("boostRoles")
              .updateOne({ _id: record._id }, { $pull: { shared: uid } });
            await target.roles.remove(role.id);
          } else {
            await db
              .collection("boostRoles")
              .updateOne({ _id: record._id }, { $addToSet: { shared: uid } });
            await target.roles.add(role.id);
          }
        } else throw Error("Geçersiz işlem.");
      }
      await i.editReply({ content: "Booster rolü güncellendi." });
    });
  }, "m:boost:");
  async function reconcile(g, rec) {
    await ctx.lock("boost:" + rec.ownerId, async () => {
      rec = await db.collection("boostRoles").findOne({ _id: rec._id });
      if (!rec) return;
      if (!rec.roleId) {
        if (Date.now() - rec.createdAt > 300000)
          await db.collection("boostRoles").deleteOne({ _id: rec._id });
        return;
      }
      const role = await g.roles.fetch(rec.roleId);
      if (!role) {
        await db.collection("boostRoles").deleteOne({ _id: rec._id });
        return;
      }
      if (!role.editable || role.permissions.bitfield !== 0n)
        throw Error(
          "Booster rolünün izinleri değişmiş; otomatik işlem durduruldu.",
        );
      const owner = await g.members.fetch(rec.ownerId).catch((e) => {
          if (e.code === 10007) return null;
          throw e;
        }),
        boost = !!owner?.premiumSinceTimestamp,
        users = [rec.ownerId, ...rec.shared];
      if (!boost) {
        const suspendedAt = rec.suspendedAt || new Date();
        await db
          .collection("boostRoles")
          .updateOne(
            { _id: rec._id },
            { $set: { state: "suspended", suspendedAt } },
          );
        for (const uid of users) {
          const m = await g.members.fetch(uid).catch((e) => {
            if (e.code === 10007) return null;
            throw e;
          });
          if (m?.roles.cache.has(role.id)) await m.roles.remove(role.id);
        }
        if (Date.now() - suspendedAt >= 3 * 86400000) {
          await role.delete("ROAR boost askı süresi doldu");
          await db.collection("boostRoles").deleteOne({ _id: rec._id });
        }
      } else if (boost) {
        for (const member of role.members.values())
          if (!users.includes(member.id)) await member.roles.remove(role.id);
        for (const uid of users) {
          const m = await g.members.fetch(uid).catch((e) => {
            if (e.code === 10007) return null;
            throw e;
          });
          if (m) await m.roles.add(role.id);
        }
        await db
          .collection("boostRoles")
          .updateOne(
            { _id: rec._id },
            { $set: { state: "active" }, $unset: { suspendedAt: "" } },
          );
      }
    });
  }
  ctx.event("guildMemberUpdate", async (old, m) => {
    if (
      m.guild.id !== c.guildId ||
      old.premiumSinceTimestamp === m.premiumSinceTimestamp
    )
      return;
    const rec = await db
      .collection("boostRoles")
      .findOne({ guildId: c.guildId, ownerId: m.id });
    if (rec) await reconcile(m.guild, rec);
  });
  ctx.every(120000, async () => {
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (!g) return;
    for (const r of await db
      .collection("boostRoles")
      .find({ guildId: c.guildId })
      .toArray())
      await reconcile(g, r);
  });
}
