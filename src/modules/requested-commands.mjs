import { embed } from "../core/ui.mjs";
import { P, authorize, target } from "../core/auth.mjs";
import { clean, snowflake, duration, id } from "../core/util.mjs";

export async function install(ctx) {
  const { db, c } = ctx;
  const memberId = (message, value) => snowflake(value || message.author.id);
  const text = (args, fallback = "Sebep belirtilmedi") =>
    clean(args.join(" ") || fallback);
  const findMember = (message, value) =>
    message.guild.members.fetch(memberId(message, value));
  const addIfMissing = (names, handler) => {
    const missing = names.filter((name) => !ctx.hasCommand(name));
    if (missing.length) ctx.add(missing, handler);
  };

  addIfMissing(["yasaklamalar"], async (m) => {
    await authorize(ctx, m, P.BanMembers);
    const bans = await m.guild.bans.fetch();
    await m.reply(
      embed(
        "Sunucu yasakları",
        bans.map((b) => `<@${b.user.id}> · ${clean(b.reason || "Sebep yok")}`).join("\n") || "Yasaklı üye yok.",
      ),
    );
  });
  addIfMissing(["taşı"], async (m, a) => {
    await authorize(ctx, m, P.MoveMembers);
    const member = await findMember(m, a[0]);
    const channel = await m.guild.channels.fetch(snowflake(a[1]));
    if (!channel?.isVoiceBased()) throw Error("Geçerli bir ses kanalı ID'si yazın.");
    if (!member.voice.channelId) throw Error("Üye ses kanalında değil.");
    await member.voice.setChannel(channel, `ROAR • ${m.author.id}`);
    await m.reply(embed("Üye taşındı", `<@${member.id}> → <#${channel.id}>`));
  });
  addIfMissing(["cezaişlemleri", "ceza işlemleri"], async (m, a) => {
    const uid = memberId(m, a[0]);
    const rows = await db.collection("cases").find({ guildId: m.guildId, userId: uid }).sort({ at: -1 }).limit(20).toArray();
    await m.reply(embed("Ceza işlemleri", rows.map((r) => `#${r.caseNo || r._id} · ${r.type} · ${r.status}\n${clean(r.reason)}`).join("\n\n") || "Kayıt yok."));
  });
  addIfMissing(["cezalartemizle"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers, true);
    const uid = memberId(m, a[0]);
    await db.collection("cases").updateMany({ guildId: m.guildId, userId: uid, status: { $in: ["active", "pending", "review_required"] } }, { $set: { status: "revoked", revokedBy: m.author.id, revokedAt: new Date() } });
    await m.reply(embed("Cezalar temizlendi", `<@${uid}> için açık ceza kayıtları kapatıldı.`));
  });
  addIfMissing(["untimeoutall"], async (m) => {
    await authorize(ctx, m, P.ModerateMembers, true);
    const members = await m.guild.members.fetch();
    let count = 0;
    for (const member of members.values()) if (member.isCommunicationDisabled()) { await member.timeout(null, `ROAR toplu kaldırma • ${m.author.id}`); count++; }
    await m.reply(embed("Timeoutlar kaldırıldı", `${count} üyede timeout kaldırıldı.`));
  });
  addIfMissing(["unjailall"], async (m) => {
    await authorize(ctx, m, P.ManageRoles, true);
    if (!c.jailRoleId) throw Error("jailRoleId ayarlanmamış.");
    const members = await m.guild.members.fetch();
    let count = 0;
    for (const member of members.values()) if (member.roles.cache.has(c.jailRoleId)) { await member.roles.remove(c.jailRoleId, `ROAR toplu jail kaldırma • ${m.author.id}`); count++; }
    await m.reply(embed("Jail rolleri kaldırıldı", `${count} üyeden jail rolü kaldırıldı.`));
  });
  addIfMissing(["not"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers);
    const uid = memberId(m, a[0]);
    if (!a[1]) throw Error("Not metni yazın.");
    await db.collection("memberNotes").insertOne({ _id: id(), guildId: m.guildId, userId: uid, actorId: m.author.id, text: clean(a.slice(1).join(" ")), at: new Date() });
    await m.reply(embed("Not eklendi", `<@${uid}> için not kaydedildi.`));
  });
  addIfMissing(["notlar"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers);
    const uid = memberId(m, a[0]);
    const rows = await db.collection("memberNotes").find({ guildId: m.guildId, userId: uid }).sort({ at: -1 }).limit(20).toArray();
    await m.reply(embed("Üye notları", rows.map((r) => `<t:${Math.floor(r.at / 1000)}:R> · <@${r.actorId}>\n${clean(r.text)}`).join("\n\n") || "Not yok."));
  });
  addIfMissing(["not-temizle"], async (m, a) => {
    await authorize(ctx, m, P.ModerateMembers, true);
    const uid = memberId(m, a[0]);
    await db.collection("memberNotes").deleteMany({ guildId: m.guildId, userId: uid });
    await m.reply(embed("Notlar temizlendi", `<@${uid}> için notlar silindi.`));
  });
  addIfMissing(["toplantıçağır", "yetkiliçağır"], async (m, a) => {
    await authorize(ctx, m, P.MentionEveryone);
    const reason = text(a, "Toplantı çağrısı");
    await m.channel.send({ content: "@here", embeds: [embed("Yetkili toplantısı", reason).embeds[0]], allowedMentions: { parse: ["everyone"] } });
    await m.reply(embed("Toplantı çağrıldı", "Yetkililere bildirim gönderildi."));
  });
  addIfMissing(["kanal"], async (m, a) => {
    const channel = await m.guild.channels.fetch(snowflake(a[0]));
    await m.reply(embed("Kanal bilgisi", `Ad: **${clean(channel.name)}**\nID: ${channel.id}\nTür: **${channel.type}**\nKategori: ${channel.parentId ? `<#${channel.parentId}>` : "Yok"}`));
  });
  addIfMissing(["rolbilgi"], async (m, a) => {
    const role = await m.guild.roles.fetch(snowflake(a[0]));
    await m.reply(embed("Rol bilgisi", `Rol: <@&${role.id}>\nID: ${role.id}\nÜye: **${role.members.size}**\nPozisyon: **${role.position}**`));
  });
  addIfMissing(["rolsay"], async (m, a) => {
    const role = await m.guild.roles.fetch(snowflake(a[0]));
    await m.reply(embed("Rol üye sayısı", `<@&${role.id}> · **${role.members.size}** üye`));
  });
  addIfMissing(["sesli"], async (m) => {
    const members = m.guild.members.cache.filter((x) => x.voice.channelId && !x.user.bot);
    await m.reply(embed("Sesli üyeler", members.map((x) => `<@${x.id}> · <#${x.voice.channelId}>`).join("\n") || "Ses kanalında üye yok."));
  });
  addIfMissing(["emojilistele"], async (m) => {
    const emojis = await m.guild.emojis.fetch();
    await m.reply(embed("Sunucu emojileri", emojis.map((e) => `${e} · ${e.name} · ${e.id}`).join("\n") || "Emoji yok."));
  });
  addIfMissing(["stickeroluştur"], async (m, a) => {
    await authorize(ctx, m, P.ManageGuildExpressions);
    const name = clean(a[1] || "roar_sticker").replace(/[^\w-]/g, "_").slice(0, 30);
    const description = clean(a.slice(3).join(" ") || "ROAR sticker");
    const sticker = await m.guild.stickers.create({ file: a[0], name, description, tags: clean(a[2] || "roar").slice(0, 200) });
    await m.reply(embed("Sticker oluşturuldu", `${sticker.name} · ${sticker.id}`));
  });
}
