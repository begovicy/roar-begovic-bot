// Gerçek zamanlı performans izleme

export class PerformanceMonitor {
  constructor() {
    this.metrics = {
      commands: new Map(),
      dbQueries: new Map(),
      apiCalls: new Map(),
      events: new Map()
    };
    this.startTime = Date.now();
  }

  // Komut performansı
  trackCommand(name, duration) {
    if (!this.metrics.commands.has(name)) {
      this.metrics.commands.set(name, { count: 0, total: 0, min: Infinity, max: 0 });
    }
    
    const stats = this.metrics.commands.get(name);
    stats.count++;
    stats.total += duration;
    stats.min = Math.min(stats.min, duration);
    stats.max = Math.max(stats.max, duration);
  }

  // DB sorgu performansı
  trackQuery(collection, duration) {
    if (!this.metrics.dbQueries.has(collection)) {
      this.metrics.dbQueries.set(collection, { count: 0, total: 0, min: Infinity, max: 0 });
    }
    
    const stats = this.metrics.dbQueries.get(collection);
    stats.count++;
    stats.total += duration;
    stats.min = Math.min(stats.min, duration);
    stats.max = Math.max(stats.max, duration);
  }

  // API çağrısı performansı
  trackAPI(endpoint, duration) {
    if (!this.metrics.apiCalls.has(endpoint)) {
      this.metrics.apiCalls.set(endpoint, { count: 0, total: 0, min: Infinity, max: 0 });
    }
    
    const stats = this.metrics.apiCalls.get(endpoint);
    stats.count++;
    stats.total += duration;
    stats.min = Math.min(stats.min, duration);
    stats.max = Math.max(stats.max, duration);
  }

  // Event performansı
  trackEvent(name, duration) {
    if (!this.metrics.events.has(name)) {
      this.metrics.events.set(name, { count: 0, total: 0, min: Infinity, max: 0 });
    }
    
    const stats = this.metrics.events.get(name);
    stats.count++;
    stats.total += duration;
    stats.min = Math.min(stats.min, duration);
    stats.max = Math.max(stats.max, duration);
  }

  // Rapor
  getReport() {
    const uptime = Date.now() - this.startTime;
    
    const formatStats = (map) => {
      const result = [];
      for (const [name, stats] of map) {
        const avg = stats.count > 0 ? (stats.total / stats.count).toFixed(2) : 0;
        result.push({
          name,
          count: stats.count,
          avg: `${avg}ms`,
          min: `${stats.min.toFixed(2)}ms`,
          max: `${stats.max.toFixed(2)}ms`
        });
      }
      return result.sort((a, b) => b.count - a.count).slice(0, 10);
    };

    return {
      uptime: `${(uptime / 1000 / 60).toFixed(2)} dakika`,
      commands: formatStats(this.metrics.commands),
      dbQueries: formatStats(this.metrics.dbQueries),
      apiCalls: formatStats(this.metrics.apiCalls),
      events: formatStats(this.metrics.events)
    };
  }

  // Sıfırla
  reset() {
    this.metrics.commands.clear();
    this.metrics.dbQueries.clear();
    this.metrics.apiCalls.clear();
    this.metrics.events.clear();
    this.startTime = Date.now();
  }
}

// Global monitor
export const monitor = new PerformanceMonitor();

// Utility: Async fonksiyon wrapper
export function tracked(type, name, fn) {
  return async (...args) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - start;
      
      switch (type) {
        case 'command': monitor.trackCommand(name, duration); break;
        case 'query': monitor.trackQuery(name, duration); break;
        case 'api': monitor.trackAPI(name, duration); break;
        case 'event': monitor.trackEvent(name, duration); break;
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      monitor.trackCommand(`${name}:error`, duration);
      throw error;
    }
  };
}
