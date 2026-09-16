import {
  embed,
  panel,
  row,
  button,
  link,
  select,
  modal,
  session,
  readSession,
  EPH,
} from "../core/ui.mjs";
import { P, authorize, target } from "../core/auth.mjs";
import {
  snowflake,
  amount,
  duration,
  money,
  clean,
  id,
} from "../core/util.mjs";
import { roomPanel, roomInteraction, installRooms } from "./rooms.mjs";
import { catalog } from "../core/catalog.mjs";

async function log(ctx, guild, title, text) {
  const ch = await guild.channels.fetch(ctx.c.logChannelId).catch(() => null);
  if (ch?.isTextBased())
    await ch
      .send(embed(title, text))
      .catch(() => ctx.report("Log mesajı gönderilemedi"));
}
async function user(m, arg) {
  return arg ? m.client.users.fetch(snowflake(arg)) : m.author;
}
function helpView(token, category, pageIndex = 0) {
  const categories = [...new Set(catalog.map((x) => x[0]))];
  const list = catalog.filter((x) => x[0] === category);
  const pages = Math.max(1, Math.ceil(list.length / 6));
  const p = Math.min(Math.max(0, pageIndex), pages - 1);
  return panel(
    "Bot Yardım Menüsü",
    `Merhaba! **ROAR** komutları aşağıda.\nÖnek: \`.\` · Bu sürüm: **${catalog.length} ana komut**\n\n### ${category}\n${list
      .slice(p * 6, p * 6 + 6)
      .map((x) => `**.${x[1]}**\n${x[2]}\nKullanım: \`.${x[3]}\``)
      .join("\n\n")}`,
    [
      select(
        `m:${token}:helpCategory`,
        "Kategori seçin",
        categories.map((x) => ({ label: x, value: x })),
      ),
      row(
        button(`m:${token}:helpPage:0`, "İlk"),
        { ...button("noop", `${p + 1}/${pages}`), disabled: true },
        button(`m:${token}:helpPage:${Math.min(p + 1, pages - 1)}`, "Sonraki"),
        button(`m:${token}:helpPage:${pages - 1}`, "Son"),
      ),
    ],
  );
}
export async function install(ctx) {
  const { client, db, c } = ctx;
  ctx.add(["yardım", "yardim", "help", "y"], async (m) => {
    const token = await session(
      ctx,
      "help",
      m.author.id,
      m.channelId,
      { category: "Kullanıcı" },
      600,
    );
    await m.reply(helpView(token, "Kullanıcı"));
  });
  ctx.add(["ping"], async (m) =>
    {
      const startedAt = Date.now();
      const stats = client.pingStats?.(m) || {
        local: 0,
        api: Math.round(client.ws?.ping ?? -1),
        lag: 0,
      };
      const response = await m.reply(
        embed(
          "ROAR bağlantı durumu",
            "Bot/cache: **0 ms**\n" +
            `Discord WebSocket: **${stats.api < 0 ? "ölçülüyor" : `${stats.api} ms`}**\n` +
            `Event loop gecikmesi: **${stats.lag} ms**\n\n` +
            "Bot yanıtı/cache değeri 0 ms olabilir; Discord WebSocket değeri ayrı ölçülür.",
        ),
      );
      return response;
    },
  );
  ctx.add(["kurulum", "setup"], async (m) => {
    await authorize(ctx, m, null, true);
    await m.reply(
      embed(
        "Kurulum kontrolü",
        `Sunucu: **${clean(m.guild.name)}**\nÜye komutları: Manager\nİstatistik: Statistics\nSanal ekonomi: Economy\nKoruma raporları: Guard\n\nÖzel oda kategorisi: ${c.privateRoomCategoryId ? `<#${c.privateRoomCategoryId}>` : "Ayarlanmamış"}\nOda oluştur kanalı: ${c.privateRoomLobbyId ? `<#${c.privateRoomLobbyId}>` : "Ayarlanmamış"}\n\nBu komut **kanal oluşturmaz/silmez**. Kurulum için config.json dosyasını düzenleyin.`,
      ),
    );
  });
  ctx.add(["say", "server", "sunucu"], async (m) => {
    const vs = m.guild.voiceStates.cache;
    const humans = vs.filter((x) => !x.member?.user.bot);
    const online = c.presences
      ? m.guild.presences.cache.filter((p) => p.status !== "offline").size
      : null;
    await m.reply(
      embed(
        "ROAR · Sunucu bilgileri",
        `Üye: **${money(m.guild.memberCount)}**\nAktif: **${online === null ? "Presence kapalı" : money(online)}**\nSesteki üyeler: **${humans.size}**\nYayın: **${humans.filter((x) => x.streaming).size}** · Kamera: **${humans.filter((x) => x.selfVideo).size}**\nBoost: **${m.guild.premiumSubscriptionCount || 0}** · Seviye: **${m.guild.premiumTier}**${online === null ? "" : "\nAktif sayısı botun gördüğü presence verisine dayanır."}`,
      ),
    );
  });
  ctx.add(["avatar", "av", "pp"], async (m, a) => {
    const u = await user(m, a[0]);
    const url = u.displayAvatarURL({ size: 1024, extension: "png" });
    const p = embed(clean(u.username), "Profil fotoğrafı");
    p.embeds[0].image = { url };
    p.components = [row(link("Avatar URL", url))];
    await m.reply(p);
  });
  ctx.add(["banner"], async (m, a) => {
    const u = await user(m, a[0]);
    await u.fetch(true);
    const url = u.bannerURL({ size: 1024 });
    if (!url) throw Error("Bu kullanıcının erişilebilir bannerı yok.");
    const p = embed(clean(u.username), "Kullanıcı bannerı");
    p.embeds[0].image = { url };
    p.components = [row(link("Banner URL", url))];
    await m.reply(p);
  });
  ctx.add(["profil", "profile", "p"], async (m, a) => {
    const u = await user(m, a[0]);
    await u.fetch(true);
    const member = await m.guild.members.fetch(u.id).catch(() => null);
    const p = embed(
      "Kullanıcı Bilgileri",
      `<@${u.id}>\nKullanıcı ID: \`${u.id}\`\nHesap oluşturma: <t:${Math.floor(u.createdTimestamp / 1000)}:F>\nSunucuya katılma: ${member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Sunucuda değil"}\nRoller: ${
        member
          ? member.roles.cache
              .filter((r) => r.id !== m.guildId)
              .map((r) => `<@&${r.id}>`)
              .slice(0, 20)
              .join(", ") || "Yok"
          : "—"
      }`,
    );
    p.embeds[0].thumbnail = { url: u.displayAvatarURL({ size: 256 }) };
    if (u.bannerURL()) p.embeds[0].image = { url: u.bannerURL({ size: 1024 }) };
    p.components = [
      row(
        link("Profile Bak", "https:" + "//discord.com/users/" + u.id),
        link("Avatar Linki", u.displayAvatarURL({ size: 1024 })),
      ),
    ];
    await m.reply(p);
  });
  ctx.add(["afk"], async (m, a) => {
    await db.collection("afk").updateOne(
      { guildId: m.guildId, userId: m.author.id },
      {
        $set: {
          reason: clean(a.join(" ") || "Sebep belirtilmedi"),
          at: new Date(),
        },
      },
      { upsert: true },
    );
    await m.reply(
      embed(
        "AFK",
        `AFK durumunuz kaydedildi. Yeni bir mesaj yazdığınızda kaldırılır.`,
      ),
    );
  });
  ctx.add(["slowmode", "slow"], async (m, a) => {
    await authorize(ctx, m, P.ManageChannels);
    const n = Number(a[0]);
    if (!/^\d+$/.test(a[0] || "") || n > 21600)
      throw Error("0–21600 saniye yazın.");
    await m.channel.setRateLimitPerUser(n, `ROAR • ${m.author.id}`);
    await m.reply(
      embed("Yavaş mod", `<#${m.channelId}> için **${n} saniye** ayarlandı.`),
    );
  });
  ctx.add(["sil", "temizle"], async (m, a) => {
    await authorize(ctx, m, P.ManageMessages);
    const n = amount(a[0], 100);
    if (!m.channel.bulkDelete) throw Error("Bu kanal desteklenmiyor.");
    const deleted = await m.channel.bulkDelete(n, true);
    await m.channel.send(
      embed(
        "Mesaj temizliği",
        `${deleted.size} mesaj silindi. Discord'un yaş sınırını aşan mesajlar atlandı.`,
      ),
    );
  });
  ctx.add(["rol"], async (m, a) => {
    const actor = await authorize(ctx, m, P.ManageRoles);
    const member = await m.guild.members.fetch(snowflake(a[0]));
    const rid = snowflake(a[1]);
    const mode = a[2];
    if (!["ver", "al"].includes(mode)) throw Error(".rol @üye rolID ver/al");
    if (!c.allowedRoleIds.includes(rid))
      throw Error("Bu rol config.json izin listesinde değil.");
    const role = await m.guild.roles.fetch(rid);
    if (
      !role ||
      role.managed ||
      !role.editable ||
      role.permissions.bitfield !== 0n
    )
      throw Error(
        "Bu sürüm yalnız izin yetkisi içermeyen yönetilebilir rolleri değiştirir.",
      );
    if (
      actor.id !== m.guild.ownerId &&
      actor.roles.highest.comparePositionTo(role) <= 0
    )
      throw Error("Rol hiyerarşisi uygun değil.");
    if (mode === "ver") await member.roles.add(rid);
    else await member.roles.remove(rid);
    await log(
      ctx,
      m.guild,
      "Rol işlemi",
      `Yetkili: <@${actor.id}> · Hedef: <@${member.id}>\n<@&${rid}> · ${mode}`,
    );
    await m.reply(embed("Rol işlemi", "Tamamlandı."));
  });
  async function punish(m, a, type) {
    const uid = snowflake(a[0]);
    const perm = type === "ban" ? P.BanMembers : P.ModerateMembers;
    const t = await target(ctx, m, uid, perm);
    const ms = type === "timeout" ? duration(a[1]) : null;
    const reason = clean(
      a.slice(type === "timeout" ? 2 : 1).join(" ") || "Sebep belirtilmedi",
    );
    const cid = id();
    await db.collection("cases").insertOne({
      _id: cid,
      guildId: m.guildId,
      userId: uid,
      actorId: m.author.id,
      type,
      reason,
      status: "pending",
      at: new Date(),
      expiresAt: ms ? new Date(Date.now() + ms) : null,
    });
    try {
      if (type === "ban") await t.ban({ reason: `${m.author.id}: ${reason}` });
      else {
        if (!t.moderatable) throw Error("Hedef susturulamıyor.");
        await t.timeout(ms, `${m.author.id}: ${reason}`);
      }
      await db
        .collection("cases")
        .updateOne({ _id: cid }, { $set: { status: "active" } });
    } catch (e) {
      await db
        .collection("cases")
        .updateOne({ _id: cid }, { $set: { status: "review_required" } });
      throw e;
    }
    await m.reply(
      embed(
        "Ceza uygulandı",
        `<@${uid}> · **${type}**\nSebep: ${reason}\nCeza numarası: \`${cid}\``,
      ),
    );
    await log(
      ctx,
      m.guild,
      "Ceza kaydı",
      `<@${uid}> · ${type} · Yetkili <@${m.author.id}>\nKayıt: \`${cid}\``,
    );
  }
  ctx.add(["ban"], (m, a) => punish(m, a, "ban"));
  ctx.add(["timeout", "to"], (m, a) => punish(m, a, "timeout"));
  ctx.add(["unban"], async (m, a) => {
    await authorize(ctx, m, P.BanMembers);
    const uid = snowflake(a[0]);
    await m.guild.members.unban(uid, `ROAR • ${m.author.id}`);
    await db.collection("cases").updateMany(
      { guildId: m.guildId, userId: uid, type: "ban", status: "active" },
      {
        $set: {
          status: "revoked",
          revokedBy: m.author.id,
          revokedAt: new Date(),
        },
      },
    );
    await log(
      ctx,
      m.guild,
      "Ban kaldırıldı",
      `<@${uid}> · Yetkili: <@${m.author.id}>`,
    );
    await m.reply(embed("Ban kaldırıldı", `<@${uid}> için ban kaldırıldı.`));
  });
  ctx.add(["untimeout", "unto"], async (m, a) => {
    const uid = snowflake(a[0]);
    const t = await target(ctx, m, uid, P.ModerateMembers);
    if (!t.isCommunicationDisabled()) throw Error("Aktif timeout yok.");
    await t.timeout(null, `ROAR • ${m.author.id}`);
    await db.collection("cases").updateMany(
      { guildId: m.guildId, userId: uid, type: "timeout", status: "active" },
      {
        $set: {
          status: "revoked",
          revokedBy: m.author.id,
          revokedAt: new Date(),
        },
      },
    );
    await log(
      ctx,
      m.guild,
      "Timeout kaldırıldı",
      `<@${uid}> · Yetkili: <@${m.author.id}>`,
    );
    await m.reply(
      embed("Timeout kaldırıldı", `<@${uid}> için timeout kaldırıldı.`),
    );
  });
  ctx.add(["cezalar", "sicil"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers);
    const uid = snowflake(a[0]);
    const cases = await db
      .collection("cases")
      .find({ guildId: m.guildId, userId: uid })
      .sort({ at: -1 })
      .limit(10)
      .toArray();
    await m.reply(
      embed(
        "Ceza geçmişi",
        cases.length
          ? cases
              .map(
                (x) =>
                  `**${x.type}** · ${x.status}\n${clean(x.reason)}\n\`${x._id}\``,
              )
              .join("\n\n")
          : "Kayıt bulunamadı.",
      ),
    );
  });
  ctx.add(["renkpanel"], async (m) => {
    await authorize(ctx, m, null, true);
    const roles = c.colorRoles.filter((x) => x.id);
    if (!roles.length) throw Error("Önce renk rol ID’lerini yapılandırın.");
    await m.channel.send(
      panel(
        "Renk Rolleri",
        "Aşağıdan renk rolünüzü seçin. Diğer rolleriniz korunur.",
        [
          row(
            ...roles
              .slice(0, 5)
              .map((x) => button(`m:color:${x.id}`, x.name, 2, x.emoji)),
          ),
          row(button("m:color:clear", "Renk Rollerini Temizle", 4)),
        ],
      ),
    );
  });
  ctx.add(["odapanel"], async (m) => {
    await authorize(ctx, m, null, true);
    if (!c.privateRoomLobbyId)
      throw Error("Özel oda giriş kanalı ayarlanmalı.");
    await m.channel.send(await roomPanel(ctx));
  });
  async function moveRequest(m, a, mode) {
    const uid = snowflake(a[0]);
    const actor = await m.guild.members.fetch(m.author.id);
    const t = await m.guild.members.fetch(uid);
    if (
      !actor.voice.channel ||
      !t.voice.channel ||
      uid === actor.id ||
      t.user.bot
    )
      throw Error("İki kullanıcı da farklı ses kanallarında olmalı.");
    if (actor.voice.channelId === t.voice.channelId)
      throw Error("Zaten aynı kanaldasınız.");
    const token = await session(
      ctx,
      "move",
      uid,
      m.channelId,
      {
        actorId: actor.id,
        targetId: t.id,
        mode,
        source: mode === "git" ? actor.voice.channelId : t.voice.channelId,
        dest: mode === "git" ? t.voice.channelId : actor.voice.channelId,
      },
      60,
    );
    await m.reply({
      ...embed(
        "Ses kanalı isteği",
        `<@${actor.id}>, ${mode === "git" ? "odanıza gelmek" : "sizi kendi odasına çekmek"} istiyor. Yalnız <@${uid}> onaylayabilir.\nİstek 60 saniye geçerlidir.`,
      ),
      components: [
        row(
          button(`m:${token}:moveYes`, "Onayla", 3),
          button(`m:${token}:moveNo`, "Reddet", 4),
        ),
      ],
    });
  }
  ctx.add(["git", "go"], (m, a) => moveRequest(m, a, "git"));
  ctx.add(["çek", "cek", "pull"], (m, a) => moveRequest(m, a, "çek"));
  ctx.onInteraction(async (i) => {
    if (i.customId.startsWith("m:room")) return roomInteraction(ctx, i);
    const [, token, action, arg] = i.customId.split(":");
    if (token === "color") {
      await i.deferReply({ flags: EPH });
      const member = await i.guild.members.fetch(i.user.id);
      const allowed = c.colorRoles.map((x) => x.id).filter(Boolean);
      if (action !== "clear" && !allowed.includes(action))
        throw Error("Geçersiz renk.");
      await ctx.lock(`color:${i.user.id}`, async () => {
        for (const rid of allowed) {
          const role = await i.guild.roles.fetch(rid);
          if (
            !role ||
            role.managed ||
            !role.editable ||
            role.permissions.bitfield !== 0n
          )
            throw Error("Renk rolü yönetilemiyor.");
        }
        await member.roles.remove(allowed);
        if (action !== "clear") await member.roles.add(action);
      });
      return i.editReply({ content: "Renk rolleri güncellendi." });
    }
    const s = await readSession(ctx, i, token);
    if (s.kind === "help") {
      const selectedCategory = i.values?.[0];
      const category =
        action === "helpCategory" ? String(selectedCategory || "") : s.data.category;
      if (!catalog.some((x) => x[0] === category))
        throw Error("Kategori bulunamadı.");
      const page = action === "helpPage" ? Number(arg) : 0;
      const view = helpView(token, category, page);
      const persist = db
        .collection("sessions")
        .updateOne({ _id: token }, { $set: { "data.category": category } })
        .catch((e) => ctx.report("Yardım oturumu güncellenemedi", e));
      if (typeof i.update === "function") {
        await i.update(view);
        await persist;
        return;
      }
      await i.deferUpdate();
      await i.editReply(view);
      await persist;
      return;
    }
    if (s.kind === "move") {
      await i.deferUpdate();
      await ctx.lock(token, async () => {
        const claimed = await db
          .collection("sessions")
          .findOneAndDelete({ _id: token });
        if (!claimed) throw Error("İstek zaten yanıtlandı.");
        if (action === "moveNo")
          return i.editReply({
            ...embed("İstek reddedildi", "Ses taşıması yapılmadı."),
            components: [],
          });
        if (action !== "moveYes") throw Error("Geçersiz yanıt.");
        const actor = await i.guild.members.fetch(s.data.actorId);
        const t = await i.guild.members.fetch(s.data.targetId);
        const mover = s.data.mode === "git" ? actor : t;
        const host = s.data.mode === "git" ? t : actor;
        const dest = await i.guild.channels.fetch(s.data.dest);
        if (
          !dest ||
          mover.voice.channelId !== s.data.source ||
          host.voice.channelId !== dest.id
        )
          throw Error("Ses kanalları değişti; isteği yeniden gönderin.");
        if (!dest.permissionsFor(mover)?.has([P.ViewChannel, P.Connect]))
          throw Error("Hedef oda izinleri uygun değil.");
        await mover.voice.setChannel(dest);
        await i.editReply({
          ...embed("Ses taşıması tamamlandı", `<@${mover.id}> → <#${dest.id}>`),
          components: [],
        });
      });
    }
  });
  ctx.event("messageCreate", async (m) => {
    if (!m.guild || m.guildId !== c.guildId || m.author.bot) return;
    const command = m.content.startsWith(c.prefix)
      ? m.content.slice(c.prefix.length).split(/\s+/)[0].toLowerCase()
      : "";
    if (command !== "afk") {
      const old = await db
        .collection("afk")
        .findOneAndDelete({ guildId: m.guildId, userId: m.author.id });
      if (old)
        await m.reply(embed("Tekrar hoş geldin", "AFK durumunuz kaldırıldı."));
    }
    if (m.mentions.users.size) {
      const ids = [...m.mentions.users.keys()].slice(0, 5);
      const users = await db
        .collection("afk")
        .find({ guildId: m.guildId, userId: { $in: ids } })
        .toArray();
      if (users.length)
        await m.reply(
          embed(
            "AFK bilgisi",
            users
              .map(
                (x) =>
                  `<@${x.userId}>: ${x.reason} · <t:${Math.floor(x.at / 1000)}:R>`,
              )
              .join("\n"),
          ),
        );
    }
  });
  ctx.every(60000, () =>
    db.collection("cases").updateMany(
      {
        guildId: c.guildId,
        type: "timeout",
        status: "active",
        expiresAt: { $lte: new Date() },
      },
      { $set: { status: "expired" } },
    ),
  );
  installRooms(ctx);
}
