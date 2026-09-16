import { attachCard } from "../core/cards.mjs";
import { install as pvp } from "./pvp.mjs";
import { install as shop } from "./shop.mjs";
import { embed, row, button, EPH } from "../core/ui.mjs";
import { id, amount, money, shuffled } from "../core/util.mjs";
import { authorize } from "../core/auth.mjs";
import { randomInt } from "node:crypto";
import { crashSample, crashOutcome } from "../core/social-games.mjs";
export async function install(ctx) {
  const { db, c, tx } = ctx,
    { move } = ctx.economy;
  await db
    .collection("crashGames")
    .createIndex(
      { guildId: 1, userId: 1 },
      { unique: true, partialFilterExpression: { status: "active" } },
    );
  async function crashView(g) {
    const o = crashOutcome(g, Date.now()),
      active = g.status === "active",
      p = embed(
        "ROAR Aviator",
        `${active ? o.multiplier.toFixed(2) + "×" : g.result}\nBahis: **${money(g.bet)}**\n${active ? "Patlamadan önce bozdur. Ekran yaklaşık 3 saniyede yenilenir; geçerli sonuç sunucu saatidir." : `Ödeme: **${money(g.payout || 0)}** (bahis dahil)`}`,
        active ? 0xa578d6 : g.payout ? 0x52dfa0 : 0xee6188,
      );
    p.components = [
      row({ ...button("e:crash:" + g._id, "Bozdur", 3), disabled: !active }),
    ];
    return attachCard(p, "aviator", {
      game: g,
      multiplier:
        g.status === "finished" && g.payout ? g.cashMultiplier : o.multiplier,
    });
  }
  async function updateCrash(g) {
    if (!g.messageId) return;
    const ch = await ctx.client.channels.fetch(g.channelId),
      m = await ch.messages.fetch(g.messageId);
    await m.edit(await crashView(g));
  }
  ctx.add(["aviator"], async (m, a) => {
    const bet = amount(a[0], c.maxBet),
      crash = crashSample(),
      startedAt = Date.now(),
      g = {
        _id: m.id,
        guildId: m.guildId,
        userId: m.author.id,
        channelId: m.channelId,
        bet,
        crash,
        startedAt,
        crashAt: startedAt + Math.ceil(Math.log(crash) * 8000),
        status: "active",
        messageId: null,
      };
    await tx(async (s) => {
      if (
        await db
          .collection("crashGames")
          .findOne(
            { guildId: m.guildId, userId: m.author.id, status: "active" },
            { session: s },
          )
      )
        throw Error("Aktif Aviator oyununuz var.");
      await move(m.author.id, -bet, "crash:" + m.id + ":bet", "aviator_bet", s);
      await db.collection("crashGames").insertOne(g, { session: s });
    });
    let sent;
    try {
      sent = await m.reply(await crashView(g));
      await db
        .collection("crashGames")
        .updateOne({ _id: g._id }, { $set: { messageId: sent.id } });
    } catch (e) {
      if (!sent)
        await tx(async (s) => {
          const cur = await db
            .collection("crashGames")
            .findOne({ _id: g._id, status: "active" }, { session: s });
          if (cur) {
            await move(
              cur.userId,
              cur.bet,
              "crash:" + g._id + ":refund",
              "send_refund",
              s,
            );
            await db
              .collection("crashGames")
              .updateOne(
                { _id: g._id },
                { $set: { status: "cancelled" } },
                { session: s },
              );
          }
        });
      throw e;
    }
  });
  ctx.onInteraction(async (i) => {
    await i.deferUpdate();
    const gid = i.customId.split(":")[2];
    await ctx.lock("crash:" + gid, async () => {
      const done = await tx(async (s) => {
        const g = await db
          .collection("crashGames")
          .findOne({ _id: gid, guildId: i.guildId }, { session: s });
        if (!g || g.userId !== i.user.id || g.channelId !== i.channelId)
          throw Error("Bu oyun size ait değil.");
        if (g.status !== "active") throw Error("Oyun bitti.");
        const o = crashOutcome(g, Date.now()),
          result = o.crashed
            ? "UÇAK PATLADI · " + g.crash.toFixed(2) + "×"
            : "BOZDURULDU · " + o.multiplier.toFixed(2) + "×";
        if (o.payout)
          await move(
            g.userId,
            o.payout,
            "crash:" + gid + ":payout",
            "aviator_payout",
            s,
          );
        await db
          .collection("crashGames")
          .updateOne(
            { _id: gid },
            {
              $set: {
                status: "finished",
                payout: o.payout,
                result,
                cashMultiplier: o.multiplier,
              },
            },
            { session: s },
          );
        return {
          ...g,
          status: "finished",
          payout: o.payout,
          result,
          cashMultiplier: o.multiplier,
        };
      });
      await i.editReply(await crashView(done));
    });
  }, "e:crash:");
  ctx.every(3000, async () => {
    for (const g of await db
      .collection("crashGames")
      .find({ guildId: c.guildId, status: "active" })
      .limit(100)
      .toArray())
      await ctx.lock("crash:" + g._id, async () => {
        let fresh = await db.collection("crashGames").findOne({ _id: g._id });
        if (fresh.status !== "active") return;
        if (Date.now() >= fresh.crashAt) {
          const updated = await db
            .collection("crashGames")
            .findOneAndUpdate(
              { _id: g._id, status: "active" },
              {
                $set: {
                  status: "finished",
                  payout: 0,
                  result: "UÇAK PATLADI · " + fresh.crash.toFixed(2) + "×",
                },
              },
              { returnDocument: "after", includeResultMetadata: false },
            );
          if (!updated) return;
          fresh = updated;
        }
        await updateCrash(fresh).catch((e) => ctx.report("Aviator ekranı", e));
      });
  });
  async function quizView(q) {
    const p = embed(
      "ROAR Botmatik",
      `**${q.a} + ${q.b} = ?**\nDoğru cevap ödülü: **${money(q.reward)} ROAR Parası**\nKişi başı bir deneme; ilk doğru cevap kazanır.\n${q.status === "open" ? `Bitiş: <t:${Math.floor(q.expiresAt / 1000)}:R>` : q.winner ? `Kazanan: <@${q.winner}>` : "Süre doldu."}`,
    );
    p.components = [
      row(
        ...q.answers.map((n, j) => ({
          ...button(`e:quiz:${q._id}:${j}`, String(n), 3),
          disabled: q.status !== "open",
        })),
      ),
    ];
    return attachCard(p, "quiz", { quiz: q });
  }
  ctx.add(["botmatik"], async (m) => {
    await authorize(ctx, m, null, true);
    const a = randomInt(10, 500),
      b = randomInt(10, 500),
      sum = a + b,
      nums = new Set([sum]);
    while (nums.size < 5) nums.add(randomInt(1, 1100));
    const values = [...nums],
      q = {
        _id: id(),
        guildId: m.guildId,
        channelId: m.channelId,
        a,
        b,
        answers: shuffled(5).map((i) => values[i]),
        reward: randomInt(100, 1001),
        status: "open",
        expiresAt: new Date(Date.now() + 30000),
      };
    await db.collection("quizzes").insertOne(q);
    const sent = await m.channel.send(await quizView(q));
    await db
      .collection("quizzes")
      .updateOne({ _id: q._id }, { $set: { messageId: sent.id } });
  });
  ctx.onInteraction(async (i) => {
    await i.deferReply({ flags: EPH });
    const [, , qid, index] = i.customId.split(":");
    let won = false;
    await tx(async (s) => {
      const q = await db
        .collection("quizzes")
        .findOne({ _id: qid, guildId: i.guildId }, { session: s });
      if (
        !q ||
        q.channelId !== i.channelId ||
        q.status !== "open" ||
        q.expiresAt < Date.now()
      )
        throw Error("Soru kapanmış.");
      if (!/^[0-4]$/.test(index)) throw Error("Geçersiz cevap.");
      const key = qid + ":" + i.user.id;
      if (
        await db.collection("quizTries").findOne({ _id: key }, { session: s })
      )
        throw Error("Bir deneme hakkınız vardı.");
      await db
        .collection("quizTries")
        .insertOne({ _id: key, at: new Date() }, { session: s });
      won = q.answers[Number(index)] === q.a + q.b;
      if (won) {
        await db
          .collection("quizzes")
          .updateOne(
            { _id: qid, status: "open" },
            { $set: { status: "closed", winner: i.user.id } },
            { session: s },
          );
        await move(
          i.user.id,
          q.reward,
          "quiz:" + qid + ":reward",
          "quiz_reward",
          s,
        );
      }
    });
    await i.editReply({
      content: won
        ? "Doğru! Ödül bakiyene eklendi."
        : "Yanlış cevap. Deneme hakkın bitti.",
    });
    if (won) {
      const q = await db.collection("quizzes").findOne({ _id: qid });
      await i.message.edit(await quizView(q));
    }
  }, "e:quiz:");
  ctx.every(5000, async () => {
    for (const q of await db
      .collection("quizzes")
      .find({
        guildId: c.guildId,
        status: "open",
        expiresAt: { $lte: new Date() },
      })
      .limit(100)
      .toArray()) {
      const n = await db
        .collection("quizzes")
        .findOneAndUpdate(
          { _id: q._id, status: "open" },
          { $set: { status: "closed" } },
          { returnDocument: "after", includeResultMetadata: false },
        );
      if (n?.messageId) {
        const ch = await ctx.client.channels
            .fetch(n.channelId)
            .catch(() => null),
          m = await ch?.messages?.fetch(n.messageId).catch(() => null);
        if (m) await m.edit(await quizView(n));
      }
    }
  });
  await pvp(ctx);
  await shop(ctx);
  await (await import("./wealth.mjs")).install(ctx);
}
