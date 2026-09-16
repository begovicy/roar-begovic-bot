'use strict';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Options,
} from "discord.js";

class UltraCache {
  constructor(limit = 20000, ttl = 60000) {
    this.m = new Map();
    this.limit = limit;
    this.ttl = ttl;
    this.hits = 0;
    this.miss = 0;
  }
  get(k) {
    const v = this.m.get(k);
    if (!v) {
      this.miss++;
      return null;
    }
    if (Date.now() > v.e) {
      this.m.delete(k);
      this.miss++;
      return v.stale ? v.d : null;
    }
    this.m.delete(k);
    this.m.set(k, v);
    this.hits++;
    return v.d;
  }
  peek(k) {
    const v = this.m.get(k);
    if (!v) return null;
    return v.d;
  }
  set(k, d, ttl = this.ttl) {
    if (this.m.size >= this.limit) {
      let n = Math.ceil(this.limit * 0.05) || 1;
      const it = this.m.keys();
      while (n-- > 0) {
        const x = it.next();
        if (x.done) break;
        this.m.delete(x.value);
      }
    }
    this.m.set(k, { d, e: Date.now() + ttl });
    return d;
  }
  setStale(k, d, ttl = this.ttl, grace = 30000) {
    if (this.m.size >= this.limit) this.m.delete(this.m.keys().next().value);
    this.m.set(k, {
      d,
      e: Date.now() + ttl,
      stale: true,
      g: Date.now() + ttl + grace,
    });
    return d;
  }
  getStale(k) {
    const v = this.m.get(k);
    if (!v) {
      this.miss++;
      return null;
    }
    if (Date.now() > (v.g || v.e)) {
      this.m.delete(k);
      this.miss++;
      return null;
    }
    this.hits++;
    return v.d;
  }
  del(k) {
    this.m.delete(k);
  }
  has(k) {
    const v = this.m.get(k);
    if (!v) return false;
    if (Date.now() > (v.g || v.e)) {
      this.m.delete(k);
      return false;
    }
    return true;
  }
  clear() {
    this.m.clear();
  }
  invalidate(p) {
    for (const k of [...this.m.keys()])
      if (typeof k === "string" && k.startsWith(p)) this.m.delete(k);
  }
  prune() {
    const n = Date.now();
    for (const [k, v] of this.m) if (n > (v.g || v.e)) this.m.delete(k);
  }
  stats() {
    const t = this.hits + this.miss;
    return {
      size: this.m.size,
      hits: this.hits,
      miss: this.miss,
      rate: t ? Math.round((this.hits / t) * 100) : 0,
    };
  }
}

const memCache = new UltraCache(20000, 60000);
const dbCache = new UltraCache(20000, 30000);
const cdCache = new UltraCache(10000, 3000);
const SYM = Symbol.for("ultra.hizlandirici.v5");
const SYM_PATCH = Symbol.for("ultra.hizlandirici.v5.patch");

let mongoReady = false;
let mongoUrl = "";
let mongoOpts = {};
let connecting = null;
let retryCount = 0;
let keepAliveTimer = null;
let sweepTimer = null;
let pruneTimer = null;
let lagTimer = null;
let eventLoopLag = 0;
let lastStats = { startedAt: Date.now(), commands: 0, errors: 0 };
let debugOn = false;
/** @type {import('mongodb').Db | null} */
let nativeDb = null;

function log(...a) {
  if (debugOn)
    try {
      console.log("[ultra-v5]", ...a);
    } catch {}
}

async function getMongoose() {
  try {
    const m = await import("mongoose");
    return m.default || m;
  } catch {
    return null;
  }
}

