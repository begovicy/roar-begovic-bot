import { embed, row, button, session, readSession, EPH } from "../core/ui.mjs";
import { P, authorize } from "../core/auth.mjs";
import {
  duration,
  amount,
  id,
  shuffled,
  snowflake,
  clean,
} from "../core/util.mjs";
export async function install(ctx) {
  const { db, c } = ctx;
  function raffleView(g) {
    const active = g.status === "active";
    return {
      ...embed(
        "ROAR Çekiliş",
        `**${g.prize}**\nKazanan sayısı: ${g.winnerCount}\n${active ? `Bitiş: <t:${Math.floor(g.endsAt / 1000)}:R>` : g.status === "paused" ? "Duraklatıldı." : `Kazananlar: ${(g.winners || []).map((x) => `<@${x}>`).join(", ") || "Katılım yok"}`}\nKatılım ücretsizdir.`,
      ),
      components: [
        row({
          ...button("m:ops:join:" + g._id, "Katıl / Ayrıl", 3),
          disabled: !active,
        }),
      ],
    };
  }
  async function finish(g, reroll = false) {
    await ctx.lock("raffle:" + g._id, async () => {
      g = await db.collection("raffles").findOne({ _id: g._id });
      if (!g || (!reroll && !["active", "paused"].includes(g.status))) return;
      const entries = await db
        .collection("raffleEntries")
        .find({ raffleId: g._id })
        .limit(10000)
        .toArray();
      const candidates = entries
          .map((x) => x.userId)
          .filter((x) => !reroll || !(g.winners || []).includes(x)),
        winners = shuffled(candidates.length)
          .slice(0, g.winnerCount)
          .map((i) => candidates[i]);
      await db
        .collection("raffles")
        .updateOne(
          { _id: g._id },
          { $set: { status: "finished", winners, finishedAt: new Date() } },
        );
      const ch = await ctx.client.channels.fetch(g.channelId),
        msg = await ch.messages.fetch(g.messageId);
      await msg.edit(raffleView({ ...g, status: "finished", winners }));
    });
  }
  ctx.add(["giveaway", "çekiliş", "cekilis"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const action = a.shift();
    if (action === "start") {
      const ms = duration(a.shift()),
        winnerCount = amount(a.shift(), 20),
        prize = a.join(" ").slice(0, 200);
      if (!prize) throw Error(".giveaway start 1h 1 Ödül");
      const g = {
        _id: id(),
        guildId: m.guildId,
        channelId: m.channelId,
        prize,
        winnerCount,
        status: "active",
        endsAt: new Date(Date.now() + ms),
        at: new Date(),
        winners: [],
      };
      await db.collection("raffles").insertOne(g);
      const sent = await m.channel.send(raffleView(g));
      await db
        .collection("raffles")
        .updateOne({ _id: g._id }, { $set: { messageId: sent.id } });
      return m.reply(embed("Çekiliş oluşturuldu", `Yönetim ID: \`${g._id}\``));
    }
    const g = await db
      .collection("raffles")
      .findOne({ _id: a.shift(), guildId: m.guildId });
    if (!g) throw Error("Çekiliş ID gerekli.");
    if (action === "end") return finish(g);
    if (action === "reroll") {
      if (g.status !== "finished") throw Error("Çekiliş bitmeli.");
      return finish(g, true);
    }
    if (action === "pause" && g.status === "active")
      await db
        .collection("raffles")
        .updateOne(
          { _id: g._id },
          {
            $set: {
              status: "paused",
              remainingMs: Math.max(1000, g.endsAt - Date.now()),
            },
          },
        );
    else if (action === "unpause" && g.status === "paused")
      await db
        .collection("raffles")
        .updateOne(
          { _id: g._id },
          {
            $set: {
              status: "active",
              endsAt: new Date(Date.now() + g.remainingMs),
            },
          },
        );
    else if (action === "edit") {
      const prize = a.join(" ").slice(0, 200);
      if (!prize) throw Error("Yeni ödülü yazın.");
      await db
        .collection("raffles")
        .updateOne({ _id: g._id }, { $set: { prize } });
    } else if (action === "delete") {
      const t = await session(
        ctx,
        "raffleDelete",
        m.author.id,
        m.channelId,
        { raffleId: g._id },
        30,
      );
      return m.reply({
        ...embed("Çekilişi sil?", g.prize),
        components: [
          row(button("m:ops:raffleDelete:" + t, "Onayla ve Sil", 4)),
        ],
      });
    } else throw Error("start/end/reroll/pause/unpause/edit/delete kullanın.");
    const next = await db.collection("raffles").findOne({ _id: g._id });
    const ch = await m.guild.channels.fetch(g.channelId);
    await (await ch.messages.fetch(g.messageId)).edit(raffleView(next));
    await m.reply(embed("Çekiliş güncellendi", next.status));
  });
  ctx.add(["nuke"], async (m) => {
    await authorize(ctx, m, null, true);
    if (m.channel.type !== 0) throw Error("Yalnız standart metin kanalı.");
    if (
      Object.values(c)
        .flat()
        .some((x) => typeof x === "string" && x === m.channelId)
    )
      throw Error(
        "Yapılandırmada kullanılan kanal sıfırlanamaz. Önce referanslarını değiştirin.",
      );
    const t = await session(
      ctx,
      "nuke",
      m.author.id,
      m.channelId,
      { channelId: m.channelId },
      30,
    );
    await m.reply({
      ...embed(
        "Kanalı sıfırla?",
        `**Tüm mesaj geçmişi kalıcı olarak silinir.** Kanal yeni ID ile yeniden oluşturulur. Bu işlem geri alınamaz.`,
      ),
      components: [row(button("m:ops:nuke:" + t, "Onayla, Mesajları Sil", 4))],
    });
  });
  ctx.add(["kilit"], async (m, a) => {
    await authorize(ctx, m, P.ManageChannels);
    if (!["aç", "ac", "kapat"].includes(a[0])) throw Error(".kilit kapat / aç");
    const key = m.guildId + ":" + m.channelId,
      locked = a[0] === "kapat";
    await ctx.lock("channelLock:" + key, async () => {
      const old = await db.collection("channelLocks").findOne({ _id: key });
      if (locked) {
        if (old) throw Error("Bot kilidi zaten açık.");
        const ow = m.channel.permissionOverwrites.cache.get(m.guildId),
          previous = ow?.allow.has(P.SendMessages)
            ? true
            : ow?.deny.has(P.SendMessages)
              ? false
              : null;
        await db.collection("channelLocks").insertOne({ _id: key, previous });
        await m.channel.permissionOverwrites.edit(m.guildId, {
          SendMessages: false,
        });
      } else {
        if (!old) throw Error("Bot tarafından kayıtlı kilit yok.");
        await m.channel.permissionOverwrites.edit(m.guildId, {
          SendMessages: old.previous,
        });
        await db.collection("channelLocks").deleteOne({ _id: key });
      }
    });
    await m.reply(
      embed(
        "Kanal kilidi",
        locked
          ? "@everyone için yazma kapandı; özel izinli roller hâlâ yazabilir."
          : "Önceki yazma izni geri getirildi.",
      ),
    );
  });
  ctx.add(["görev", "gorev"], async (m, a) => {
    const action = a.shift();
    if (action === "ekle") {
      await authorize(ctx, m, P.ManageRoles);
      const uid = snowflake(a.shift()),
        text = a.join(" ").slice(0, 500);
      if (!text) throw Error("Görev metni yazın.");
      const r = {
        _id: id(),
        guildId: m.guildId,
        userId: uid,
        text,
        status: "open",
        actorId: m.author.id,
        at: new Date(),
      };
      await db.collection("tasks").insertOne(r);
      return m.reply(
        embed("Görev oluşturuldu", `<@${uid}> · ${text}\n\`${r._id}\``),
      );
    }
    if (action === "tamamla") {
      const r = await db
        .collection("tasks")
        .findOneAndUpdate(
          {
            _id: a[0],
            guildId: m.guildId,
            userId: m.author.id,
            status: "open",
          },
          { $set: { status: "review", submittedAt: new Date() } },
          { returnDocument: "after", includeResultMetadata: false },
        );
      if (!r) throw Error("Açık göreviniz bulunamadı.");
      return m.reply(embed("Görev incelemeye gönderildi", r.text));
    }
    if (action === "onayla") {
      await authorize(ctx, m, P.ManageRoles);
      const r = await db
        .collection("tasks")
        .findOneAndUpdate(
          { _id: a[0], guildId: m.guildId, status: "review" },
          { $set: { status: "done", approvedBy: m.author.id } },
          { returnDocument: "after", includeResultMetadata: false },
        );
      if (!r) throw Error("İnceleme bekleyen görev yok.");
      return m.reply(embed("Görev onaylandı", r.text));
    }
    const rows = await db
      .collection("tasks")
      .find({ guildId: m.guildId, userId: m.author.id })
      .sort({ at: -1 })
      .limit(10)
      .toArray();
    await m.reply(
      embed(
        "Görevlerim",
        rows.map((x) => `${x.text} · ${x.status}\n\`${x._id}\``).join("\n\n") ||
          "Görev yok.",
      ),
    );
  });
  ctx.onInteraction(async (i) => {
    const [, , action, token] = i.customId.split(":");
    if (action === "join") {
      await i.deferReply({ flags: EPH });
      await ctx.lock("raffle:" + token, async () => {
        const g = await db
          .collection("raffles")
          .findOne({
            _id: token,
            guildId: i.guildId,
            status: "active",
            endsAt: { $gt: new Date() },
          });
        if (!g || g.channelId !== i.channelId)
          throw Error("Çekiliş aktif değil.");
        const key = token + ":" + i.user.id,
          old = await db
            .collection("raffleEntries")
            .findOneAndDelete({ _id: key });
        if (old) return i.editReply({ content: "Çekilişten ayrıldın." });
        if (
          (await db
            .collection("raffleEntries")
            .countDocuments({ raffleId: token })) >= 10000
        )
          throw Error("Katılımcı limiti doldu.");
        await db
          .collection("raffleEntries")
          .insertOne({ _id: key, raffleId: token, userId: i.user.id });
        await i.editReply({ content: "Çekilişe katıldın." });
      });
      return;
    }
    const s = await readSession(ctx, i, token);
    await authorize(ctx, i, null, true);
    await i.deferUpdate();
    if (action === "raffleDelete" && s.kind === "raffleDelete") {
      const g = await db
        .collection("raffles")
        .findOne({ _id: s.data.raffleId, guildId: i.guildId });
      if (!g) throw Error("Çekiliş yok.");
      await db
        .collection("raffles")
        .updateOne({ _id: g._id }, { $set: { status: "deleted" } });
      await db.collection("raffleEntries").deleteMany({ raffleId: g._id });
      const ch = await i.guild.channels.fetch(g.channelId);
      await (await ch.messages.fetch(g.messageId)).delete();
      await db.collection("sessions").deleteOne({ _id: token });
      return i.editReply({
        ...embed("Çekiliş silindi", "İşlem tamamlandı."),
        components: [],
      });
    }
    if (action === "nuke" && s.kind === "nuke") {
      await ctx.lock("nuke:" + i.channelId, async () => {
        const claimed = await db
          .collection("sessions")
          .findOneAndDelete({ _id: token });
        if (!claimed) throw Error("Onay zaten kullanılmış.");
        const old = i.channel;
        if (Object.values(c).flat().includes(old.id))
          throw Error("Kanal artık yapılandırmada kullanılıyor.");
        const clone = await old.clone({
          reason: "ROAR onaylı kanal sıfırlama",
        });
        try {
          await clone.setPosition(old.rawPosition);
          await old.delete("ROAR kurucu onayı");
        } catch (e) {
          await clone
            .delete("ROAR başarısız sıfırlama temizliği")
            .catch(() => {});
          throw e;
        }
        await clone.send(
          embed("Kanal sıfırlandı", `İşlemi yapan: <@${i.user.id}>`),
        );
      });
      return;
    }
    throw Error("Geçersiz onay.");
  }, "m:ops:");
  ctx.every(10000, async () => {
    for (const g of await db
      .collection("raffles")
      .find({
        guildId: c.guildId,
        status: "active",
        endsAt: { $lte: new Date() },
      })
      .limit(50)
      .toArray())
      await finish(g);
  });
}
