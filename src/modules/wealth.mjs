import { embed, row, button, session, readSession } from "../core/ui.mjs";
import { attachCard } from "../core/cards.mjs";
import { money } from "../core/util.mjs";
export async function install(ctx) {
  const { db, c } = ctx;
  async function view(token, data) {
    const metric = data.metric === "gold" ? "gold" : "balance",
      query = { guildId: c.guildId, [metric]: { $gt: 0 } },
      count = await db.collection("wallets").countDocuments(query),
      pages = Math.max(1, Math.ceil(count / 10)),
      page = Math.max(0, Math.min(data.page, pages - 1)),
      list = await db
        .collection("wallets")
        .find(query)
        .sort({ [metric]: -1, userId: 1 })
        .skip(page * 10)
        .limit(10)
        .toArray(),
      guild = ctx.client.guilds.cache.get(c.guildId),
      rows = await Promise.all(
        list.map(async (x, j) => ({
          rank: page * 10 + j + 1,
          name:
            (await guild.members.fetch(x.userId).catch(() => null))
              ?.displayName || "Ayrılan üye",
          value: money(x[metric]) + (metric === "gold" ? " G" : " para"),
        })),
      ),
      p = embed(
        metric === "gold" ? "Altın sıralaması" : "Para sıralaması",
        list
          .map(
            (x, j) =>
              `${page * 10 + j + 1}. <@${x.userId}> · ${money(x[metric])}`,
          )
          .join("\n") || "Henüz bakiye yok.",
      );
    p.components = [
      row(
        button(`e:wealth:${token}:balance`, "Para"),
        button(`e:wealth:${token}:gold`, "Altın"),
      ),
      row(
        { ...button(`e:wealth:${token}:prev`, "Önceki"), disabled: page === 0 },
        { ...button("noop", `${page + 1}/${pages}`), disabled: true },
        {
          ...button(`e:wealth:${token}:next`, "Sonraki"),
          disabled: page === pages - 1,
        },
      ),
    ];
    return attachCard(p, "ranking", {
      title: metric === "gold" ? "Altın Sıralaması" : "Para Sıralaması",
      rows,
    });
  }
  ctx.add(["cointop", "altıntop", "altintop"], async (m) => {
    const data = { metric: "gold", page: 0 },
      t = await session(ctx, "wealth", m.author.id, m.channelId, data, 600);
    await m.reply(await view(t, data));
  });
  ctx.onInteraction(async (i) => {
    const [, , token, action] = i.customId.split(":"),
      s = await readSession(ctx, i, token);
    if (s.kind !== "wealth") throw Error("Geçersiz sıralama.");
    await i.deferUpdate();
    const d = { ...s.data };
    if (["gold", "balance"].includes(action)) {
      d.metric = action;
      d.page = 0;
    } else if (action === "next") d.page++;
    else if (action === "prev") d.page = Math.max(0, d.page - 1);
    else throw Error("Geçersiz işlem.");
    await db
      .collection("sessions")
      .updateOne({ _id: token }, { $set: { data: d } });
    await i.editReply(await view(token, d));
  }, "e:wealth:");
}