async function connectMongo(url, opts = {}) {
  const mongoose = await getMongoose();
  if (!mongoose || !url) return false;
  if (mongoose.connection.readyState === 1) {
    mongoReady = true;
    warmMongo();
    return true;
  }
  if (connecting) return connecting;
  mongoUrl = url;
  mongoOpts = opts;
  try {
    mongoose.set("autoIndex", false);
  } catch {}
  try {
    mongoose.set("bufferCommands", false);
  } catch {}
  try {
    mongoose.set("sanitizeFilter", true);
  } catch {}
  connecting = (async () => {
    try {
      await mongoose.connect(url, {
        maxPoolSize: opts.maxPoolSize || 20,
        minPoolSize: opts.minPoolSize || 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 20000,
        connectTimeoutMS: 5000,
        heartbeatFrequencyMS: 5000,
        retryWrites: true,
        compressors: ["zstd", "zlib"],
        ...opts,
      });
      mongoReady = true;
      retryCount = 0;
      connecting = null;
      log("mongo connected");
      try {
        mongoose.connection.removeAllListeners("disconnected");
        mongoose.connection.removeAllListeners("connected");
        mongoose.connection.on("disconnected", () => {
          mongoReady = false;
          scheduleReconnect();
        });
        mongoose.connection.on("connected", () => {
          mongoReady = true;
          retryCount = 0;
        });
        mongoose.connection.on("error", () => {});
      } catch {}
      warmMongo();
      return true;
    } catch {
      connecting = null;
      mongoReady = false;
      scheduleReconnect();
      return false;
    }
  })();
  return connecting;
}

function scheduleReconnect() {
  if (!mongoUrl || connecting) return;
  retryCount++;
  const wait = Math.min(5000 * Math.pow(1.5, Math.min(retryCount, 6)), 60000);
  log("mongo retry in", wait);
  setTimeout(() => {
    connectMongo(mongoUrl, mongoOpts).catch(() => {});
  }, wait).unref?.();
}

function warmMongo() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(async () => {
    try {
      if (nativeDb) {
        await nativeDb.admin().ping().catch(() => {});
        return;
      }
      const mongoose = await getMongoose();
      if (
        mongoose?.connection?.readyState === 1 &&
        mongoose.connection.db
      )
        mongoose.connection.db.admin().ping().catch(() => {});
    } catch {}
  }, 25000);
  try {
    keepAliveTimer.unref();
  } catch {}
}

function modelOf(name, mongoose) {
  try {
    if (mongoose.models[name]) return mongoose.models[name];
    const sch = new mongoose.Schema(
      {},
      { strict: false, autoIndex: false, versionKey: false },
    );
    return mongoose.model(name, sch, name);
  } catch {
    try {
      return mongoose.models[name] || null;
    } catch {
      return null;
    }
  }
}

function resolveModel(modelName, mongoose) {
  if (!mongoose) return null;
  if (typeof modelName !== "string") return modelName || null;
  return modelOf(modelName, mongoose);
}

function ckey(modelName, query) {
  const n =
    typeof modelName === "string"
      ? modelName
      : modelName?.modelName ||
        modelName?.collection?.collectionName ||
        "m";
  return n + ":" + JSON.stringify(query);
}

/** Native MongoDB driver (ROAR store.db) bağla — mongoose gerekmez */
export function bindNativeDb(db) {
  nativeDb = db || null;
  if (nativeDb) {
    mongoReady = true;
    warmMongo();
  }
  return nativeDb;
}

export function markMongoReady(ready = true) {
  mongoReady = !!ready;
  if (mongoReady) warmMongo();
}

