// Ultra-fast in-memory cache layer
// Agresif cache stratejisi ile MongoDB sorgularını bypass eder

class CacheLayer {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0 };
  }

  // Çok hızlı key oluşturma
  _key(collection, query) {
    return `${collection}:${JSON.stringify(query)}`;
  }

  // Cache'den oku
  get(collection, query) {
    const key = this._key(collection, query);
    const ttl = this.ttl.get(key);
    
    // TTL kontrolü
    if (ttl && Date.now() > ttl) {
      this.cache.delete(key);
      this.ttl.delete(key);
      this.stats.misses++;
      return null;
    }

    if (this.cache.has(key)) {
      this.stats.hits++;
      return this.cache.get(key);
    }

    this.stats.misses++;
    return null;
  }

  // Cache'e yaz
  set(collection, query, value, ttlMs = 30000) {
    const key = this._key(collection, query);
    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + ttlMs);
    this.stats.sets++;

    // Otomatik cleanup (1000 kayıt üstü)
    if (this.cache.size > 1000) {
      this._cleanup();
    }
  }

  // Belirli key'i invalidate et
  invalidate(collection, query = null) {
    if (!query) {
      // Tüm collection'ı temizle
      for (const [key] of this.cache) {
        if (key.startsWith(`${collection}:`)) {
          this.cache.delete(key);
          this.ttl.delete(key);
        }
      }
      return;
    }

    const key = this._key(collection, query);
    this.cache.delete(key);
    this.ttl.delete(key);
  }

  // Expired kayıtları temizle
  _cleanup() {
    const now = Date.now();
    for (const [key, ttl] of this.ttl) {
      if (now > ttl) {
        this.cache.delete(key);
        this.ttl.delete(key);
      }
    }
  }

  // İstatistikler
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: `${hitRate}%`
    };
  }

  // Tüm cache'i temizle
  clear() {
    this.cache.clear();
    this.ttl.clear();
    this.stats = { hits: 0, misses: 0, sets: 0 };
  }
}

// Global cache instance
export const cache = new CacheLayer();

// Cached DB wrapper
export function withCache(db) {
  // MongoDB Db interface'ini taklit et
  return {
    // collection() metodu - MongoDB uyumlu
    collection(name) {
      const rawCollection = db.collection(name);
      
      // Cached collection wrapper
      return {
        async findOne(query, options) {
          // Cache kontrolü
          const cached = cache.get(name, query);
          if (cached !== null) return cached;

          // DB'den çek
          const result = await rawCollection.findOne(query, options);
          
          // Cache'e kaydet
          if (result) cache.set(name, query, result);
          
          return result;
        },

        find(query, options) {
          // Find cursor döndür
          return rawCollection.find(query, options);
        },

        async findOneAndUpdate(filter, update, options) {
          // Update işlemi
          const result = await rawCollection.findOneAndUpdate(filter, update, options);
          cache.invalidate(name, filter);
          return result;
        },

        async updateOne(filter, update, options) {
          // Update sonrası cache invalidate
          const result = await rawCollection.updateOne(filter, update, options);
          cache.invalidate(name, filter);
          return result;
        },

        async updateMany(filter, update, options) {
          const result = await rawCollection.updateMany(filter, update, options);
          cache.invalidate(name);
          return result;
        },

        async insertOne(doc, options) {
          const result = await rawCollection.insertOne(doc, options);
          cache.invalidate(name);
          return result;
        },

        async insertMany(docs, options) {
          const result = await rawCollection.insertMany(docs, options);
          cache.invalidate(name);
          return result;
        },

        async deleteOne(filter, options) {
          const result = await rawCollection.deleteOne(filter, options);
          cache.invalidate(name, filter);
          return result;
        },

        async findOneAndDelete(filter, options) {
          const result = await rawCollection.findOneAndDelete(filter, options);
          cache.invalidate(name, filter);
          return result;
        },

        async deleteMany(filter, options) {
          const result = await rawCollection.deleteMany(filter, options);
          cache.invalidate(name);
          return result;
        },

        async countDocuments(filter, options) {
          return await rawCollection.countDocuments(filter, options);
        },

        async createIndex(keys, options) {
          return await rawCollection.createIndex(keys, options);
        },

        // Tüm diğer MongoDB collection metodlarını proxy et
        ...rawCollection
      };
    },

    command(...args) {
      return db.command(...args);
    },

    // Raw DB access (bypass cache)
    raw: db
  };
}

// Stale-while-revalidate cache
export function getStale(key) {
  if (cache.cache.has(key)) {
    return cache.cache.get(key);
  }
  return null;
}

export function setStale(key, value, ttlMs = 30000) {
  cache.cache.set(key, value);
  cache.ttl.set(key, Date.now() + ttlMs);
}

// ⚡ 0MS: dbGetCached (stale-while-revalidate DB query)
export async function dbGetCached(db, collectionName, query, ttl = 30000) {
  const key = `${collectionName}:${JSON.stringify(query)}`;
  
  // Önce cache'e bak
  let cached = getStale(key);
  if (cached) {
    // Arka planda güncelle (async, bloklama yok)
    setImmediate(async () => {
      try {
        const fresh = await db.collection(collectionName).findOne(query);
        if (fresh) setStale(key, fresh, ttl);
      } catch {}
    });
    return cached; // 0ms return! ⚡
  }
  
  // Cache'de yoksa DB'den çek
  try {
    const result = await db.collection(collectionName).findOne(query);
    if (result) setStale(key, result, ttl);
    return result;
  } catch {
    return null;
  }
}

// ⚡ 0MS: Preload (sık kullanılan data'yı önceden yükle)
export async function preloadCommonData(db, guildId) {
  if (!guildId) return;
  
  const collections = [
    { name: 'settings', query: { guildId }, limit: 10 },
    { name: 'config', query: { guildId }, limit: 5 },
    { name: 'roles', query: { guildId }, limit: 50 },
    { name: 'wallets', query: { guildId }, limit: 100 }
  ];
  
  for (const { name, query, limit } of collections) {
    try {
      const docs = await db.collection(name).find(query).limit(limit).toArray();
      for (const doc of docs) {
        const key = `${name}:${JSON.stringify({ _id: doc._id })}`;
        setStale(key, doc, 300000); // 5 dakika TTL
      }
    } catch {}
  }
}
