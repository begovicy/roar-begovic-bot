import { embed, row, button, session, readSession, EPH } from "../core/ui.mjs";
import { amount, money } from "../core/util.mjs";
import { authorize } from "../core/auth.mjs";
export async function install(ctx) {
  const { db, c, tx } = ctx,
    { wallet, move } = ctx.economy;
  async function store(uid, cid) {
    const items = c.shopItems,
      t = await session(ctx, "shop", uid, cid, {}, 600),
      p = embed(
        "ROAR Mağaza",
        items
          .map((x) => `${x.name} · ${money(x.price)} ROAR Parası`)
          .join("\n") || "Kurucu henüz ürün tanımlamamış.",
      );
    p.components = [];
    for (let j = 0; j < items.length; j += 5)
      p.components.push(
        row(
          ...items
            .slice(j, j + 5)
            .map((x) => button(`e:shop:${t}:${x.id}`, x.name.slice(0, 50))),
        ),
      );
    return p;
  }
  async function purchases(uid, gid) {
    const a = await db
      .collection("purchases")
      .find({ guildId: gid, userId: uid })
      .sort({ at: -1 })
      .limit(20)
      .toArray();
    return embed(
      "Satın Aldıklarım",
      a.map((x) => `${x.name} · ${x.status}\n\`${x._id}\``).join("\n") ||
        "Satın alma yok.",
    );
  }
  async function gold(uid) {
    const w = await wallet(uid);
    return embed(
      "Döviz İşlemleri",
      `Altın: **${w.gold || 0} G**\nAlış: 1000 / Satış: 900 ROAR Parası\n.altinal miktar / .altinsat miktar\nSabit sanal kur; gerçek para değildir.`,
    );
  }
  ctx.add(["magaza", "mağaza"], async (m) =>
    m.reply(await store(m.author.id, m.channelId)),
  );
  ctx.add(["satinaldiklarim", "satınaldıklarım"], async (m) =>
    m.reply(await purchases(m.author.id, m.guildId)),
  );
  ctx.add(["doviz", "döviz"], async (m) => m.reply(await gold(m.author.id)));
  ctx.onInteraction(async (i) => {
    const [, , token, action] = i.customId.split(":"),
      s = await readSession(ctx, i, token);
    if (s.kind !== "wallet") throw Error("Geçersiz banka paneli.");
    await i.deferReply({ flags: EPH });
    if (action === "shop")
      return i.editReply(await store(i.user.id, i.channelId));
    if (action === "purchases")
      return i.editReply(await purchases(i.user.id, i.guildId));
    if (action === "gold") return i.editReply(await gold(i.user.id));
    throw Error("Geçersiz işlem.");
  }, "e:hub:");
  async function deliver(g, p) {
    const member = await g.members.fetch(p.userId),
      role = await g.roles.fetch(p.roleId);
    if (!role?.editable || role.managed || role.permissions.bitfield !== 0n)
      throw Error("Ürün rolü yönetilemiyor.");
    await member.roles.add(role.id);
    await db
      .collection("purchases")
      .updateOne(
        { _id: p._id, status: "pending" },
        { $set: { status: "delivered" } },
      );
  }
  ctx.onInteraction(async (i) => {
    const [, , token, itemId] = i.customId.split(":"),
      s = await readSession(ctx, i, token);
    if (s.kind !== "shop") throw Error("Geçersiz mağaza.");
    const item = c.shopItems.find((x) => x.id === itemId);
    if (!item) throw Error("Ürün yok.");
    await i.deferReply({ flags: EPH });
    await ctx.lock("purchase:" + i.user.id, async () => {
      const member = await i.guild.members.fetch(i.user.id),
        role = await i.guild.roles.fetch(item.roleId);
      if (!role?.editable || role.managed || role.permissions.bitfield !== 0n)
        throw Error("Rol satılamaz.");
      if (member.roles.cache.has(role.id))
        throw Error("Bu role zaten sahipsiniz.");
      const p = {
        _id: i.id,
        guildId: i.guildId,
        userId: i.user.id,
        roleId: role.id,
        name: item.name,
        price: item.price,
        status: "pending",
        at: new Date(),
      };
      await tx(async (s) => {
        if (
          await db
            .collection("purchases")
            .findOne(
              {
                guildId: i.guildId,
                userId: i.user.id,
                roleId: role.id,
                status: { $in: ["pending", "delivered"] },
              },
              { session: s },
            )
        )
          throw Error("Bu ürün zaten alınmış veya teslim bekliyor.");
        await move(i.user.id, -p.price, "buy:" + p._id, "shop_buy", s);
        await db.collection("purchases").insertOne(p, { session: s });
      });
      try {
        await deliver(i.guild, p);
        await i.editReply({ content: "Ürün rolü verildi." });
      } catch (e) {
        ctx.report("Ürün teslimi", e);
        await i.editReply({
          content:
            "Ödeme kayıtlı; rol teslimi tekrar denenecek. İşlem: " + p._id,
        });
      }
    });
  }, "e:shop:");
  ctx.add(["iade"], async (m, a) => {
    await authorize(ctx, m, null, true);
    const p = await db
      .collection("purchases")
      .findOne({
        _id: a[0],
        guildId: m.guildId,
        status: { $in: ["pending", "delivered"] },
      });
    if (!p) throw Error("İade edilebilir işlem yok.");
    await ctx.lock("purchase:" + p.userId, async () => {
      if (
        !(await db
          .collection("purchases")
          .findOne({ _id: p._id, status: { $in: ["pending", "delivered"] } }))
      )
        throw Error("İade zaten işlenmiş.");
      const member = await m.guild.members.fetch(p.userId).catch((e) => {
        if (e.code === 10007) return null;
        throw e;
      });
      if (member)
        await member.roles.remove(p.roleId).catch((e) => {
          if (e.code !== 10011) throw e;
        });
      await tx(async (s) => {
        const fresh = await db
          .collection("purchases")
          .findOne(
            { _id: p._id, status: { $in: ["pending", "delivered"] } },
            { session: s },
          );
        if (!fresh) throw Error("İade zaten işlenmiş.");
        await move(p.userId, p.price, "refund:" + p._id, "shop_refund", s);
        await db
          .collection("purchases")
          .updateOne(
            { _id: p._id },
            { $set: { status: "refunded", refundedBy: m.author.id } },
            { session: s },
          );
      });
    });
    await m.reply(embed("İade edildi", `${p.name} · ${money(p.price)}`));
  });
  ctx.add(["altinal"], async (m, a) => {
    const n = amount(a[0], 1000000);
    await tx(async (s) => {
      if (await db.collection("ledger").findOne({ _id: m.id }, { session: s }))
        return;
      await move(m.author.id, -n * 1000, m.id, "gold_buy", s);
      await db
        .collection("wallets")
        .updateOne(
          { guildId: m.guildId, userId: m.author.id },
          { $inc: { gold: n } },
          { session: s },
        );
    });
    await m.reply(embed("Altın alındı", `${n} G`));
  });
  ctx.add(["altinsat"], async (m, a) => {
    const n = amount(a[0], 1000000);
    await tx(async (s) => {
      if (await db.collection("ledger").findOne({ _id: m.id }, { session: s }))
        return;
      await wallet(m.author.id, s);
      const w = await db
        .collection("wallets")
        .findOneAndUpdate(
          { guildId: m.guildId, userId: m.author.id, gold: { $gte: n } },
          { $inc: { gold: -n } },
          { session: s, includeResultMetadata: false },
        );
      if (!w) throw Error("Yetersiz altın.");
      await move(m.author.id, n * 900, m.id, "gold_sell", s);
    });
    await m.reply(embed("Altın satıldı", `${n} G · ${money(n * 900)}`));
  });
  ctx.every(60000, async () => {
    const g = ctx.client.guilds.cache.get(c.guildId);
    if (!g) return;
    for (const p of await db
      .collection("purchases")
      .find({ guildId: c.guildId, status: "pending" })
      .limit(25)
      .toArray())
      await ctx.lock("purchase:" + p.userId, async () => {
        const fresh = await db
          .collection("purchases")
          .findOne({ _id: p._id, status: "pending" });
        if (fresh)
          await deliver(g, fresh).catch((e) => ctx.report("Bekleyen ürün", e));
      });
  });
}