async function dbGet(modelName, query, ttl = 30000) {
  const key = ckey(modelName, query);
  const hit = dbCache.get(key);
  if (hit) return hit;
  const stale = dbCache.getStale(key);

  if (nativeDb && typeof modelName === "string") {
    if (stale) {
      setImmediate(async () => {
        try {
          const f = await nativeDb
            .collection(modelName)
            .findOne(query, { maxTimeMS: 3000 });
          if (f) dbCache.setStale(key, f, ttl);
        } catch {}
      });
      return stale;
    }
    const t0 = Date.now();
    const doc = await nativeDb
      .collection(modelName)
      .findOne(query, { maxTimeMS: 3000 })
      .catch(() => null);
    if (doc && Date.now() - t0 < 2000) dbCache.setStale(key, doc, ttl);
    return doc;
  }

  const mongoose = await getMongoose();
  if (!mongoose || mongoose.connection.readyState !== 1) return stale;
  const M = resolveModel(modelName, mongoose);
  if (!M) return stale;
  if (stale) {
    setImmediate(async () => {
      try {
        const f = await M.findOne(query)
          .lean()
          .maxTimeMS(3000)
          .exec()
          .catch(() => null);
        if (f) dbCache.setStale(key, f, ttl);
      } catch {}
    });
    return stale;
  }
  const t0 = Date.now();
  const doc = await M.findOne(query)
    .lean()
    .maxTimeMS(3000)
    .exec()
    .catch(() => null);
  if (doc && Date.now() - t0 < 2000) dbCache.setStale(key, doc, ttl);
  return doc;
}

async function dbGetMany(modelName, query, ttl = 30000, limit = 50) {
  const key = ckey(modelName, query) + ":many:" + limit;
  const hit = dbCache.get(key);
  if (hit) return hit;

  if (nativeDb && typeof modelName === "string") {
    const docs = await nativeDb
      .collection(modelName)
      .find(query)
      .limit(limit)
      .maxTimeMS(3000)
      .toArray()
      .catch(() => []);
    if (docs) dbCache.setStale(key, docs, ttl);
    return docs || [];
  }

  const mongoose = await getMongoose();
  if (!mongoose || mongoose.connection.readyState !== 1)
    return dbCache.getStale(key) || [];
  const M = resolveModel(modelName, mongoose);
  if (!M) return [];
  const docs = await M.find(query)
    .lean()
    .limit(limit)
    .maxTimeMS(3000)
    .exec()
    .catch(() => []);
  if (docs) dbCache.setStale(key, docs, ttl);
  return docs || [];
}

async function dbUpsert(modelName, query, data, ttl = 30000) {
  if (nativeDb && typeof modelName === "string") {
    const doc = await nativeDb
      .collection(modelName)
      .findOneAndUpdate(
        query,
        { $set: data },
        { upsert: true, returnDocument: "after" },
      )
      .catch(() => null);
    const key = ckey(modelName, query);
    if (doc) dbCache.setStale(key, doc, ttl);
    else dbCache.del(key);
    dbCache.invalidate(key + ":many");
    return doc;
  }

  const mongoose = await getMongoose();
  if (!mongoose || mongoose.connection.readyState !== 1) return null;
  const M = resolveModel(modelName, mongoose);
  if (!M) return null;
  const doc = await M.findOneAndUpdate(
    query,
    { $set: data },
    { upsert: true, new: true, lean: true },
  )
    .exec()
    .catch(() => null);
  const key = ckey(modelName, query);
  if (doc) dbCache.setStale(key, doc, ttl);
  else dbCache.del(key);
  dbCache.invalidate(key + ":many");
  return doc;
}

async function dbDelete(modelName, query) {
  if (nativeDb && typeof modelName === "string") {
    await nativeDb.collection(modelName).deleteOne(query).catch(() => null);
    dbCache.del(ckey(modelName, query));
    return true;
  }
  const mongoose = await getMongoose();
  if (!mongoose || mongoose.connection.readyState !== 1) return false;
  const M = resolveModel(modelName, mongoose);
  if (!M) return false;
  await M.deleteOne(query).exec().catch(() => null);
  dbCache.del(ckey(modelName, query));
  return true;
}

function dbInvalidate(modelName, query) {
  try {
    if (!query) {
      const n =
        typeof modelName === "string"
          ? modelName
          : modelName?.modelName || "m";
      dbCache.invalidate(n + ":");
    } else dbCache.del(ckey(modelName, query));
  } catch {}
}

