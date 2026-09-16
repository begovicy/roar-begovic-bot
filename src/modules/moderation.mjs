import { embed } from "../core/ui.mjs";

export async function install(ctx) {
  ctx.add(["modinfo"], async (m) => {
    await m.reply(embed("Moderation Bot", "V5 Aktif"));
  });
}
