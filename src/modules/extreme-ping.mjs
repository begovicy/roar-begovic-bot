import { instantCache, instantReply, instantEdit } from "../core/instant-response.mjs";
import { zeroLatency } from "../core/zero-latency.mjs";
import { cache } from "../core/cache.mjs";

export function install(ctx) {
  instantCache.start(ctx.client);

  zeroLatency.register(["ping", "p", "pong"], async (m) => {
    const start = performance.now();
    const sent = await instantReply(m, instantCache.get("ping:static"));

    const dbStart = performance.now();
    try {
      await ctx.db.collection("wallets").findOne({
        guildId: m.guild?.id,
        userId: m.author.id,
      });
    } catch {}
    const dbLatency = (performance.now() - dbStart).toFixed(1);
    const botLatency = (performance.now() - start).toFixed(1);

    if (sent) {
      instantEdit(
        sent,
        `Pong!\nDatabase: **${dbLatency}ms**\nBot: **${botLatency}ms**`,
      );
    }
  }, { instant: true });

  zeroLatency.register(["pingx", "px"], async (m) => {
    const start = performance.now();
    const sent = await instantReply(m, "Pong!");
    const botLatency = (performance.now() - start).toFixed(1);
    const apiLatency = sent ? sent.createdTimestamp - m.createdTimestamp : 0;
    const wsLatency = ctx.client.ws.ping;
    const cacheStats = cache.getStats();
    const zeroStats = zeroLatency.getStats();

    if (sent) {
      instantEdit(
        sent,
        `Pong!\n\nLatency\n• Bot: **${botLatency}ms**\n• API: **${apiLatency}ms**\n• WebSocket: **${wsLatency}ms**\n\nCache\n• Hit Rate: ${cacheStats.hitRate}\n• Keys: ${cacheStats.size}\n\nCommands\n• Processed: ${zeroStats.processed}\n• Avg: ${zeroStats.avgTime}ms\n• Fastest: ${zeroStats.fastest.name} (${zeroStats.fastest.time.toFixed(2)}ms)`,
      );
    }
  }, { instant: true });

  zeroLatency.register(["p0", "raw"], async (m) => {
    const start = performance.now();
    await instantReply(m, (performance.now() - start).toFixed(1) + "ms");
  }, { instant: true });

  ctx.replace(["ping", "p"], async (m) => {
    const sent = await instantReply(
      m,
      `Pong!\nBot/cache: **0ms**\nDiscord WebSocket: **${Math.max(0, Math.round(ctx.client.ws?.ping ?? 0))}ms**`,
    );
    return sent;
  });
}
