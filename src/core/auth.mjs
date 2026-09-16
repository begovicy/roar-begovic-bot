import { PermissionFlagsBits as P } from "discord.js";
export { P };
export async function authorize(ctx, m, permission, ownerOnly = false) {
  const actor = await m.guild.members.fetch(m.author?.id || m.user.id);
  const owner = ctx.c.owners.includes(actor.id) || actor.id === m.guild.ownerId;
  if (ownerOnly && !owner) throw Error("Bu işlem yalnız kurucuya açık.");
  if (permission && !owner && !actor.permissions.has(permission))
    throw Error("Bu işlem için yetkiniz yok.");
  return actor;
}
export async function target(ctx, m, s, permission) {
  const actor = await authorize(ctx, m, permission);
  const t = await m.guild.members.fetch(s);
  const me = await m.guild.members.fetchMe();
  if (
    t.id === actor.id ||
    t.id === me.id ||
    t.id === m.guild.ownerId ||
    ctx.c.owners.includes(t.id)
  )
    throw Error("Bu hedef üzerinde işlem yapılamaz.");
  if (
    actor.id !== m.guild.ownerId &&
    actor.roles.highest.comparePositionTo(t.roles.highest) <= 0
  )
    throw Error("Hedef rol hiyerarşinizin altında olmalı.");
  if (me.roles.highest.comparePositionTo(t.roles.highest) <= 0)
    throw Error("Bot rolü hedefin üzerinde olmalı.");
  if (!me.permissions.has(permission)) throw Error("Botun gerekli izni yok.");
  return t;
}
