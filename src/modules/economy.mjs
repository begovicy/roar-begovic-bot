import { attachCard } from "../core/cards.mjs";
import { embed, row, button, session, readSession, EPH } from "../core/ui.mjs";
import { amount, snowflake, day, money } from "../core/util.mjs";
import { authorize } from "../core/auth.mjs";
import {
  createGame,
  advance,
  expireGame,
  mineMultiplier,
  score,
  cardLabel,
} from "../core/games.mjs";
export async function install(ctx) {
  const { db, c, tx } = ctx,
    h = await db.command({ hello: 1 });
  if (!h.setName && h.msg !== "isdbgrid")
    throw Error("MongoDB replica set veya Atlas gerekli.");
  await db
    .collection("games")
    .createIndex(
      { guildId: 1, userId: 1 },
      { unique: true, partialFilterExpression: { status: "active" } },
    );
  async function wallet(uid, s) {
    await db
      .collection("wallets")
      .updateOne(
        { guildId: c.guildId, userId: uid },
        { $setOnInsert: { balance: 0, lastDaily: null } },
        { session: s, upsert: true },
      );
    return db
      .collection("wallets")
      .findOne({ guildId: c.guildId, userId: uid }, { session: s });
  }
  async function move(uid, n, key, type, s) {
    if (!Number.isSafeInteger(n) || n === 0)
      throw Error("Geçersiz bakiye hareketi.");
    await wallet(uid, s);
    const w = await db.collection("wallets").findOneAndUpdate(
      {
        guildId: c.guildId,
        userId: uid,
        balance: n < 0 ? { $gte: -n } : { $lte: 1e12 - n },
      },
      { $inc: { balance: n } },
      { session: s, returnDocument: "after", includeResultMetadata: false },
    );
    if (!w) throw Error(n < 0 ? "Yetersiz bakiye." : "Bakiye sınırı aşıldı.");
    await db.collection("ledger").insertOne(
      {
        _id: key,
        guildId: c.guildId,
        userId: uid,
        delta: n,
        type,
        at: new Date(),
      },
      { session: s },
    );
    return w;
  }
  async function daily(uid) {
    return tx(async (s) => {
      const w = await wallet(uid, s),
        today = day(Date.now());
      if (w.lastDaily === today) return { already: true, balance: w.balance };
      const n = await move(
        uid,
        c.dailyReward,
        `daily:${c.guildId}:${uid}:${today}`,
        "daily",
        s,
      );
      await db
        .collection("wallets")
        .updateOne(
          { _id: w._id },
          { $set: { lastDaily: today } },
          { session: s },
        );
      return { already: false, balance: n.balance };
    });
  }
  ctx.economy = { wallet, move, daily };
  ctx.add(["coin", "bakiye"], async (m) => {
    const w = await wallet(m.author.id),
      t = await session(ctx, "wallet", m.author.id, m.channelId, {}, 600);
    const p = embed(
      "ROAR Bank",
      `<@${m.author.id}> · **${money(w.balance)} ROAR Parası** · **${w.gold || 0} G**\nYalnız sanal para; gerçek paraya çevrilemez.`,
    );
    p.components = [
      row(
        button(`e:hub:${t}:shop`, "Mağaza"),
        button(`e:hub:${t}:purchases`, "Satın Aldıklarım"),
        button(`e:hub:${t}:gold`, "Döviz İşlemleri"),
        button(`e:${t}:history`, "Transferlerim"),
        button(`e:${t}:daily`, "Günlük Al", 3),
      ),
    ];
    await m.reply(
      await attachCard(p, "bank", {
        name: m.member.displayName,
        balance: w.balance,
        gold: w.gold || 0,
      }),
    );
  });
  ctx.add(["günlük", "gunluk", "daily"], async (m) => {
    const r = await daily(m.author.id);
    await m.reply(
      embed(
        "Günlük ödül",
        `${r.already ? "Bugünün ödülü zaten alınmış." : "Ödül eklendi."}\nBakiye: ${money(r.balance)}\nYenilenme: Türkiye saatiyle 00.00.`,
      ),
    );
  });
  ctx.add(["addbalance"], async (m, a) => {
    await authorize(ctx, m, null, true);
    if (a[0] !== "para") throw Error(".addbalance para @üye miktar");
    const uid = snowflake(a[1]),
      n = amount(a[2]);
    await m.guild.members.fetch(uid);
    await tx(async (s) => {
      if (
        !(await db.collection("ledger").findOne({ _id: m.id }, { session: s }))
      )
        await move(uid, n, m.id, "owner_grant", s);
    });
    await m.reply(embed("Bakiye eklendi", `<@${uid}> · ${money(n)}`));
  });
  ctx.add(["transfer", "gönder"], async (m, a) => {
    const uid = snowflake(a[0]),
      t = await m.guild.members.fetch(uid),
      n = amount(a[1]);
    if (uid === m.author.id || t.user.bot) throw Error("Başka bir üye seçin.");
    await tx(async (s) => {
      if (
        await db
          .collection("ledger")
          .findOne({ _id: m.id + ":out" }, { session: s })
      )
        return;
      await move(m.author.id, -n, m.id + ":out", "transfer_out", s);
      await move(uid, n, m.id + ":in", "transfer_in", s);
    });
    await m.reply(
      embed("Transfer tamamlandı", `<@${uid}> · ${money(n)} ROAR Parası`),
    );
  });
  async function view(g) {
    const z = g.state,
      active = g.status === "active",
      bid = (a) => `e:${g._id}:${z.version}:${a}`,
      p = embed(
        `ROAR · ${z.type}`,
        `${active ? "Oyun sürüyor" : z.result}\nBahis: **${money(z.bet)}**\n${active ? `Bitiş: <t:${Math.floor(g.expiresAt / 1000)}:R> · Süre dolarsa bahis kaybedilir.` : `Ödeme: **${money(z.payout || 0)}** (bahis dahil)`}`,
        active ? 0x8b79dd : z.payout ? 0x72ccaa : 0xe86a8a,
      );
    if (z.type === "mine") {
      p.components = [];
      for (let y = 0; y < 3; y++)
        p.components.push(
          row(
            ...Array.from({ length: 3 }, (_, x) => {
              const n = y * 3 + x,
                o = z.opened.includes(n);
              return {
                ...button(
                  bid("cell" + n),
                  !active || o
                    ? z.bombs.includes(n)
                      ? "X"
                      : "O"
                    : String(n + 1),
                  o ? 1 : 2,
                ),
                disabled: !active || o,
              };
            }),
          ),
        );
      p.components.push(
        row({
          ...button(
            bid("cash"),
            `Bozdur (${money(active && z.opened.length ? Math.floor(z.bet * mineMultiplier(z.opened.length)) : 0)})`,
            3,
          ),
          disabled: !active || !z.opened.length,
        }),
      );
    } else {
      p.embeds[0].description += `\n\nKrupiye: ${active ? cardLabel(z.dealer[0]) + " ?" : z.dealer.map(cardLabel).join(" ")}\nSen: ${z.player.map(cardLabel).join(" ")} (**${score(z.player)}**)`;
      p.components = [
        row(
          ...[
            ["hit", "Kart Çek", 1],
            ["stand", "Dur", 2],
            ["double", "Katla", 3],
          ].map(([a, l, s]) => ({
            ...button(bid(a), l, s),
            disabled: !active || (a === "double" && z.player.length !== 2),
          })),
        ),
      ];
    }
    if (z.type === "blackjack")
      return attachCard(p, "blackjack", {
        game: z,
        name: g.userName || "ROAR Oyuncusu",
      });
    return p;
  }
  async function start(m, a, type) {
    const bet = amount(a[0], c.maxBet),
      state = createGame(type, bet),
      g = {
        _id: m.id,
        guildId: c.guildId,
        userId: m.author.id,
        userName: m.member.displayName,
        channelId: m.channelId,
        messageId: null,
        state,
        status: state.status,
        expiresAt: new Date(Date.now() + c.gameTimeoutSeconds * 1000),
      };
    await tx(async (s) => {
      if (
        await db
          .collection("games")
          .findOne(
            { guildId: c.guildId, userId: m.author.id, status: "active" },
            { session: s },
          )
      )
        throw Error("Aktif oyununuzu bitirin.");
      await move(m.author.id, -bet, `game:${m.id}:bet`, "game_bet", s);
      await db.collection("games").insertOne(g, { session: s });
      if (state.status === "finished" && state.payout)
        await move(
          m.author.id,
          state.payout,
          `game:${m.id}:payout`,
          "game_payout",
          s,
        );
    });
    let sent;
    try {
      sent = await m.reply(await view(g));
      await db
        .collection("games")
        .updateOne({ _id: g._id }, { $set: { messageId: sent.id } });
    } catch (e) {
      if (!sent)
        await tx(async (s) => {
          const cur = await db
            .collection("games")
            .findOne({ _id: g._id, status: "active" }, { session: s });
          if (cur) {
            await move(
              cur.userId,
              cur.state.bet,
              `game:${g._id}:refund`,
              "send_refund",
              s,
            );
            await db
              .collection("games")
              .updateOne(
                { _id: g._id },
                { $set: { status: "cancelled" } },
                { session: s },
              );
          }
        });
      throw e;
    }
  }
  ctx.add(["mine"], (m, a) => start(m, a, "mine"));
  ctx.add(["blackjack", "bj"], (m, a) => start(m, a, "blackjack"));
  ctx.onInteraction(async (i) => {
    const [, token, v, a] = i.customId.split(":");
    if (["daily", "history"].includes(v)) {
      await i.deferReply({ flags: EPH });
      const s = await readSession(ctx, i, token);
      if (s.kind !== "wallet") throw Error("Geçersiz menü.");
      if (v === "daily") {
        const r = await daily(i.user.id);
        return i.editReply({
          content: `${r.already ? "Ödül alınmış." : "Ödül eklendi."} Bakiye: ${money(r.balance)}. Yenilemek için .coin.`,
        });
      }
      const list = await db
        .collection("ledger")
        .find({ guildId: i.guildId, userId: i.user.id })
        .sort({ at: -1 })
        .limit(10)
        .toArray();
      return i.editReply(
        embed(
          "Son 10 işlem",
          list
            .map(
              (x) => `${x.delta > 0 ? "+" : ""}${money(x.delta)} · ${x.type}`,
            )
            .join("\n") || "İşlem yok.",
        ),
      );
    }
    await i.deferUpdate();
    const next = await tx(async (s) => {
      const g = await db
        .collection("games")
        .findOne({ _id: token, guildId: i.guildId }, { session: s });
      if (
        !g ||
        g.userId !== i.user.id ||
        g.channelId !== i.channelId ||
        (g.messageId && g.messageId !== i.message.id)
      )
        throw Error("Bu oyun size ait değil.");
      if (
        g.status !== "active" ||
        g.state.version !== Number(v) ||
        g.expiresAt < Date.now()
      )
        throw Error("Oyun bitti veya ekran eski.");
      if (a === "double") {
        if (g.state.type !== "blackjack" || g.state.player.length !== 2)
          throw Error("Katlama geçersiz.");
        await move(
          g.userId,
          -g.state.bet,
          `game:${token}:double`,
          "game_double",
          s,
        );
      }
      const z = advance(g.state, a);
      if (z.status === "finished" && z.payout)
        await move(
          g.userId,
          z.payout,
          `game:${token}:payout`,
          "game_payout",
          s,
        );
      await db
        .collection("games")
        .updateOne(
          { _id: token, "state.version": Number(v) },
          { $set: { state: z, status: z.status } },
          { session: s },
        );
      return { ...g, state: z, status: z.status };
    });
    await i.editReply(await view(next));
  });
  ctx.every(15000, async () => {
    const list = await db
      .collection("games")
      .find({
        guildId: c.guildId,
        status: "active",
        expiresAt: { $lte: new Date() },
      })
      .limit(100)
      .toArray();
    for (const old of list) {
      const done = await tx(async (s) => {
        const g = await db
          .collection("games")
          .findOne(
            { _id: old._id, status: "active", expiresAt: { $lte: new Date() } },
            { session: s },
          );
        if (!g) return null;
        const state = expireGame(g.state);
        await db
          .collection("games")
          .updateOne(
            { _id: g._id },
            { $set: { state, status: "finished" } },
            { session: s },
          );
        return { ...g, state, status: "finished" };
      });
      if (done?.messageId) {
        const ch = await ctx.client.channels
            .fetch(done.channelId)
            .catch(() => null),
          m = await ch?.messages?.fetch(done.messageId).catch(() => null);
        if (m)
          await m
            .edit(await view(done))
            .catch(() => ctx.report("Oyun mesajı güncellenemedi"));
      }
    }
  });
}
