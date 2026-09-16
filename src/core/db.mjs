import { MongoClient } from "mongodb";
import { memoryDB } from "./memory-db.mjs";
import { withCache } from "./cache.mjs";

export async function connect(c) {
  let client;
  const hasMongoUri = Boolean(c?.uri);
  try {
    client = new MongoClient(c.uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 5000,
      maxPoolSize: 50,
      minPoolSize: 10,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true,
      w: "majority",
      readPreference: "primaryPreferred",
      compressors: ["zlib"],
      zlibCompressionLevel: 6,
    });
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MongoDB timeout")), 3000)
      ),
    ]);
  } catch (error) {
    if (hasMongoUri && (process.env.NODE_ENV === "production" || process.env.PRODUCTION === "true")) {
      console.error("[mongo] Production mode requires a valid MongoDB URL.");
      console.error("[mongo] URL from MONGODB_URI / MONGO_URL / MONGODB_URL was rejected.");
      throw error;
    }
    console.log("[bypass] MongoDB bağlantısı başarısız, in-memory moda geçiliyor...");
    return memoryDB();
  }
  const db = client.db(c.dbName);
  
  // Gelişmiş indexler - compound indexes önce
  const indexes = {
    wallets: [
      [{ guildId: 1, userId: 1 }, { unique: true, background: true }]
    ],
    ledger: [
      [{ guildId: 1, userId: 1, at: -1 }, { background: true }],
      [{ userId: 1, at: -1 }, { background: true }]  // User-specific queries
    ],
    games: [
      [{ guildId: 1, status: 1, expiresAt: 1 }, { background: true }],
      [{ userId: 1, status: 1 }, { background: true }],  // User games
      [{ expiresAt: 1 }, { background: true }]  // Cleanup queries
    ],
    stats: [
      [{ guildId: 1, userId: 1, channelId: 1, day: 1 }, { unique: true, background: true }],
      [{ guildId: 1, userId: 1, day: -1 }, { background: true }],  // User stats over time
      [{ guildId: 1, day: -1 }, { background: true }]  // Guild daily stats
    ],
    rooms: [
      [{ guildId: 1, ownerId: 1 }, { unique: true, background: true }],
      [{ guildId: 1, channelId: 1 }, { sparse: true, background: true }]  // Channel lookup
    ],
    afk: [
      [{ guildId: 1, userId: 1 }, { unique: true, background: true }]
    ],
    cases: [
      [{ guildId: 1, at: -1 }, { background: true }],
      [{ guildId: 1, userId: 1, at: -1 }, { background: true }],  // User cases
      [{ guildId: 1, type: 1, at: -1 }, { background: true }]  // Case type filtering
    ],
    sessions: [
      [{ expiresAt: 1 }, { expireAfterSeconds: 0, background: true }]
    ],
    audit: [
      [{ expiresAt: 1 }, { expireAfterSeconds: 0, background: true }],
      [{ guildId: 1, action: 1, at: -1 }, { background: true }]  // Audit log queries
    ],
    // Ek performance collections
    commandBans: [
      [{ guildId: 1, userId: 1 }, { unique: true, background: true }]
    ],
    customCommands: [
      [{ guildId: 1, name: 1 }, { unique: true, background: true }]
    ],
    leases: [
      [{ _id: 1, until: 1 }, { background: true }]
    ]
  };
  
  // Index'leri paralel oluştur (hızlı)
  await Promise.all(
    Object.entries(indexes).map(async ([name, list]) => {
      try {
        await Promise.all(
          list.map(([keys, opts]) => 
            db.collection(name).createIndex(keys, opts)
          )
        );
      } catch (e) {
        // Index zaten varsa hata verme
        if (e.code !== 85 && e.code !== 86) throw e;
      }
    })
  );

  // Cache layer ile wrap et
  const cachedDb = withCache(db);
  
  // ⚡ 0MS CACHE: Preload common data
  const guildId = process.env.GUILD_ID;
  if (guildId) {
    // İlk yüklemede preload yap
    (async () => {
      try {
        const { preloadCommonData } = await import('./cache.mjs');
        await preloadCommonData(db, guildId);
        console.log('[0ms-cache] Preload tamamlandı ✓');
      } catch (e) {
        console.log('[0ms-cache] Preload hatası:', e.message);
      }
    })();
    
    // Her 60 saniyede bir yenile
    setInterval(async () => {
      try {
        const { preloadCommonData } = await import('./cache.mjs');
        await preloadCommonData(db, guildId);
      } catch {}
    }, 60000);
  }
  
  return {
    db: cachedDb,
    client,
    tx: async (fn) => {
      const s = client.startSession();
      try {
        return await s.withTransaction(() => fn(s));
      } finally {
        await s.endSession();
      }
    },
  };
}