function boostModel(Model, ttl = 30000) {
  if (!Model || Model.__ultraV5) return Model;
  try {
    Object.defineProperty(Model, "__ultraV5", { value: true });
  } catch {}
  try {
    const origFindOne = Model.findOne.bind(Model);
    Model.findOneCached = function (q, t = ttl) {
      const key =
        "m:" +
        (Model.modelName || Model.collection?.collectionName || "x") +
        ":" +
        JSON.stringify(q);
      const hit = dbCache.get(key);
      if (hit) return Promise.resolve(hit);
      const stale = dbCache.getStale(key);
      if (stale) {
        setImmediate(() =>
          origFindOne(q)
            .lean()
            .exec()
            .then((d) => {
              if (d) dbCache.setStale(key, d, t);
            })
            .catch(() => {}),
        );
        return Promise.resolve(stale);
      }
      return origFindOne(q)
        .lean()
        .exec()
        .then((d) => {
          if (d) dbCache.setStale(key, d, t);
          return d;
        })
        .catch(() => null);
    };
    Model.invalidateCached = function (q) {
      try {
        dbCache.del(
          "m:" +
            (Model.modelName || Model.collection?.collectionName || "x") +
            ":" +
            JSON.stringify(q),
        );
      } catch {}
    };
  } catch {}
  return Model;
}

function cooldown(key, ms = 3000) {
  if (cdCache.has(key)) return false;
  cdCache.set(key, 1, ms);
  return true;
}

async function patchReplyDefaultsAsync() {
  if (global[SYM_PATCH]) return;
  global[SYM_PATCH] = true;
  try {
    const djs = await import("discord.js");
    const names = [
      "BaseInteraction",
      "CommandInteraction",
      "ChatInputCommandInteraction",
      "ContextMenuCommandInteraction",
      "ButtonInteraction",
      "StringSelectMenuInteraction",
      "ModalSubmitInteraction",
      "Message",
    ];
    for (const n of names) {
      try {
        const Cls = djs[n];
        if (!Cls?.prototype || Cls.prototype.__ultraV5) continue;
        Object.defineProperty(Cls.prototype, "__ultraV5", { value: true });
        for (const m of [
          "reply",
          "followUp",
          "editReply",
          "update",
          "deferReply",
          "deferUpdate",
        ]) {
          if (typeof Cls.prototype[m] !== "function") continue;
          const orig = Cls.prototype[m];
          Cls.prototype[m] = function (o, ...a) {
            try {
              if (typeof o === "string") o = { content: o };
              if (o && typeof o === "object" && !Array.isArray(o)) {
                if (m === "reply" && o.failIfNotExists === undefined)
                  o.failIfNotExists = false;
                if (!o.allowedMentions)
                  o.allowedMentions = { parse: [], repliedUser: false };
                if (m === "reply" && o.fetchReply === undefined)
                  o.fetchReply = false;
              }
            } catch {}
            return orig.call(this, o, ...a);
          };
        }
      } catch {}
    }
  } catch {}
}

function patchClientInternals(client) {
  try {
    client.setMaxListeners(0);
  } catch {}
  try {
    if (client.options) {
      client.options.failIfNotExists = false;
      if (
        !client.options.allowedMentions ||
        Object.keys(client.options.allowedMentions).length === 0
      )
        client.options.allowedMentions = { parse: [], repliedUser: false };
    }
  } catch {}
  try {
    if (client.rest?.options) {
      client.rest.options.timeout = client.rest.options.timeout || 8000;
      client.rest.options.retries = 2;
    }
  } catch {}
  void patchReplyDefaultsAsync();
}

function hookProcessOnce(opts = {}) {
  if (opts.skipProcessHooks) return;
  if (global[SYM]) return;
  global[SYM] = true;
  try {
    process.setMaxListeners(0);
  } catch {}
  // ROAR app.mjs kendi stop handler'larını kullanır; burada sadece sayaç
  if (opts.captureErrors) {
    process.on("unhandledRejection", (e) => {
      try {
        lastStats.errors++;
      } catch {}
      if (debugOn)
        try {
          console.error("[ultra-v5] unhandled:", e?.message || e);
        } catch {}
    });
    process.on("uncaughtException", (e) => {
      try {
        lastStats.errors++;
      } catch {}
      if (debugOn)
        try {
          console.error("[ultra-v5] uncaught:", e?.message || e);
        } catch {}
    });
  }
}

