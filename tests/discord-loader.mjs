export async function resolve(s, c, next) {
  if (s === "discord.js")
    return {
      url: new URL("./discord-fake.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  return next(s, c);
}
