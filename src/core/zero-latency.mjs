// ZERO LATENCY COMMAND SYSTEM
// Direct message handling, no middleware, instant response

export class ZeroLatencyHandler {
  constructor() {
    // Command map (direct function pointers)
    this.commands = new Map();
    this.aliases = new Map();
    
    // Stats
    this.stats = {
      processed: 0,
      totalTime: 0,
      fastestCommand: { name: null, time: Infinity },
      avgTime: 0
    };
  }

  // Register instant command
  register(names, handler, options = {}) {
    const instantHandler = options.instant !== false; // Default: instant
    
    for (const name of names) {
      this.commands.set(name, {
        handler,
        instant: instantHandler,
        stats: { count: 0, totalTime: 0 }
      });
    }
  }

  // Handle message (FASTEST PATH)
  async handle(message, prefix) {
    // Fastest string operations
    const content = message.content;
    if (!content.startsWith(prefix)) return false;

    const start = performance.now();
    
    // Parse command (single pass)
    const withoutPrefix = content.slice(prefix.length);
    const spaceIndex = withoutPrefix.indexOf(' ');
    const commandName = spaceIndex === -1 
      ? withoutPrefix.toLowerCase()
      : withoutPrefix.slice(0, spaceIndex).toLowerCase();
    
    const cmd = this.commands.get(commandName);
    if (!cmd) return false;

    // Execute (no try-catch for speed, errors bubble up)
    const args = spaceIndex === -1 
      ? []
      : withoutPrefix.slice(spaceIndex + 1).split(/\s+/);
    
    await cmd.handler(message, args);

    // Track stats (async, don't block)
    const time = performance.now() - start;
    this._trackStats(commandName, time);

    return true;
  }

  // Track stats (non-blocking)
  _trackStats(name, time) {
    setImmediate(() => {
      this.stats.processed++;
      this.stats.totalTime += time;
      this.stats.avgTime = this.stats.totalTime / this.stats.processed;

      const cmd = this.commands.get(name);
      if (cmd) {
        cmd.stats.count++;
        cmd.stats.totalTime += time;
      }

      if (time < this.stats.fastestCommand.time) {
        this.stats.fastestCommand = { name, time };
      }
    });
  }

  getStats() {
    const topCommands = Array.from(this.commands.entries())
      .filter(([_, cmd]) => cmd.stats.count > 0)
      .map(([name, cmd]) => ({
        name,
        count: cmd.stats.count,
        avg: (cmd.stats.totalTime / cmd.stats.count).toFixed(2)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      processed: this.stats.processed,
      avgTime: this.stats.avgTime.toFixed(2),
      fastest: this.stats.fastestCommand,
      topCommands
    };
  }
}

// Global handler
export const zeroLatency = new ZeroLatencyHandler();
