import { cache } from "../core/cache.mjs";
import { monitor } from "../core/performance.mjs";

export function install(ctx) {
  ctx.replace(["ping", "p"], async (m) => {
    const start = Date.now();
    const sent = await m.reply("Pong!");

    const dbStart = Date.now();
    try {
      await ctx.db.collection("wallets").findOne({
        guildId: m.guild?.id,
        userId: m.author.id,
      });
    } catch {}
    const dbLatency = Date.now() - dbStart;
    const botLatency = Date.now() - start;
    const cacheStats = cache.getStats();
    const cacheInfo =
      cacheStats.hitRate !== "0.00%"
        ? `\nCache: ${cacheStats.hitRate} hit rate`
        : "";

    await sent.edit(
      `Pong!\nDatabase: **${dbLatency}ms**\nBot: **${botLatency}ms**` +
        cacheInfo,
    );

    monitor.trackCommand("ping", Date.now() - start);
  });

  ctx.add(["cache", "cachestats"], async (m) => {
    if (!ctx.c.owners.includes(m.author.id)) return;

    const stats = cache.getStats();
    const perfReport = monitor.getReport();

    await m.reply(
      `Cache istatistikleri\n\nCache\n• Hit Rate: ${stats.hitRate}\n• Keys: ${stats.size}\n• Hits: ${stats.hits}\n• Misses: ${stats.misses}\n• Sets: ${stats.sets}\n\nPerformance\n• Uptime: ${perfReport.uptime}\n• Top Commands:\n${perfReport.commands
        .slice(0, 5)
        .map((c) => `  ${c.name}: ${c.avg} avg (${c.count}x)`)
        .join("\n")}`,
    );
  });

  ctx.add(["clearcache"], async (m) => {
    if (!ctx.c.owners.includes(m.author.id)) return;

    const oldStats = cache.getStats();
    cache.clear();
    monitor.reset();

    await m.reply(
      `Cache temizlendi\n• ${oldStats.size} key silindi\n• Hit rate: ${oldStats.hitRate}\n• Performance istatistikleri sıfırlandı`,
    );
  });
}