function startPrune() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    try {
      memCache.prune();
      dbCache.prune();
      cdCache.prune();
    } catch {}
  }, 120000);
  try {
    pruneTimer.unref();
  } catch {}
}

function startLagMonitor() {
  if (lagTimer) return;
  let last = Date.now();
  lagTimer = setInterval(() => {
    const now = Date.now();
    const drift = now - last - 1000;
    eventLoopLag = Math.max(0, Math.round(drift));
    last = now;
    if (eventLoopLag > 500) {
      try {
        memCache.prune();
        dbCache.prune();
      } catch {}
      if (debugOn) log("lag yuksek:", eventLoopLag + "ms");
    }
  }, 1000);
  try {
    lagTimer.unref();
  } catch {}
}

function startSweeper(client, opts = {}) {
  if (sweepTimer) return;
  const base = opts.interval || 60000;
  const keepVoice = opts.keepVoice !== false;
  sweepTimer = setInterval(() => {
    try {
      const guildCount = client.guilds?.cache?.size || 0;
      const memberCap = guildCount > 2000 ? 150 : 250;
      const userCap =
        guildCount > 2000 ? 3000 : opts.userLimit || 5000;
      const msgLimit = opts.msgLimit || 25;
      try {
        for (const [, g] of client.guilds.cache) {
          try {
            if (g.members?.cache?.size > memberCap + 50) {
              let n = 0;
              for (const [id] of [...g.members.cache]) {
                if (id === client.user?.id) continue;
                g.members.cache.delete(id);
                if (++n > 100 || g.members.cache.size <= memberCap) break;
              }
            }
          } catch {}
          try {
            if (g.presences?.cache?.size > 0) g.presences.cache.clear();
          } catch {}
          try {
            if (
              !keepVoice &&
              g.voiceStates?.cache?.size > 2000
            )
              g.voiceStates.cache.clear();
          } catch {}
        }
      } catch {}
      try {
        if (client.users?.cache?.size > userCap) {
          let n = 0;
          for (const [id] of [...client.users.cache]) {
            if (id === client.user?.id) continue;
            client.users.cache.delete(id);
            if (++n > 300 || client.users.cache.size <= userCap) break;
          }
        }
      } catch {}
      try {
        for (const [, c] of client.channels.cache) {
          try {
            if (c.messages?.cache?.size > msgLimit) {
              const arr = [...c.messages.cache.keys()];
              for (let i = 0; i < arr.length - msgLimit; i++)
                c.messages.cache.delete(arr[i]);
            }
            if (c.threads?.cache?.size > 20) c.threads.cache.clear();
          } catch {}
        }
      } catch {}
      try {
        if (global.gc && (eventLoopLag > 300 || Math.random() < 0.05))
          global.gc();
      } catch {}
    } catch {}
  }, base);
  try {
    sweepTimer.unref();
  } catch {}
}

function hookInteractions(client, opts = {}) {
  if (client.__ultraV5Hooked) return;
  Object.defineProperty(client, "__ultraV5Hooked", { value: true });
  try {
    client.on("interactionCreate", (i) => {
      try {
        i._ultraT0 = Date.now();
        lastStats.commands++;
        if (opts.slowDefer !== false && i.isChatInputCommand?.()) {
          const cmd =
            client.commands?.get?.(i.commandName) ||
            client.slashCommands?.get?.(i.commandName);
          if (cmd?.slow && !i.replied && !i.deferred)
            i.deferReply({ ephemeral: !!cmd.ephemeral }).catch(() => {});
        }
      } catch {}
    });
  } catch {}
}

