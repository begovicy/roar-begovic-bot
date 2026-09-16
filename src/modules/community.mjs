import {
  embed,
  panel,
  row,
  button,
  modal,
  link,
  session,
  readSession,
  EPH,
} from "../core/ui.mjs";
import { P, authorize, target } from "../core/auth.mjs";
import {
  id,
  snowflake,
  clean,
  duration,
  amount,
  day,
  shuffled,
} from "../core/util.mjs";
import { createHash, randomInt } from "node:crypto";
export async function install(ctx) {
  const { db, c } = ctx;
  ctx.add(["key", "kayıt", "kayit", "referans", "k"], async (m, a) => {
    const actor = await authorize(ctx, m, P.ManageRoles);
    const member = await target(ctx, m, snowflake(a[0]), P.ManageRoles);
    if (member.user.bot) throw Error("Botlar kayıt edilmez.");
    if (!c.registeredRoleId) throw Error("Kayıt rolü ayarlanmamış.");
    const role = await m.guild.roles.fetch(c.registeredRoleId);
    const checkRole = (r) => {
      if (!r?.editable || r.managed || r.permissions.bitfield !== 0n)
        throw Error("Kayıt rolleri sıfır yetkili ve yönetilebilir olmalı.");
      if (
        actor.id !== m.guild.ownerId &&
        actor.roles.highest.comparePositionTo(r) <= 0
      )
        throw Error("Kayıt rolü yetkilinin altında olmalı.");
    };
    checkRole(role);
    if (c.unregisteredRoleId === role.id)
      throw Error("Kayıt ve kayıtsız rolü farklı olmalı.");
    if (c.unregisteredRoleId)
      checkRole(await m.guild.roles.fetch(c.unregisteredRoleId));
    if (a[1] && !member.manageable)
      throw Error("Üyenin takma adı yönetilemiyor.");
    await db
      .collection("registrations")
      .insertOne({
        _id: m.id,
        guildId: m.guildId,
        userId: member.id,
        actorId: m.author.id,
        at: new Date(),
        status: "pending",
      });
    try {
      await member.roles.add(role.id);
      if (c.unregisteredRoleId) await member.roles.remove(c.unregisteredRoleId);
      if (a[1])
        await member.setNickname(clean(a.slice(1).join(" ")).slice(0, 32));
      await db
        .collection("registrations")
        .updateOne({ _id: m.id }, { $set: { status: "completed" } });
    } catch (e) {
      await db
        .collection("registrations")
        .updateOne({ _id: m.id }, { $set: { status: "review_required" } });
      throw e;
    }
    await m.reply(
      embed("Kayıt tamamlandı", `<@${member.id}> · Yetkili: <@${m.author.id}>`),
    );
  });
  ctx.add(["ysay", "yetkilisay"], async (m) => {
    await authorize(ctx, m, P.ManageRoles);
    await m.guild.members.fetch();
    const all = m.guild.members.cache.filter((x) =>
      c.staffRoleIds.some((r) => x.roles.cache.has(r)),
    );
    await m.reply(
      embed(
        "Yetkili sayımı",
        `Toplam: ${all.size}\nSeste: ${all.filter((x) => x.voice.channelId).size}\n\nSeste olmayanlar:\n${
          all
            .filter((x) => !x.voice.channelId)
            .first(40)
            .map((x) => `<@${x.id}>`)
            .join(", ") || "Yok"
        }`,
      ),
    );
  });
  ctx.add(["tagsay"], async (m) => {
    await authorize(ctx, m, P.ManageRoles);
    if (!c.tagRoleId) throw Error("Tag rolü ayarlanmamış.");
    await m.guild.members.fetch();
    const role = await m.guild.roles.fetch(c.tagRoleId);
    await m.reply(
      embed(
        "Tag sayımı",
        `Toplam: ${role?.members.size || 0}\n${
          role?.members
            .first(40)
            .map((x) => `<@${x.id}>`)
            .join(", ") || "Üye yok"
        }`,
      ),
    );
  });
  ctx.add(["ses", "nerede"], async (m, a) => {
    const member = await m.guild.members.fetch(
        a[0] ? snowflake(a[0]) : m.author.id,
      ),
      ch = member.voice.channel;
    if (!ch) throw Error("Kullanıcı seste değil.");
    if (!ch.permissionsFor(m.member)?.has(P.ViewChannel))
      throw Error("Bu ses kanalını görme izniniz yok.");
    await m.reply(
      embed(
        "Ses bilgisi",
        `<@${member.id}> · <#${ch.id}>\nMikrofon: ${member.voice.selfMute ? "Kapalı" : "Açık"}\nKulaklık: ${member.voice.selfDeaf ? "Kapalı" : "Açık"}\nYayın: ${member.voice.streaming ? "Açık" : "Kapalı"} · Kamera: ${member.voice.selfVideo ? "Açık" : "Kapalı"}`,
      ),
    );
  });
  ctx.add(["ship"], async (m, a) => {
    const uid = snowflake(a[0]);
    await m.guild.members.fetch(uid);
    if (uid === m.author.id) throw Error("Başka bir üye seçin.");
    const n =
      createHash("sha256")
        .update([...[uid, m.author.id].sort(), day(Date.now())].join(":"))
        .digest()
        .readUInt32BE(0) % 101;
    await m.reply(
      embed(
        "ROAR Ship",
        `<@${m.author.id}> x <@${uid}>\n**%${n}**\nYalnız eğlencelik, günlük rastgele sonuç; gerçek bir ilişki ölçümü değildir.`,
      ),
    );
  });
  ctx.add(["spotify", "spo"], async (m, a) => {
    if (!c.presences)
      throw Error("Presence intenti ve ENABLE_PRESENCES gerekli.");
    const member = await m.guild.members.fetch(
        a[0] ? snowflake(a[0]) : m.author.id,
      ),
      act = member.presence?.activities.find(
        (x) => x.name === "Spotify" && x.type === 2,
      );
    if (!act) throw Error("Görünür Spotify etkinliği bulunamadı.");
    const p = embed(
      "Spotify",
      `**${clean(act.details)}**\n${clean(act.state)}\n${act.timestamps?.start ? `Başlama: <t:${Math.floor(act.timestamps.start / 1000)}:R>` : ""}`,
    );
    const art = act.assets?.largeImageURL();
    if (art) p.embeds[0].thumbnail = { url: art };
    if (act.syncId)
      p.components = [
        row(link("Dinle", "https:" + "//open.spotify.com/track/" + act.syncId)),
      ];
    await m.reply(p);
  });
  ctx.add(["emoji"], async (m, a) => {
    await authorize(ctx, m, P.ManageGuildExpressions);
    const e = /^<(a?):([\w]+):(\d{17,20})>$/.exec(a[0] || "");
    if (!e) throw Error("Eklenecek özel emojiyi yazın.");
    const made = await m.guild.emojis.create({
      attachment:
        "https:" +
        "//cdn.discordapp.com/emojis/" +
        e[3] +
        (e[1] ? ".gif" : ".png"),
      name: e[2],
    });
    await m.reply(embed("Emoji eklendi", made.toString()));
  });
  ctx.add(["yaz", "write"], async (m, a) => {
    await authorize(ctx, m, null, true);
    if (!a.length) throw Error("Mesaj yazın.");
    await m.channel.send({
      content: a.join(" ").slice(0, 1900),
      allowedMentions: { parse: [] },
    });
  });
  ctx.add(["command"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const uid = snowflake(a[0]);
    if (uid === m.guild.ownerId || c.owners.includes(uid))
      throw Error("Kurucu engellenemez.");
    await db
      .collection("commandBans")
      .updateOne(
        { guildId: m.guildId, userId: uid },
        { $set: { actorId: m.author.id, at: new Date() } },
        { upsert: true },
      );
    await m.reply(embed("Komut erişimi kapandı", `<@${uid}>`));
  });
  ctx.add(["uncommand"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const uid = snowflake(a[0]);
    await db
      .collection("commandBans")
      .deleteOne({ guildId: m.guildId, userId: uid });
    await m.reply(embed("Komut erişimi açıldı", `<@${uid}>`));
  });
  ctx.add(["özelkomut", "ozelkomut"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const [action, name, rid] = a;
    if (action === "liste") {
      const r = await db
        .collection("customCommands")
        .find({ guildId: m.guildId })
        .limit(50)
        .toArray();
      return m.reply(
        embed(
          "Özel komutlar",
          r.map((x) => `.${x.name} → <@&${x.roleId}>`).join("\n") || "Yok",
        ),
      );
    }
    if (!/^[a-z0-9_-]{2,25}$/.test(name || ""))
      throw Error("Ad: 2–25 küçük harf/rakam/_/-.");
    if (ctx.hasCommand(name)) throw Error("Yerleşik komutla çakışıyor.");
    if (action === "sil") {
      await db
        .collection("customCommands")
        .deleteOne({ _id: m.guildId + ":" + name });
      return m.reply(embed("Özel komut silindi", name));
    }
    if (action !== "ekle")
      throw Error(".özelkomut ekle ad rolID / sil ad / liste");
    const role = await m.guild.roles.fetch(snowflake(rid));
    if (
      !role?.editable ||
      role.managed ||
      role.permissions.bitfield !== 0n ||
      !c.allowedRoleIds.includes(role.id)
    )
      throw Error("Rol izin listesinde ve sıfır yetkili olmalı.");
    await db
      .collection("customCommands")
      .updateOne(
        { _id: m.guildId + ":" + name },
        { $set: { guildId: m.guildId, name, roleId: role.id } },
        { upsert: true },
      );
    await m.reply(embed("Özel komut kaydedildi", `.${name} @üye`));
  });
  ctx.customCommand = async (m, a) => {
    const name = m.content
        .slice(c.prefix.length)
        .trim()
        .split(/\s+/)[0]
        .toLowerCase(),
      custom = await db
        .collection("customCommands")
        .findOne({ _id: m.guildId + ":" + name });
    if (!custom) return;
    await authorize(ctx, m, P.ManageRoles);
    const role = await m.guild.roles.fetch(custom.roleId);
    if (
      !role?.editable ||
      role.permissions.bitfield !== 0n ||
      !c.allowedRoleIds.includes(role.id)
    )
      throw Error("Rol artık izinli değil.");
    const actor = await m.guild.members.fetch(m.author.id);
    if (
      actor.id !== m.guild.ownerId &&
      actor.roles.highest.comparePositionTo(role) <= 0
    )
      throw Error("Rol hiyerarşisi uygun değil.");
    const target = await m.guild.members.fetch(snowflake(a[0]));
    await target.roles.add(role.id);
    await m.reply(embed("Rol verildi", `<@${target.id}> → <@&${role.id}>`));
  };
  ctx.add(["itirafpanel"], async (m) => {
    await authorize(ctx, m, null, true);
    if (!c.confessionReviewChannelId || !c.confessionPublishChannelId)
      throw Error("İnceleme ve yayın kanalı ayarlanmamış.");
    await m.channel.send(
      panel(
        "ROAR · İtiraf",
        `Gönderin önce yetkililerin incelemesine gider. **İnceleyen yetkililer kimliğini görebilir.** Onaylanan gönderi yayın kanalında isimsiz paylaşılır.`,
        [row(button("m:community:confess", "Gönderi Yaz", 1))],
      ),
    );
  });
  ctx.add(["memberpanel", "userpanel"], async (m) => {
    await authorize(ctx, m, null, true);
    await m.channel.send(
      panel(
        "ROAR · Üye Paneli",
        "Kişisel bilgilerin ve ceza durumun yalnız sana gösterilir.",
        [
          row(
            button("m:community:memberInfo", "Bilgilerim"),
            button("m:community:myCases", "Ceza Durumum"),
          ),
        ],
      ),
    );
  });
  ctx.add(["başvuru", "basvuru"], async (m) => {
    if (!c.applicationLogChannelId) throw Error("Başvuru kanalı ayarlanmamış.");
    await m.reply({
      ...embed(
        "Yetkili başvurusu",
        "Başvurun ve kullanıcı kimliğin yetkililere iletilir.",
      ),
      components: [row(button("m:community:apply", "Başvuru Formu", 1))],
    });
  });
  ctx.onInteraction(async (i) => {
    const [, , action, token] = i.customId.split(":");
    if (action === "confess" || action === "apply") {
      const form = modal(
        `m:community:${action}Submit`,
        "ROAR · " + (action === "apply" ? "Başvuru" : "Gönderi"),
        "Metniniz (yetkililere iletilir)",
      );
      form.components[0].components[0].style = 2;
      form.components[0].components[0].max_length = 1000;
      return i.showModal(form);
    }
    if (action === "confessSubmit" || action === "applySubmit") {
      await i.deferReply({ flags: EPH });
      const collection =
          action === "confessSubmit" ? "confessions" : "applications",
        ch = await i.guild.channels.fetch(
          action === "confessSubmit"
            ? c.confessionReviewChannelId
            : c.applicationLogChannelId,
        ),
        text = i.fields.getTextInputValue("value"),
        rec = {
          _id: id(),
          guildId: i.guildId,
          userId: i.user.id,
          text,
          status: "pending",
          at: new Date(),
        };
      await db.collection(collection).insertOne(rec);
      const p = embed(
        action === "confessSubmit" ? "İtiraf incelemesi" : "Yetkili başvurusu",
        `Gönderen: <@${i.user.id}>\n\n${text}`,
      );
      if (action === "confessSubmit")
        p.components = [
          row(
            button("m:community:approve:" + rec._id, "Yayınla", 3),
            button("m:community:reject:" + rec._id, "Reddet", 4),
          ),
        ];
      await ch.send(p);
      return i.editReply({ content: "Gönderiniz yetkililere iletildi." });
    }
    if (action === "approve" || action === "reject") {
      await authorize(ctx, i, P.ModerateMembers);
      await i.deferUpdate();
      await ctx.lock("confession:" + token, async () => {
        const rec = await db
          .collection("confessions")
          .findOne({ _id: token, guildId: i.guildId, status: "pending" });
        if (!rec) throw Error("Bu gönderi daha önce işlendi.");
        if (action === "reject") {
          await db
            .collection("confessions")
            .updateOne(
              { _id: token },
              { $set: { status: "rejected", reviewer: i.user.id } },
            );
        } else {
          await db
            .collection("confessions")
            .updateOne(
              { _id: token },
              { $set: { status: "publishing", reviewer: i.user.id } },
            );
          const ch = await i.guild.channels.fetch(c.confessionPublishChannelId);
          try {
            const msg = await ch.send(embed("ROAR · İtiraf", rec.text));
            await db
              .collection("confessions")
              .updateOne(
                { _id: token },
                { $set: { status: "published", messageId: msg.id } },
              );
          } catch (e) {
            await db
              .collection("confessions")
              .updateOne(
                { _id: token },
                { $set: { status: "review_required" } },
              );
            throw e;
          }
        }
        await i.editReply({
          ...embed(
            "Gönderi işlendi",
            action === "approve" ? "Yayınlandı." : "Reddedildi.",
          ),
          components: [],
        });
      });
      return;
    }
    await i.deferReply({ flags: EPH });
    if (action === "memberInfo") {
      const m = await i.guild.members.fetch(i.user.id);
      return i.editReply(
        embed(
          "Üye bilgilerim",
          `<@${m.id}>\nKatılma: <t:${Math.floor(m.joinedTimestamp / 1000)}:F>\nRol sayısı: ${m.roles.cache.size - 1}`,
        ),
      );
    }
    if (action === "myCases") {
      const r = await db
        .collection("cases")
        .find({ guildId: i.guildId, userId: i.user.id })
        .sort({ at: -1 })
        .limit(10)
        .toArray();
      return i.editReply(
        embed(
          "Ceza durumum",
          r.map((x) => `${x.type} · ${x.status} · ${x.reason}`).join("\n") ||
            "Ceza yok.",
        ),
      );
    }
    throw Error("Geçersiz panel.");
  }, "m:community:");
}
