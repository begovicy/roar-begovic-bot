// MEMORY-ONLY MODE
// Complete MongoDB bypass for ultra-low latency
// All data in RAM, periodic sync to DB

export class MemoryOnlyDB {
  constructor(realDb) {
    this.realDb = realDb;
    this.memory = {
      wallets: new Map(),
      stats: new Map(),
      games: new Map(),
      cases: new Map(),
      rooms: new Map(),
      afk: new Map(),
      customCommands: new Map()
    };
    
    this.dirty = new Set(); // Collections needing sync
    this.syncInterval = null;
    this.stats = {
      reads: 0,
      writes: 0,
      syncs: 0,
      avgReadTime: 0,
      avgWriteTime: 0
    };
  }

  // Initialize: Load hot data into memory
  async init() {
    const start = Date.now();
    
    // Load frequently accessed data
    try {
      // Wallets (top 1000 users)
      const wallets = await this.realDb.raw
        .collection('wallets')
        .find({})
        .limit(1000)
        .toArray();
      
      for (const wallet of wallets) {
        const key = `${wallet.guildId}:${wallet.userId}`;
        this.memory.wallets.set(key, wallet);
      }

      // Active games
      const games = await this.realDb.raw
        .collection('games')
        .find({ status: 'active' })
        .limit(100)
        .toArray();
      
      for (const game of games) {
        this.memory.games.set(game._id.toString(), game);
      }

      // Rooms
      const rooms = await this.realDb.raw
        .collection('rooms')
        .find({})
        .limit(500)
        .toArray();
      
      for (const room of rooms) {
        const key = `${room.guildId}:${room.ownerId}`;
        this.memory.rooms.set(key, room);
      }

      console.log(`[memory-only] Loaded ${this.memory.wallets.size} wallets, ${this.memory.games.size} games, ${this.memory.rooms.size} rooms in ${Date.now() - start}ms`);
    } catch (error) {
      console.error('[memory-only] Init failed:', error.message);
    }

    // Start background sync (every 10 seconds)
    this.syncInterval = setInterval(() => this.sync(), 10000);
  }

  // Read from memory (0.01ms)
  async findOne(collection, query) {
    const start = performance.now();
    this.stats.reads++;

    let key;
    let result = null;

    switch (collection) {
      case 'wallets':
        key = `${query.guildId}:${query.userId}`;
        result = this.memory.wallets.get(key);
        break;
      
      case 'games':
        if (query._id) {
          result = this.memory.games.get(query._id.toString());
        } else {
          // Linear search (fast for small datasets)
          for (const game of this.memory.games.values()) {
            if (Object.entries(query).every(([k, v]) => game[k] === v)) {
              result = game;
              break;
            }
          }
        }
        break;
      
      case 'rooms':
        key = `${query.guildId}:${query.ownerId}`;
        result = this.memory.rooms.get(key);
        break;
      
      default:
        // Fallback to real DB
        result = await this.realDb.findOne(collection, query);
    }

    const time = performance.now() - start;
    this.stats.avgReadTime = (this.stats.avgReadTime * (this.stats.reads - 1) + time) / this.stats.reads;

    return result;
  }

  // Write to memory (instant) + mark dirty
  async updateOne(collection, filter, update, options = {}) {
    const start = performance.now();
    this.stats.writes++;

    // Update in memory
    const existing = await this.findOne(collection, filter);
    
    if (existing) {
      // Apply update
      const updated = { ...existing };
      if (update.$set) Object.assign(updated, update.$set);
      if (update.$inc) {
        for (const [key, value] of Object.entries(update.$inc)) {
          updated[key] = (updated[key] || 0) + value;
        }
      }

      // Update memory
      let key;
      switch (collection) {
        case 'wallets':
          key = `${filter.guildId}:${filter.userId}`;
          this.memory.wallets.set(key, updated);
          break;
        case 'games':
          key = filter._id?.toString();
          if (key) this.memory.games.set(key, updated);
          break;
        case 'rooms':
          key = `${filter.guildId}:${filter.ownerId}`;
          this.memory.rooms.set(key, updated);
          break;
      }

      // Mark dirty for sync
      this.dirty.add(collection);
    } else if (options.upsert) {
      // Insert new
      const doc = { ...filter, ...(update.$set || {}) };
      
      let key;
      switch (collection) {
        case 'wallets':
          key = `${filter.guildId}:${filter.userId}`;
          this.memory.wallets.set(key, doc);
          break;
        case 'games':
          key = doc._id?.toString();
          if (key) this.memory.games.set(key, doc);
          break;
        case 'rooms':
          key = `${filter.guildId}:${filter.ownerId}`;
          this.memory.rooms.set(key, doc);
          break;
      }

      this.dirty.add(collection);
    }

    const time = performance.now() - start;
    this.stats.avgWriteTime = (this.stats.avgWriteTime * (this.stats.writes - 1) + time) / this.stats.writes;

    return { matchedCount: existing ? 1 : 0, modifiedCount: 1 };
  }

  // Background sync to MongoDB
  async sync() {
    if (this.dirty.size === 0) return;

    const collections = Array.from(this.dirty);
    this.dirty.clear();
    this.stats.syncs++;

    console.log(`[memory-only] Syncing ${collections.length} collections...`);

    for (const collection of collections) {
      try {
        const map = this.memory[collection];
        if (!map) continue;

        // Batch upsert (fast)
        const operations = Array.from(map.values()).map(doc => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: doc },
            upsert: true
          }
        }));

        if (operations.length > 0) {
          await this.realDb.raw
            .collection(collection)
            .bulkWrite(operations, { ordered: false });
        }
      } catch (error) {
        console.error(`[memory-only] Sync failed for ${collection}:`, error.message);
        // Re-mark dirty
        this.dirty.add(collection);
      }
    }
  }

  // Force sync (before shutdown)
  async forceSync() {
    await this.sync();
  }

  // Stats
  getStats() {
    return {
      ...this.stats,
      memorySize: {
        wallets: this.memory.wallets.size,
        games: this.memory.games.size,
        rooms: this.memory.rooms.size
      },
      dirtyCollections: Array.from(this.dirty)
    };
  }

  // Cleanup
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    this.forceSync();
  }
}
