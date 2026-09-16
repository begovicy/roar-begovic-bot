import fs from "node:fs";
export function config({ requireSecrets = true } = {}) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const path = fs.existsSync("config.json")
    ? "config.json"
    : "config.example.json";
  const c = {
    snipeEnabled: false,
    vipRoleId: "",
    jailRoleId: "",
    jailChannelId: "",
    textMuteRoleId: "",
    registeredRoleId: "",
    unregisteredRoleId: "",
    staffRoleIds: [],
    tagRoleId: "",
    boosterShareLimit: 12,
    confessionReviewChannelId: "",
    confessionPublishChannelId: "",
    applicationLogChannelId: "",
    guardMode: "observe",
    guardEnforceActions: [10, 11, 12, 30, 31, 32],
    guardSafeBotIds: [],
    shopItems: [],
    ...JSON.parse(fs.readFileSync(path, "utf8")),
  };
  Object.assign(c, {
    guildId: process.env.GUILD_ID,
    owners: (process.env.OWNER_IDS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    uri:
      process.env.MONGODB_URI ||
      process.env.MONGO_URL ||
      process.env.MONGODB_URL,
    dbName: process.env.MONGODB_DB || "roar",
    presences: process.env.ENABLE_PRESENCES === "true",
  });
  if (c.brand !== "ROAR" || c.credit !== "begovic")
    throw Error("Marka ROAR ve kredi begovic olmalı.");
  if (!c.prefix || c.prefix.length > 4)
    throw Error("Önek 1–4 karakter olmalı.");
  for (const field of [
    "dailyReward",
    "maxBet",
    "gameTimeoutSeconds",
    "guardWindowSeconds",
    "guardAlertThreshold",
  ])
    if (!Number.isSafeInteger(c[field]) || c[field] <= 0)
      throw Error(`Geçersiz ayar: ${field}`);
  if (c.dailyReward > 1e9 || c.maxBet > 1e9 || c.gameTimeoutSeconds > 3600)
    throw Error("Ekonomi sınırları çok yüksek.");
  if (
    requireSecrets &&
    (!/^\d{17,20}$/.test(c.guildId || "") ||
      !c.owners.length ||
      !c.owners.every((id) => /^\d{17,20}$/.test(id)) ||
      !c.uri)
  )
    throw Error(
      ".env içindeki GUILD_ID, OWNER_IDS, MONGODB_URI alanlarını yerel ortamda doldurun.",
    );
  const validId = (x) => typeof x === "string" && /^\d{17,20}$/.test(x);
  for (const key of [
    "vipRoleId",
    "jailRoleId",
    "jailChannelId",
    "textMuteRoleId",
    "registeredRoleId",
    "unregisteredRoleId",
    "tagRoleId",
    "confessionReviewChannelId",
    "confessionPublishChannelId",
    "applicationLogChannelId",
    "logChannelId",
    "guardLogChannelId",
    "privateRoomCategoryId",
    "privateRoomLobbyId",
    "privateRoomManagementChannelId",
  ])
    if (c[key] && !validId(c[key])) throw Error("Geçersiz ID: " + key);
  for (const key of [
    "staffRoleIds",
    "guardSafeBotIds",
    "guardSafeUserIds",
    "allowedRoleIds",
    "ignoredStatChannelIds",
  ])
    if (!Array.isArray(c[key]) || !c[key].every(validId))
      throw Error("Geçersiz ID listesi: " + key);
  if (
    !Number.isInteger(c.boosterShareLimit) ||
    c.boosterShareLimit < 1 ||
    c.boosterShareLimit > 15
  )
    throw Error("Booster paylaşım limiti 1–15 olmalı.");
  if (
    c.guardWindowSeconds < 10 ||
    c.guardWindowSeconds > 120 ||
    c.guardAlertThreshold < 2 ||
    c.guardAlertThreshold > 100
  )
    throw Error("Guard eşikleri geçersiz.");
  if (
    !Array.isArray(c.guardEnforceActions) ||
    !c.guardEnforceActions.every((n) => [10, 11, 12, 30, 31, 32].includes(n))
  )
    throw Error("Guard olay listesi geçersiz.");
  if (
    !Array.isArray(c.shopItems) ||
    c.shopItems.length > 25 ||
    c.shopItems.some(
      (x) =>
        !x ||
        !/^[a-z0-9_-]{1,20}$/.test(x.id) ||
        typeof x.name !== "string" ||
        !x.name.trim() ||
        x.name.length > 50 ||
        !Number.isSafeInteger(x.price) ||
        x.price < 1 ||
        x.price > 1e9 ||
        !validId(x.roleId),
    )
  )
    throw Error("Mağaza ürünleri geçersiz.");
  if (
    new Set(c.shopItems.map((x) => x.id)).size !== c.shopItems.length ||
    new Set(c.shopItems.map((x) => x.roleId)).size !== c.shopItems.length
  )
    throw Error("Ürün kimlikleri ve rol IDleri benzersiz olmalı.");
  if (
    !Array.isArray(c.colorRoles) ||
    c.colorRoles.length > 25 ||
    c.colorRoles.some(
      (x) =>
        !x ||
        !x.name ||
        typeof x.name !== "string" ||
        x.name.length > 80 ||
        (x.id && !validId(x.id)),
    )
  )
    throw Error("Renk rolü ayarları geçersiz.");
  if (typeof c.snipeEnabled !== "boolean")
    throw Error("snipeEnabled boolean olmalı.");
  return c;
}
