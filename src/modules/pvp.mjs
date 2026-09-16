import { attachCard } from "../core/cards.mjs";
import { embed, row, button } from "../core/ui.mjs";
import { snowflake, amount, money, id } from "../core/util.mjs";
import { newDuel, duelStep, rps } from "../core/social-games.mjs";
export async function install(ctx) {
  const { db, c, tx } = ctx,
    { move } = ctx.economy;
  await db
    .collection("pvpGames")
    .createIndex(
      { guildId: 1, activePlayers: 1 },
      { unique: true, partialFilterExpression: { status: "active" } },
    );
  async function view(g) {
    const title = g.type === "tkm" ? "Taş Kâğıt Makas" : "Düello",
      p = embed(
        "ROAR · " + title,
        `<@${g.players[0]}> **VS** <@${g.players[1]}>\nKişi başı bahis: **${money(g.bet)}** · Pot: **${money(g.bet * 2)}**\n${g.status === "pending" ? "Karşı tarafın kabulü bekleniyor. Kabulde iki oyuncudan da bahis düşer." : g.status === "cancelled" ? "Davet iptal edildi; bahis alınmadı." : g.status === "finished" ? (g.winner === -1 ? "Berabere / iptal — bahisler iade edildi." : `Kazanan: <@${g.players[g.winner]}>`) : "Oyun sürüyor."}\nBitiş: <t:${Math.floor(g.expiresAt / 1000)}:R>`,
      );
    const bid = (a) => `e:pvp:${g._id}:${g.version}:${a}`;
    if (g.status === "pending")
      p.components = [
        row(
          button(bid("accept"), "Kabul Et", 3),
          button(bid("reject"), "Reddet", 4),
        ),
      ];
    else if (g.status === "active" && g.type === "tkm") {
      p.embeds[0].description += `\nSeçimler: ${g.choices[0] ? "hazir" : "bekliyor"} / ${g.choices[1] ? "hazir" : "bekliyor"}`;
      p.components = [
        row(
          button(bid("tas"), "Taş"),
          button(bid("kagit"), "Kâğıt"),
          button(bid("makas"), "Makas"),
        ),
      ];
    } else if (g.status === "active") {
      p.embeds[0].description += `\nHP: **${g.duel.hp[0]} / ${g.duel.hp[1]}**\nSıra: <@${g.players[g.duel.turn]}>`;
      p.components = [
        row(
          button(bid("attack"), "Saldır", 4),
          button(bid("heal"), "Savun & İyileş", 3),
          button(bid("quit"), "Savaştan Çekil"),
        ),
      ];
    } else {
      p.components = [];
      if (g.type === "tkm" && g.choices)
        p.embeds[0].description += `\nSeçimler: ${g.choices.map((x) => x || "—").join(" / ")}`;
    }
    const guild = ctx.client.guilds.cache.get(g.guildId);
    const names = await Promise.all(
      g.players.map(
        async (uid) =>
          (await guild.members.fetch(uid).catch(() => null))?.displayName ||
          "Ayrılan üye",
      ),
    );
    return attachCard(p, "pvp", { game: g, names });
  }
  async function settle(g, winner, s) {
    if (winner === -1) {
      for (let j = 0; j < 2; j++)
        await move(
          g.players[j],
          g.bet,
          `pvp:${g._id}:refund:${j}`,
          "pvp_refund",
          s,
        );
    } else
      await move(
        g.players[winner],
        g.bet * 2,
        `pvp:${g._id}:payout`,
        "pvp_payout",
        s,
      );
    g.status = "finished";
    g.winner = winner;
    g.activePlayers = [];
    g.version++;
    await db
      .collection("pvpGames")
      .updateOne(
        { _id: g._id },
        {
          $set: {
            status: g.status,
            winner,
            activePlayers: [],
            version: g.version,
            choices: g.choices || null,
            duel: g.duel || null,
          },
        },
        { session: s },
      );
    return g;
  }
  for (const type of ["tkm", "duello"])
    ctx.add([type], async (m, a) => {
      const uid = snowflake(a[0]),
        op = await m.guild.members.fetch(uid),
        bet = amount(a[1], c.maxBet);
      if (uid === m.author.id || op.user.bot)
        throw Error("Başka bir üye seçin.");
      const g = {
        _id: id(),
        guildId: m.guildId,
        channelId: m.channelId,
        players: [m.author.id, uid],
        activePlayers: [],
        type,
        bet,
        status: "pending",
        version: 0,
        expiresAt: new Date(Date.now() + 60000),
      };
      await db.collection("pvpGames").insertOne(g);
      const sent = await m.reply(await view(g));
      await db
        .collection("pvpGames")
        .updateOne({ _id: g._id }, { $set: { messageId: sent.id } });
    });
  ctx.onInteraction(async (i) => {
    await i.deferUpdate();
    const [, , gid, version, action] = i.customId.split(":");
    await ctx.lock("pvp:" + gid, async () => {
      const next = await tx(async (s) => {
        const g = await db
          .collection("pvpGames")
          .findOne({ _id: gid, guildId: i.guildId }, { session: s });
        if (!g || g.channelId !== i.channelId || !g.players.includes(i.user.id))
          throw Error("Bu oyunun oyuncusu değilsiniz.");
        if (
          g.expiresAt < Date.now() ||
          g.status === "finished" ||
          g.status === "cancelled"
        )
          throw Error("Oyun süresi doldu veya bitti.");
        const player = g.players.indexOf(i.user.id);
        if (g.status === "pending") {
          if (player !== 1) throw Error("Karşı tarafın yanıtı bekleniyor.");
          if (action === "reject") {
            g.status = "cancelled";
            g.winner = -1;
            await db
              .collection("pvpGames")
              .updateOne(
                { _id: gid },
                { $set: { status: "cancelled", winner: -1 } },
                { session: s },
              );
            return g;
          }
          if (action !== "accept") throw Error("Önce kabul edin.");
          for (let j = 0; j < 2; j++)
            await move(
              g.players[j],
              -g.bet,
              `pvp:${gid}:bet:${j}`,
              "pvp_bet",
              s,
            );
          g.status = "active";
          g.activePlayers = g.players;
          g.choices = [null, null];
          g.duel = g.type === "duello" ? newDuel() : null;
          g.version++;
          g.expiresAt = new Date(Date.now() + 60000);
          await db
            .collection("pvpGames")
            .updateOne(
              { _id: gid },
              {
                $set: {
                  status: g.status,
                  activePlayers: g.players,
                  choices: g.choices,
                  duel: g.duel,
                  version: g.version,
                  expiresAt: g.expiresAt,
                },
              },
              { session: s },
            );
          return g;
        }
        if (g.type === "tkm") {
          if (!["tas", "kagit", "makas"].includes(action) || g.choices[player])
            throw Error("Geçersiz seçim veya zaten seçtiniz.");
          g.choices[player] = action;
          if (g.choices.every(Boolean)) {
            const result = rps(...g.choices);
            return settle(g, result === 0 ? -1 : result - 1, s);
          }
          g.version++;
          await db
            .collection("pvpGames")
            .updateOne(
              { _id: gid },
              { $set: { choices: g.choices, version: g.version } },
              { session: s },
            );
          return g;
        }
        if (g.version !== Number(version)) throw Error("Eski oyun düğmesi.");
        g.duel = duelStep(g.duel, player, action);
        if (g.duel.winner !== null) return settle(g, g.duel.winner, s);
        g.version++;
        g.expiresAt = new Date(Date.now() + 60000);
        await db
          .collection("pvpGames")
          .updateOne(
            { _id: gid },
            {
              $set: {
                duel: g.duel,
                version: g.version,
                expiresAt: g.expiresAt,
              },
            },
            { session: s },
          );
        return g;
      });
      await i.editReply(await view(next));
    });
  }, "e:pvp:");
  ctx.every(10000, async () => {
    for (const old of await db
      .collection("pvpGames")
      .find({
        guildId: c.guildId,
        status: { $in: ["pending", "active"] },
        expiresAt: { $lte: new Date() },
      })
      .limit(100)
      .toArray())
      await ctx.lock("pvp:" + old._id, async () => {
        const done = await tx(async (s) => {
          const g = await db
            .collection("pvpGames")
            .findOne(
              {
                _id: old._id,
                status: { $in: ["pending", "active"] },
                expiresAt: { $lte: new Date() },
              },
              { session: s },
            );
          if (!g) return null;
          if (g.status === "pending") {
            g.status = "cancelled";
            g.winner = -1;
            await db
              .collection("pvpGames")
              .updateOne(
                { _id: g._id },
                { $set: { status: "cancelled", winner: -1 } },
                { session: s },
              );
            return g;
          }
          const winner =
            g.type === "duello"
              ? 1 - g.duel.turn
              : g.choices[0]
                ? 0
                : g.choices[1]
                  ? 1
                  : -1;
          return settle(g, winner, s);
        });
        if (done?.messageId) {
          const ch = await ctx.client.channels
              .fetch(done.channelId)
              .catch(() => null),
            m = await ch?.messages?.fetch(done.messageId).catch(() => null);
          if (m) await m.edit(await view(done));
        }
      });
  });
}