function pingStats(input, client) {
  try {
    const now = Date.now();
    const created = input?.createdTimestamp || now;
    return {
      local: Math.max(0, now - created),
      api: Math.round(client?.ws?.ping ?? -1),
      lag: eventLoopLag,
    };
  } catch {
    return { local: 0, api: -1, lag: 0 };
  }
}

function fastHandler(client, fn, opts = {}) {
  const cd = opts.cooldownMs || 0;
  const cdKey = opts.cdKey || null;
  return async (...args) => {
    const i = args[0];
    try {
      if (cd && i?.user?.id) {
        const k = (cdKey || fn.name || "cmd") + ":" + i.user.id;
        if (!cooldown(k, cd)) {
          try {
            if (!i.replied && !i.deferred)
              await i
                .reply({ content: "Yavas ol.", ephemeral: true })
                .catch(() => {});
          } catch {}
          return;
        }
      }
      return await fn(...args);
    } catch (e) {
      try {
        lastStats.errors++;
      } catch {}
      try {
        if (i && !i.replied && !i.deferred && typeof i.reply === "function")
          await i
            .reply({ content: opts.errorMsg || "Hata.", ephemeral: true })
            .catch(() => {});
        else if (i?.followUp && typeof i.followUp === "function")
          await i
            .followUp({ content: opts.errorMsg || "Hata.", ephemeral: true })
            .catch(() => {});
      } catch {}
    }
  };
}

function buildStats(client) {
  return () => {
    try {
      const m = process.memoryUsage();
      return {
        v: 5,
        ws: Math.round(client?.ws?.ping ?? -1),
        guilds: client?.guilds?.cache?.size ?? 0,
        users: client?.users?.cache?.size ?? 0,
        ramMB: +(m.heapUsed / 1024 / 1024).toFixed(1),
        uptimeS: Math.floor(process.uptime()),
        lagMs: eventLoopLag,
        mongoReady,
        cache: memCache.stats(),
        dbCache: dbCache.stats(),
        commands: lastStats.commands,
        errors: lastStats.errors,
      };
    } catch {
      return {};
    }
  };
}

