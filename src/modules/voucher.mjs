import { embed } from "../core/ui.mjs";

export async function install(ctx) {
  ctx.add(["voucher"], async (m) => {
    await m.reply(embed("Voucher Bot", "V5 Aktif"));
  });
}
