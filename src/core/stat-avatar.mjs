import sharp from "sharp";
const cache = new Map();
export function avatarURLAllowed(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(u.hostname) &&
      /^\/(avatars|guilds|embed\/avatars)\//.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export async function avatarData(url) {
  if (!avatarURLAllowed(url)) return "";
  const old = cache.get(url);
  if (old && old.expires > Date.now()) return old.value;
  let value = "";
  try {
    const r = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (
      !r.ok ||
      !r.headers.get("content-type")?.startsWith("image/") ||
      Number(r.headers.get("content-length")) > 524288
    )
      return "";
    const reader = r.body.getReader(),
      parts = [];
    let n = 0;
    while (true) {
      const x = await reader.read();
      if (x.done) break;
      n += x.value.byteLength;
      if (n > 524288) {
        await reader.cancel();
        return "";
      }
      parts.push(Buffer.from(x.value));
    }
    const png = await sharp(Buffer.concat(parts), { limitInputPixels: 1048576 })
      .resize(128, 128, { fit: "cover" })
      .png()
      .toBuffer();
    value = "data:image/png;base64," + png.toString("base64");
  } catch {}
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(url, { value, expires: Date.now() + 300000 });
  return value;
}