/** Rol bazlı Client options — statistics/manager ses cache'ini korur */
export function createClientOptions(extra = {}) {
  const role = extra.role || "";
  const needVoice = ["manager", "statistics"].includes(role);
  const needInvites = role === "statistics";
  const needPresence = role === "manager" && extra.presences;

  return {
    intents: extra.intents || [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
    partials: extra.partials || [Partials.GuildMember],
    makeCache: Options.cacheWithLimits({
      GuildMemberManager: {
        maxSize: needVoice ? 500 : 200,
        keepOverLimit: (m) => m.id === m.client.user?.id,
      },
      GuildBanManager: 0,
      GuildEmojiManager: 50,
      GuildInviteManager: needInvites ? 200 : 0,
      GuildStickerManager: 0,
      PresenceManager: needPresence ? 200 : 0,
      ThreadManager: 0,
      ThreadMemberManager: 0,
      VoiceStateManager: needVoice ? 500 : 0,
      MessageManager: { maxSize: 25 },
      UserManager: {
        maxSize: 5000,
        keepOverLimit: (m) => m.id === m.client.user?.id,
      },
      ...(extra.cache || {}),
    }),
    sweepers: {
      messages: { interval: 60, lifetime: 120 },
      users: {
        interval: 300,
        lifetime: 900,
        filter: () => (u) => u.id !== u.client?.user?.id,
      },
      ...(extra.sweepers || {}),
    },
    failIfNotExists: false,
    allowedMentions: { parse: [], repliedUser: false },
    rest: {
      timeout: 8000,
      retries: 2,
      globalRequestsPerSecond: 50,
      ...(extra.rest || {}),
    },
    ws: { large_threshold: 50, ...(extra.ws || {}) },
    presence: extra.presence || { status: "online" },
  };
}

export function createFastClient(extra = {}) {
  return new Client(createClientOptions(extra));
}

export function inject(client, mongoUrlOrOpts, maybeOpts) {
  if (!client) throw new Error("inject(client, mongoUrl) -> client gerekli");
  let url = "";
  let opts = {};
  if (typeof mongoUrlOrOpts === "string") {
    url = mongoUrlOrOpts;
    opts = maybeOpts || {};
  } else if (mongoUrlOrOpts && typeof mongoUrlOrOpts === "object") {
    opts = mongoUrlOrOpts;
    url =
      opts.mongoUrl ||
      opts.url ||
      process.env.MONGO_URL ||
      process.env.MONGODB_URI ||
      "";
  } else {
    url = process.env.MONGO_URL || process.env.MONGODB_URI || "";
  }
  debugOn = !!opts.debug;

  // ROAR kendi SIGINT/unhandledRejection yönetir
  hookProcessOnce({
    skipProcessHooks: opts.skipProcessHooks !== false,
    captureErrors: !!opts.captureErrors,
  });
  patchClientInternals(client);
  hookInteractions(client, opts);
  if (opts.disableSweeper !== true)
    startSweeper(client, {
      ...opts,
      keepVoice: opts.keepVoice !== false,
    });
  startPrune();
  startLagMonitor();

  if (!client.ultraCache) client.ultraCache = memCache;
  if (!client.dbCache) client.dbCache = dbCache;
  client.dbGet = dbGet;
  client.dbGetMany = dbGetMany;
  client.dbUpsert = dbUpsert;
  client.dbDelete = dbDelete;
  client.dbInvalidate = dbInvalidate;
  client.boostModel = boostModel;
  client.cooldown = cooldown;
  client.fastHandler = (fn, o) => fastHandler(client, fn, o);
  client.wrap = (fn, o) => fastHandler(client, fn, o);
  client.pingStats = (i) => pingStats(i, client);
  client.ultraStats = buildStats(client);
  client.afterReply = (interaction, fn) =>
    setImmediate(() => {
      try {
        fn();
      } catch (e) {
        if (debugOn) log("afterReply err", e?.message);
      }
    });
  client.ultra = {
    v: 5,
    memCache,
    dbCache,
    isReady: () => mongoReady,
    lag: () => eventLoopLag,
    bindNativeDb,
    markMongoReady,
  };

  if (opts.nativeDb) bindNativeDb(opts.nativeDb);

  // mongoose yoksa sessizce atla — ROAR native mongodb kullanır
  if (url && opts.useMongoose) {
    connectMongo(url, opts.mongoOpts || {}).catch(() => {});
  } else if (opts.nativeDb || opts.assumeMongoReady) {
    mongoReady = true;
    warmMongo();
  }

  if (Array.isArray(opts.autoBoostModels)) {
    for (const M of opts.autoBoostModels)
      try {
        boostModel(M, opts.modelTtl || 30000);
      } catch {}
  }
  log("inject ok");
  return client;
}

inject.inject = inject;
inject.injectHizlandirici = inject;
inject.connectMongo = connectMongo;
inject.dbGet = dbGet;
inject.dbGetMany = dbGetMany;
inject.dbUpsert = dbUpsert;
inject.dbDelete = dbDelete;
inject.dbInvalidate = dbInvalidate;
inject.boostModel = boostModel;
inject.cooldown = cooldown;
inject.fastHandler = fastHandler;
inject.pingStats = pingStats;
inject.UltraCache = UltraCache;
inject.memCache = memCache;
inject.dbCache = dbCache;
inject.isReady = () => mongoReady;
inject.lag = () => eventLoopLag;
inject.bindNativeDb = bindNativeDb;
inject.markMongoReady = markMongoReady;
inject.createFastClient = createFastClient;
inject.createClientOptions = createClientOptions;
inject.VERSION = 5;

export {
  UltraCache,
  memCache,
  dbCache,
  cdCache,
  connectMongo,
  dbGet,
  dbGetMany,
  dbUpsert,
  dbDelete,
  dbInvalidate,
  boostModel,
  cooldown,
  fastHandler,
  pingStats,
};
export default inject;
