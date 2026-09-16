import fs from "node:fs";
import sharp from "sharp";
import {
  embed,
  row,
  button,
  EPH,
  session,
  readSession,
  select,
} from "../core/ui.mjs";
import { P, authorize } from "../core/auth.mjs";
import { roomControls } from "./rooms.mjs";
import { snowflake, clean, xml } from "../core/util.mjs";
import { catalog } from "../core/catalog.mjs";
const groups = [
  "Genel Komutlar",
  "İstatistik Komutları",
  "Yetkili Komutları",
  "Yetenek ve Diğer Komutlar",
  "Yönetim Komutları",
  "Kurucu Komutları",
];
export function mecraHelp(token, category = "Genel Komutlar", page = 0) {
  const general = [
    "afk <Sebep>",
    "avatar <@üye/ID>",
    "banner <@üye/ID>",
    "booster",
    "cezapuan <@üye/ID>",
    "banner-oluştur <Yazı>",
    "aktivite",
    "izinligit @üye/ID",
    "profil <@üye/ID>",
    "izinliçek @üye/ID",
    "baninfo <@üye/ID>",
    "soncezalar",
    "ceza <Ceza-No>",
    "cezalar <@üye/ID>",
  ];
  const categoryMap = {
    "İstatistik Komutları": ["İstatistik"],
    "Yetkili Komutları": ["Ceza"],
    "Yetenek ve Diğer Komutlar": ["Ekonomi", "Oyun ve Mağaza"],
    "Yönetim Komutları": ["Kullanıcı", "Topluluk"],
    "Kurucu Komutları": ["Guard", "Yönetim", "Booster"],
  };
  const list =
    category === "Genel Komutlar"
      ? general
      : catalog
          .filter((x) => (categoryMap[category] || []).includes(x[0]))
          .map((x) => x[3]);
  const pages = Math.max(1, Math.ceil(list.length / 14)),
    p = Math.max(0, Math.min(page, pages - 1));
  const components = [
    {
      type: 10,
      content:
        list
          .slice(p * 14, p * 14 + 14)
          .map((x) => "`." + x.replaceAll("`", "") + "`")
          .join("\n") || "Bu kategoride komut yok.",
    },
    select(
      `m:help:${token}:category`,
      "Yardım kategorisini listeden seçin!",
      groups.map((x) => ({
        label: x,
        value: x,
        description: "Bu kategorideki komutları gösterir.",
      })),
    ),
  ];
  if (pages > 1)
    components.push(
      row(
        {
          ...button(`m:help:${token}:page:${p - 1}`, "Önceki"),
          disabled: p === 0,
        },
        { ...button("noop", `${p + 1}/${pages}`), disabled: true },
        {
          ...button(`m:help:${token}:page:${p + 1}`, "Sonraki"),
          disabled: p === pages - 1,
        },
      ),
    );
  return {
    flags: 32768,
    components: [{ type: 17, components }],
    allowedMentions: { parse: [] },
  };
}
export async function bannerBuffer(value) {
  const bg = fs
      .readFileSync(new URL("../../assets/aquatic.jpg", import.meta.url))
      .toString("base64"),
    words = String(value).slice(0, 60).split(/\s+/u),
    lines = [""];
  for (const word of words) {
    for (const part of word.match(/.{1,30}/gu) || []) {
      const last = lines.at(-1);
      if ((last + " " + part).trim().length > 30) lines.push(part);
      else lines[lines.length - 1] = (last + " " + part).trim();
    }
  }
  const size = Math.min(
    48,
    Math.floor(980 / Math.max(...lines.map((s) => [...s].length), 1)),
  );
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="400"><image href="data:image/jpeg;base64,${bg}" width="1100" height="400" preserveAspectRatio="xMidYMid slice"/><rect width="1100" height="400" fill="#061c2e" fill-opacity=".75"/><rect x="20" y="20" width="1060" height="360" rx="18" fill="none" stroke="#688ba9"/>${lines.map((s, i) => `<text x="550" y="${200 - (lines.length - 1) * 30 + i * 60}" text-anchor="middle" font-family="Arial" font-size="${size}" font-weight="bold" fill="#eaf4ff">${xml(s)}</text>`).join("")}<text x="550" y="363" text-anchor="middle" font-family="Arial" font-size="18" fill="#c9dfef">ROAR • begovic</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
}
export async function install(ctx) {
  const { db, c } = ctx;
  ctx.replace(["yardım", "yardim", "help", "y"], async (m) => {
    const token = await session(
      ctx,
      "mecraHelp",
      m.author.id,
      m.channelId,
      { category: "Genel Komutlar", page: 0 },
      600,
    );
    await m.reply(mecraHelp(token));
  });
  ctx.onInteraction(async (i) => {
    const [, , token, action, value] = i.customId.split(":"),
      s = await readSession(ctx, i, token);
    if (s.kind !== "mecraHelp") throw Error("Geçersiz yardım menüsü.");
    await i.deferUpdate();
    const d = { ...s.data };
    if (action === "category") {
      if (!groups.includes(i.values[0])) throw Error("Geçersiz kategori.");
      d.category = i.values[0];
      d.page = 0;
    } else if (action === "page" && /^\d+$/.test(value)) d.page = Number(value);
    else throw Error("Geçersiz sayfa.");
    await db
      .collection("sessions")
      .updateOne({ _id: token }, { $set: { data: d } });
    await i.editReply(mecraHelp(token, d.category, d.page));
  }, "m:help:");
  ctx.alias(["izinligit"], "git");
  ctx.alias(["izinliçek", "izinlicek"], "çek");
  ctx.alias(["özeloda", "ozeloda"], "odapanel");
  ctx.add(["ikonkur"], async (m) => {
    await authorize(ctx, m, P.ManageGuildExpressions, true);
    const me = await m.guild.members.fetchMe();
    if (!me.permissions.has(P.ManageGuildExpressions))
      throw Error("Botun emoji yönetme izni gerekli.");
    await ctx.lock("roomIcons:" + m.guildId, async () => {
      const existing = await m.guild.emojis.fetch();
      for (const [action] of roomControls) {
        const name = "roar_room_" + action;
        let emoji = existing.find((x) => x.name === name);
        if (!emoji)
          emoji = await m.guild.emojis.create({
            name,
            attachment: fs.readFileSync(
              new URL(
                "../../assets/room-icons/" + action + ".png",
                import.meta.url,
              ),
            ),
            reason: "ROAR oda paneli ikon kurulumu",
          });
        await db
          .collection("uiAssets")
          .updateOne(
            { _id: m.guildId },
            {
              $set: {
                ["roomEmoji." + action]: { id: emoji.id, name: emoji.name },
              },
            },
            { upsert: true },
          );
      }
      await m.reply(
        embed(
          "Oda ikonları hazır",
          "Dokuz beyaz çizgi ikon kuruldu. .odapanel ile paneli yeniden gönderin.",
        ),
      );
    });
  });
  ctx.add(["booster", "boost"], async (m) => {
    await m.reply({
      ...embed(
        "Booster Özel Rol Sistemi",
        `Kendine özel rolünü oluştur, düzenle ve ${c.boosterShareLimit} arkadaşınla paylaş. Boost kaybında rol 3 gün askıya alınır.`,
      ),
      components: [
        row(
          button("m:boost:create", "Oluştur", 3),
          button("m:boost:rename", "Düzenle"),
          button("m:boost:color", "Renk"),
          button("m:boost:share", "Paylaşım"),
          button("m:boost:delete", "Sil", 4),
        ),
      ],
    });
  });
  ctx.add(["banner-oluştur", "banner-olustur"], async (m, a) => {
    const text = a.join(" ").trim();
    if (!text || text.length > 60)
      throw Error("1–60 karakterlik başlık yazın.");
    await m.reply({
      files: [
        { attachment: await bannerBuffer(text), name: "roar-banner.png" },
      ],
      allowedMentions: { parse: [] },
    });
  });
  ctx.add(["baninfo"], async (m, a) => {
    await authorize(ctx, m, P.BanMembers);
    const uid = snowflake(a[0]);
    const ban = await m.guild.bans.fetch(uid).catch((e) => {
      if (e.code === 10026) return null;
      throw e;
    });
    const force = await db
      .collection("forceRules")
      .findOne({ guildId: m.guildId, userId: uid });
    await m.reply(
      embed(
        "Yasaklama bilgisi",
        `Üye: <@${uid}>\nSunucu yasağı: ${ban ? "Var" : "Yok"}\nForceban: ${force ? "Var" : "Yok"}\nSebep: ${ban?.reason || force?.reason || "Belirtilmemiş"}`,
      ),
    );
  });
  ctx.add(["aktivite"], async (m, a) => {
    if (!c.presences)
      throw Error("Manager Presence Intent ve ENABLE_PRESENCES gerekli.");
    const member = await m.guild.members.fetch(
        a[0] ? snowflake(a[0]) : m.author.id,
      ),
      activities = member.presence?.activities || [];
    await m.reply(
      embed(
        "Görünür aktiviteler",
        activities
          .map(
            (x) =>
              `**${clean(x.name)}**\n${clean(x.details || "")} ${clean(x.state || "")}`,
          )
          .join("\n\n") || "Görünür etkinlik yok.",
      ),
    );
  });
  ctx.add(["snipe"], async (m, a) => {
    await authorize(ctx, m, P.ManageMessages);
    if (
      !m.channel
        .permissionsFor(m.member)
        ?.has([P.ViewChannel, P.ReadMessageHistory])
    )
      throw Error("Kanalı okuma izniniz yok.");
    if (a[0] === "temizle") {
      await db.collection("snipes").deleteOne({ _id: m.channelId });
      return m.reply(
        embed(
          "Snipe kaydı temizlendi",
          "Bu kanalın kısa süreli silinen mesaj kaydı kaldırıldı.",
        ),
      );
    }
    const r = await db
      .collection("snipes")
      .findOne({
        _id: m.channelId,
        guildId: m.guildId,
        expiresAt: { $gt: new Date() },
      });
    await m.reply(
      embed(
        "Son silinen mesaj",
        r
          ? `<@${r.userId}> · <t:${Math.floor(r.at / 1000)}:R>\n${r.text}`
          : "Son 5 dakikadan kayıt yok. Takip için snipeEnabled etkin olmalı.",
      ),
    );
  });
  await db
    .collection("snipes")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  ctx.event("messageDelete", async (m) => {
    if (
      !c.snipeEnabled ||
      m.guildId !== c.guildId ||
      !m.author ||
      m.author.bot ||
      !m.content
    )
      return;
    await db
      .collection("snipes")
      .updateOne(
        { _id: m.channelId },
        {
          $set: {
            guildId: m.guildId,
            userId: m.author.id,
            text: m.content.slice(0, 1800),
            at: new Date(),
            expiresAt: new Date(Date.now() + 300000),
          },
        },
        { upsert: true },
      );
  });
  ctx.add(["vip"], async (m, a) => {
    await authorize(ctx, m, P.ManageRoles);
    if (!c.vipRoleId || !c.allowedRoleIds.includes(c.vipRoleId))
      throw Error("VIP rolü yapılandırılmış ve allowedRoleIds içinde olmalı.");
    const role = await m.guild.roles.fetch(c.vipRoleId),
      actor = await m.guild.members.fetch(m.author.id),
      member = await m.guild.members.fetch(snowflake(a[0]));
    if (
      !role?.editable ||
      role.managed ||
      role.permissions.bitfield !== 0n ||
      (actor.id !== m.guild.ownerId &&
        (actor.roles.highest.comparePositionTo(role) <= 0 ||
          actor.roles.highest.comparePositionTo(member.roles.highest) <= 0))
    )
      throw Error("VIP rolü yetki/hiyerarşi koşullarını karşılamıyor.");
    await member.roles.add(role.id);
    await m.reply(embed("VIP rolü verildi", `<@${member.id}>`));
  });
  ctx.add(["url"], async (m) => {
    if (!m.guild.vanityURLCode)
      return m.reply(
        embed("Özel sunucu bağlantısı", "Görünür özel davet kodu yok."),
      );
    await m.reply(
      embed(
        "Özel sunucu bağlantısı",
        "https://discord.gg/" + m.guild.vanityURLCode,
      ),
    );
  });
  ctx.add(["tani", "tanı"], async (m) => {
    await authorize(ctx, m, null, true);
    const pending = await db
      .collection("rooms")
      .countDocuments({
        guildId: m.guildId,
        transferPending: { $exists: true },
      });
    await m.reply(
      embed(
        "ROAR tanılama",
        `Sürüm: 0.3.0-recovery.1\nÇalışma süresi: ${Math.floor(process.uptime())} saniye\nManager gecikmesi: ${Math.max(0, ctx.client.ws.ping)} ms\nBekleyen oda devri: ${pending}\nToken/şifre gösterilmez; serbest kod çalıştırılmaz.`,
      ),
    );
  });
}
