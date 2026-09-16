// Ultra-fast event handling with debouncing and batching

export class FastEventHandler {
  constructor() {
    this.handlers = new Map();
    this.debounceTimers = new Map();
    this.batches = new Map();
    this.stats = { processed: 0, debounced: 0, batched: 0 };
  }

  // Hızlı event registration
  on(event, handler, options = {}) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push({ handler, options });
  }

  // Debounced event (aynı event çok sık gelirse son biri işlenir)
  debounce(event, handler, delayMs = 100) {
    this.on(event, handler, { debounce: delayMs });
  }

  // Batched event (birden fazla eventi topla, sonra hepsini işle)
  batch(event, handler, options = {}) {
    const { maxSize = 10, maxWait = 100 } = options;
    this.on(event, handler, { batch: true, maxSize, maxWait });
  }

  // Event'i işle
  async emit(event, ...args) {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    this.stats.processed++;

    for (const { handler, options } of handlers) {
      // Debounce kontrolü
      if (options.debounce) {
        const key = `${event}:${args[0]?.id || ''}`;
        
        if (this.debounceTimers.has(key)) {
          clearTimeout(this.debounceTimers.get(key));
          this.stats.debounced++;
        }

        const timer = setTimeout(() => {
          this.debounceTimers.delete(key);
          handler(...args).catch(console.error);
        }, options.debounce);

        this.debounceTimers.set(key, timer);
        continue;
      }

      // Batch kontrolü
      if (options.batch) {
        const key = event;
        
        if (!this.batches.has(key)) {
          this.batches.set(key, {
            items: [],
            timer: null,
            handler,
            options
          });
        }

        const batch = this.batches.get(key);
        batch.items.push(args);
        this.stats.batched++;

        // Max size kontrolü
        if (batch.items.length >= options.maxSize) {
          this._flushBatch(key);
          continue;
        }

        // Timer başlat
        if (!batch.timer) {
          batch.timer = setTimeout(() => {
            this._flushBatch(key);
          }, options.maxWait);
        }
        continue;
      }

      // Normal handler
      handler(...args).catch(console.error);
    }
  }

  // Batch'i işle
  _flushBatch(key) {
    const batch = this.batches.get(key);
    if (!batch || batch.items.length === 0) return;

    const items = batch.items.splice(0);
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    batch.handler(items).catch(console.error);
  }

  // İstatistikler
  getStats() {
    return {
      ...this.stats,
      handlers: this.handlers.size,
      activeBatches: this.batches.size,
      debounceTimers: this.debounceTimers.size
    };
  }

  // Cleanup
  destroy() {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    for (const batch of this.batches.values()) {
      if (batch.timer) clearTimeout(batch.timer);
    }
    this.handlers.clear();
    this.debounceTimers.clear();
    this.batches.clear();
  }
}

// Global instance
export const fastEvents = new FastEventHandler();
