import { Client, GatewayIntentBits as I, ActivityType } from "discord.js";
import { fileURLToPath } from "node:url";
import { config } from "./core/config.mjs";
import { connect } from "./core/db.mjs";
import { embed, EPH } from "./core/ui.mjs";
import { id, makeLock } from "./core/util.mjs";
import {
  inject,
  createClientOptions,
  bindNativeDb,
} from "./core/ultra-hizlandirici.mjs";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const role = process.argv[2],
  roles = [
    "voucher",
    "manager",
    "main",
    "economy",
    "statistics",
    "guard",
    "moderation",
  ];
let ctx,
  dbClient,
  client,
  stopping = false;
const timers = [];
function report(label, e) {
  console.error(
    `[${role}] ${label} (${e?.name || "Error"}${e?.code ? ":" + e.code : ""})`,
  );
  if (e?.stack) console.error("STACK:", e.stack.split("\n")[0]);
}
const friendly = (e) =>
  e?.constructor === Error && !e.code
    ? String(e.message).slice(0, 300)
    : "İşlem yapılamadı. İzinleri/ayarları kontrol edin. Tekrar denemeden önce mevcut durumu doğrulayın.";
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const t of timers) clearInterval(t);
  client?.destroy();
  try {
    if (ctx)
      await ctx.db
        .collection("leases")
        .deleteOne({ _id: ctx.leaseKey, holder: ctx.holder });
    await dbClient?.close();
  } finally {
    process.exit(code);
  }
}
try {
  if (!roles.includes(role))
    throw Error("voucher / manager / main / economy / statistics / guard / moderation seçin.");
  const c = config(),
    token = process.env[role.toUpperCase() + "_TOKEN"];
  if (!token) throw Error("Bot tokenini yerel .env dosyasına ekleyin.");
  const supplied = roles
    .map((r) => process.env[r.toUpperCase() + "_TOKEN"])
    .filter(Boolean);
  if (new Set(supplied).size !== supplied.length)
    throw Error("Beş farklı bot tokeni gerekli.");
  const store = await connect(c);
  dbClient = store.client;
  const holder = id(),
    leaseKey = c.guildId + ":" + role;
  try {
    await store.db
      .collection("leases")
      .findOneAndUpdate(
        { _id: leaseKey, $or: [{ until: { $lt: new Date() } }, { holder }] },
        { $set: { holder, until: new Date(Date.now() + 30000) } },
        { upsert: true },
      );
  } catch (e) {
    if (e.code === 11000) throw Error("Bu bot zaten çalışıyor.");
    throw e;
  }
  const intents = [I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent];
  if (["manager", "statistics"].includes(role))
    intents.push(I.GuildVoiceStates);
  if (["moderation", "manager"].includes(role)) intents.push(I.GuildModeration);
  if (role === "statistics") intents.push(I.GuildInvites);
  if (c.presences && role === "manager") intents.push(I.GuildPresences);
  client = new Client(
    createClientOptions({
      role,
      intents,
      presences: !!c.presences,
      allowedMentions: { parse: [], repliedUser: false },
    }),
  );
  // Ultra v5: LRU cache, sweeper, lag monitor, reply defaults (mongoose yok)
  inject(client, {
    mongoUrl: c.uri,
    nativeDb: store.db,
    assumeMongoReady: true,
    skipProcessHooks: true,
    keepVoice: ["manager", "statistics"].includes(role),
    debug: process.env.ULTRA_DEBUG === "true",
  });
  bindNativeDb(store.db);

  const commands = new Map(),
    handlers = [],
    ready = [];
  ctx = {
    ...store,
    c,
    role,
    client,
    holder,
    leaseKey,
    report,
    lock: makeLock(),
    add(names, fn) {
      for (const n of names) {
        if (commands.has(n)) throw Error("Komut çakışması.");
        commands.set(n, fn);
      }
    },
    onInteraction(
      fn,
      prefix = {
        voucher: "v:",
        manager: "m:",
        main: "ma:",
        economy: "e:",
        statistics: "s:",
        guard: "g:",
        moderation: "mo:",
      }[role],
    ) {
      handlers.push({ fn, prefix });
    },
    replace(names, fn) {
      for (const n of names) commands.set(n, fn);
    },
    alias(names, original) {
      const fn = commands.get(original);
      if (!fn) throw Error("Alias hedefi yok.");
      for (const n of names) {
        if (commands.has(n)) throw Error("Alias çakışması.");
        commands.set(n, fn);
      }
    },
    getCommand(name){return commands.get(name);},
    hasCommand(name) {
      return commands.has(name);
    },
    onReady(fn) {
      ready.push(fn);
    },
    event(name, fn) {
      client.on(name, (...a) => {
        if (!stopping)
          Promise.resolve()
            .then(() => fn(...a))
            .catch((e) => report(name, e));
      });
    },
    every(ms, fn) {
      let busy = false;
      timers.push(
        setInterval(async () => {
          if (stopping || busy || !client.isReady()) return;
          busy = true;
          try {
            await fn();
          } catch (e) {
            report("Zamanlayıcı", e);
          } finally {
            busy = false;
          }
        }, ms),
      );
    },
    async log(g, title, text, channelId = c.logChannelId) {
      if (!channelId) return;
      try {
        const ch = await g.channels.fetch(channelId);
        if (ch?.isTextBased()) await ch.send(embed(title, text));
      } catch (e) {
        report("Log mesajı gönderilemedi", e);
      }
    },
  };
  timers.push(
    setInterval(async () => {
      try {
        const r = await store.db
          .collection("leases")
          .updateOne(
            { _id: leaseKey, holder },
            { $set: { until: new Date(Date.now() + 30000) } },
          );
        if (!r.matchedCount) throw Error("Çalışma kilidi kaybedildi.");
      } catch (e) {
        report("Çalışma kilidi", e);
        await stop(1);
      }
    }, 10000),
  );
  await (await import(`./modules/${role}.mjs`)).install(ctx);
  const moduleMap = {
    voucher: [],
    manager: ["penalties", "booster", "community", "communityOps", "mecraManager"],
    main: ["economy", "extreme-ping", "pvp", "wealth", "shop"],
    economy: ["economyExtras"],
    statistics: ["statExtras", "statDetails"],
    guard: ["guardExtras"],
    moderation: [],
  };
  for (const name of (moduleMap[role] || []))
    await (await import(`./modules/${name}.mjs`)).install(ctx);
  client.once("clientReady", async () => {
    try {
      if (!client.guilds.cache.has(c.guildId))
        throw Error("Bot sunucuda değil.");
      client.user.setPresence({
        activities: [
          { name: `ROAR ${role} • begovic`, type: ActivityType.Playing },
        ],
        status: "online",
      });
      await store.db.collection("botIdentities").updateOne(
        { _id: c.guildId + ":" + role },
        {
          $set: {
            guildId: c.guildId,
            role,
            userId: client.user.id,
            at: new Date(),
          },
        },
        { upsert: true },
      );
      for (const fn of ready) await fn();
      console.log(`[${role}] ROAR hazır • begovic`);
    } catch (e) {
      report("Başlangıç", e);
      await stop(1);
    }
  });
  const cd = new Map();
  ctx.every(60000, () => {
    for (const [k, t] of cd) if (Date.now() - t > 60000) cd.delete(k);
  });
  client.on("messageCreate", (m) => {
    if (
      stopping ||
      m.guildId !== c.guildId ||
      m.author.bot ||
      !m.content.startsWith(c.prefix)
    )
      return;
    const a = m.content.slice(c.prefix.length).trim().split(/\s+/),
      n = a.shift().toLowerCase(),
      fn = commands.get(n) || (role === "manager" ? ctx.customCommand : null);
    if (!fn || Date.now() - (cd.get(m.author.id) || 0) < 1200) return;
    cd.set(m.author.id, Date.now());
    ctx
      .lock("cmd:" + m.author.id, async () => {
        if (
          (await store.db
            .collection("commandBans")
            .findOne({ guildId: m.guildId, userId: m.author.id })) &&
          !c.owners.includes(m.author.id) &&
          m.author.id !== m.guild.ownerId
        )
          throw Error("Komut kullanımınız kapalı.");
        return fn(m, a);
      })
      .catch(async (e) => {
        report("Komut", e);
        await m
          .reply(embed("İşlem yapılamadı", friendly(e), 0xe86a8a))
          .catch(() => {});
      });
  });
  client.on("interactionCreate", async (i) => {
    if (
      stopping ||
      i.guildId !== c.guildId ||
      (!i.isMessageComponent() && !i.isModalSubmit()) ||
      !i.customId?.startsWith(
        { manager: "m:", statistics: "s:", economy: "e:", guard: "g:" }[role],
      )
    )
      return;
    try {
      if (
        (await store.db
          .collection("commandBans")
          .findOne({ guildId: i.guildId, userId: i.user.id })) &&
        !c.owners.includes(i.user.id) &&
        i.user.id !== i.guild.ownerId
      )
        throw Error("Komut erişiminiz kapalı.");
      const handler = handlers
        .filter((h) => i.customId.startsWith(h.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
      if (handler) await handler.fn(i);
    } catch (e) {
      report("Etkileşim", e);
      try {
        if (i.deferred && i.ephemeral)
          await i.editReply({ content: friendly(e) });
        else if (i.deferred || i.replied)
          await i.followUp({ content: friendly(e), flags: EPH });
        else await i.reply({ content: friendly(e), flags: EPH });
      } catch {}
    }
  });
  client.on("error", (e) => report("Discord", e));
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
  process.on("unhandledRejection", (e) => {
    report("Beklenmeyen hata", e);
    void stop(1);
  });
  await client.login(token);
} catch (e) {
  report("Başlatılamadı", e);
  console.error("DETAY:", e.message);
  console.error("STACK:", e.stack);
  console.error(friendly(e));
  await stop(1);
}
