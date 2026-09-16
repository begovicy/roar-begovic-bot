// EXTREME PERFORMANCE MODE
// Pre-computed responses, zero DB calls, instant reply

export class InstantResponseCache {
  constructor() {
    // Pre-computed responses (update every 5s)
    this.responses = new Map();
    this.wsLatency = 0;
    this.lastUpdate = 0;
    this.updateInterval = null;
  }

  // Start background updater
  start(client) {
    // Initial latency
    this.wsLatency = client.ws.ping;

    // Update every 5 seconds
    this.updateInterval = setInterval(() => {
      this.wsLatency = client.ws.ping;
      this.lastUpdate = Date.now();
    }, 5000);

    // Pre-compute common responses
    this.precompute();
  }

  // Pre-compute responses
  precompute() {
    // Ping response template (will be updated with actual values)
    this.responses.set('ping', {
      template: true,
      generate: (start, sent, m) => {
        const botLatency = Date.now() - start;
        const apiLatency = sent.createdTimestamp - m.createdTimestamp;
        return `Pong!\nBot: **${botLatency}ms**\nAPI: **${apiLatency}ms**\nWebSocket: **${this.wsLatency}ms**`;
      }
    });

    this.responses.set("ping:static", "Pong!");
  }

  get(key) {
    return this.responses.get(key);
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Global instance
export const instantCache = new InstantResponseCache();

// Ultra-fast reply (no await chains)
export function instantReply(message, content) {
  // Single promise, no await
  return message.reply(content).catch(() => null);
}

// Instant edit (for ping updates)
export function instantEdit(message, content) {
  return message.edit(content).catch(() => null);
}
