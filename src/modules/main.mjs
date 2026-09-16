import { embed } from "../core/ui.mjs";

export async function install(ctx) {
  ctx.add(["main"], async (m) => {
    await m.reply(embed("Main Bot", "V5 Aktif"));
  });
}
