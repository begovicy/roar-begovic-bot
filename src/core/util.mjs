import { randomInt, randomUUID } from "node:crypto";
export const id = () => randomUUID();
export const snowflake = (s) => {
  const x = String(s || "").replace(/[<@!>]/g, "");
  if (!/^\d{17,20}$/.test(x))
    throw Error("Geçerli bir kullanıcı etiketi veya ID yazın.");
  return x;
};
export function amount(s, max = 1e9) {
  if (!/^\d+$/.test(String(s))) throw Error("Pozitif tam sayı kullanın.");
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw Error(`Tutar 1–${max} aralığında olmalı.`);
  return n;
}
export function duration(s) {
  const m = /^(\d+)(s|m|h|d)$/.exec(s || "");
  if (!m) throw Error("Süre örneği: 10m, 2h, 1d.");
  const n = Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
  if (n < 1000 || n > 28 * 86400000)
    throw Error("Süre 1 saniye–28 gün olmalı.");
  return n;
}
export const money = (n) => new Intl.NumberFormat("tr-TR").format(n);
export const elapsed = (n) =>
  `${Math.floor(n / 3600000)} saat ${Math.floor(n / 60000) % 60} dakika ${Math.floor(n / 1000) % 60} saniye`;
export const clean = (s) =>
  String(s ?? "")
    .replace(/[\`*_~|<>]/g, "")
    .slice(0, 100);
export const xml = (s) =>
  String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export const day = (t) =>
  new Date(Number(t) + 10800000).toISOString().slice(0, 10); // Europe/Istanbul UTC+3
export function chunks(from, to) {
  const out = [];
  while (from < to) {
    const end = Math.min(
      to,
      Date.parse(day(from) + "T00:00:00+03:00") + 86400000,
    );
    out.push({ day: day(from), ms: end - from });
    from = end;
  }
  return out;
}
export const shuffled = (n) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export function makeLock() {
  const pending = new Map();
  return async (key, fn) => {
    const prev = pending.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    pending.set(key, next);
    try {
      return await next;
    } finally {
      if (pending.get(key) === next) pending.delete(key);
    }
  };
}
export class UserError extends Error {}
export const fail = (m) => {
  throw new UserError(m);
};
