export function canManageRoom(room, uid, ownerOnly = false) {
  return (
    !!room &&
    (room.ownerId === uid ||
      (!ownerOnly && (room.moderators || []).includes(uid)))
  );
}
export function freshInteraction(
  record,
  guildId,
  userId,
  channelId,
  now = Date.now(),
) {
  if (
    !record ||
    record.guildId !== guildId ||
    record.userId !== userId ||
    record.channelId !== channelId ||
    +record.expiresAt <= now
  )
    throw Error("İşlem size ait değil veya süresi doldu.");
  return record;
}
export function safeRestore(roles, botPosition) {
  return roles
    .filter(
      (r) =>
        !r.managed && r.position < botPosition && BigInt(r.permissions) === 0n,
    )
    .map((r) => r.id);
}
export function parseColors(text) {
  const a = text.trim().split(/\s+/);
  if (a.length === 1 && a[0] === "holografik")
    return {
      primaryColor: 11127295,
      secondaryColor: 16759788,
      tertiaryColor: 16761760,
    };
  if (!a.length || a.length > 2 || !a.every((x) => /^#?[0-9a-f]{6}$/i.test(x)))
    throw Error(
      "Bir veya iki HEX renk yazın: #5865F2 #A875FF; ya da holografik.",
    );
  return {
    primaryColor: parseInt(a[0].replace("#", ""), 16),
    secondaryColor: a[1] ? parseInt(a[1].replace("#", ""), 16) : null,
    tertiaryColor: null,
  };
}
export function xpLevel(messages, voiceMs) {
  return Math.floor(
    Math.sqrt(
      Math.max(0, messages) * 5 + Math.floor(Math.max(0, voiceMs) / 60000),
    ) / 5,
  );
}

export function effectiveChannelPermissions(
  memberId,
  guildId,
  roles,
  overwrites,
) {
  let bits = roles.reduce((v, r) => v | BigInt(r.permissions), 0n);
  if (bits & 8n) return (1n << 64n) - 1n;
  const apply = (o) => {
    if (o) bits = (bits & ~BigInt(o.deny)) | BigInt(o.allow);
  };
  apply(overwrites.find((o) => o.id === guildId));
  const ids = new Set(roles.map((r) => r.id));
  let deny = 0n,
    allow = 0n;
  for (const o of overwrites)
    if (o.id !== guildId && ids.has(o.id)) {
      deny |= BigInt(o.deny);
      allow |= BigInt(o.allow);
    }
  bits = (bits & ~deny) | allow;
  apply(overwrites.find((o) => o.id === memberId));
  return bits;
}
