import { id } from "./util.mjs";
export const EPH = 64;
export const button = (custom_id, label, style = 2, emoji) => ({
  type: 2,
  custom_id,
  label,
  style,
  ...(emoji ? { emoji: { name: emoji } } : {}),
});
export const link = (label, url) => ({ type: 2, label, url, style: 5 });
export const row = (...components) => ({ type: 1, components });
export const select = (custom_id, placeholder, options) =>
  row({
    type: 3,
    custom_id,
    placeholder,
    options: options.map((o) => ({
      label: o.label,
      value: o.value,
      ...(o.description ? { description: o.description } : {}),
    })),
  });
export const embed = (title, description, color = 0x8b79dd) => ({
  embeds: [
    {
      title,
      description: String(description).slice(0, 4000),
      color,
      footer: { text: "ROAR • begovic" },
      timestamp: new Date().toISOString(),
    },
  ],
  allowedMentions: { parse: [], repliedUser: false },
});
export const panel = (title, text, rows = []) => ({
  flags: 32768,
  components: [
    {
      type: 17,
      accent_color: 0x8b79dd,
      components: [
        { type: 10, content: `## ${title}` },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: text },
        ...rows,
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "-# ROAR • begovic" },
      ],
    },
  ],
  allowedMentions: { parse: [], repliedUser: false },
});
export function modal(custom_id, title, label, placeholder = "") {
  return {
    custom_id,
    title,
    components: [
      row({
        type: 4,
        custom_id: "value",
        label,
        style: 1,
        required: true,
        max_length: 100,
        placeholder,
      }),
    ],
  };
}
export async function session(
  ctx,
  kind,
  userId,
  channelId,
  data = {},
  seconds = 180,
) {
  const token = id();
  await ctx.db.collection("sessions").insertOne({
    _id: token,
    guildId: ctx.c.guildId,
    kind,
    userId,
    channelId,
    data,
    expiresAt: new Date(Date.now() + seconds * 1000),
  });
  return token;
}
export async function readSession(ctx, i, token) {
  const s = await ctx.db
    .collection("sessions")
    .findOne({ _id: token, guildId: i.guildId });
  if (!s || s.expiresAt < Date.now())
    throw Error("Bu menünün süresi doldu. Komutu yeniden kullanın.");
  if (s.channelId !== i.channelId || s.userId !== i.user.id)
    throw Error("Bu menü size ait değil.");
  return s;
}
export async function replyError(i) {
  const data = {
    content:
      "İşlem tamamlanamadı. Girdiyi, yetkinizi ve ayarları kontrol edin. Tekrar denemeden önce mevcut durumu kontrol edin.",
    flags: EPH,
  };
  try {
    if (i.deferred) await i.editReply({ content: data.content });
    else if (i.replied) await i.followUp(data);
    else await i.reply(data);
  } catch {}
}
