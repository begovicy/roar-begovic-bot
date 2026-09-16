import { randomInt } from "node:crypto";
export function rps(a, b) {
  if (
    !["tas", "kagit", "makas"].includes(a) ||
    !["tas", "kagit", "makas"].includes(b)
  )
    throw Error("Geçersiz seçim.");
  if (a === b) return 0;
  return { tas: "makas", kagit: "tas", makas: "kagit" }[a] === b ? 1 : 2;
}
export function newDuel() {
  return { hp: [100, 100], heals: [0, 0], turn: 0, round: 0, winner: null };
}
export function duelStep(
  input,
  player,
  action,
  damage = randomInt(15, 31),
  heal = randomInt(10, 21),
) {
  const s = structuredClone(input);
  if (s.winner !== null || s.turn !== player || ![0, 1].includes(player))
    throw Error("Sıra sizde değil veya oyun bitti.");
  const other = 1 - player;
  if (action === "attack") s.hp[other] = Math.max(0, s.hp[other] - damage);
  else if (action === "heal") {
    if (s.heals[player] >= 3) throw Error("İyileşme hakkınız doldu.");
    s.heals[player]++;
    s.hp[player] = Math.min(100, s.hp[player] + heal);
  } else if (action === "quit") {
    s.winner = other;
    return s;
  } else throw Error("Geçersiz hareket.");
  s.round++;
  if (s.hp[other] === 0) s.winner = player;
  else if (s.round >= 50)
    s.winner = s.hp[0] === s.hp[1] ? -1 : s.hp[0] > s.hp[1] ? 0 : 1;
  s.turn = other;
  return s;
}
export function crashSample(u = randomInt(1, 1000001) / 1000000) {
  if (u <= 0 || u > 1) throw Error("Geçersiz rastgele değer.");
  return Math.min(30, Math.max(1, Math.floor((0.97 / u) * 100) / 100));
}
export function crashMultiplier(start, now) {
  return Math.min(
    30,
    Math.max(
      1,
      Math.floor(Math.exp(Math.max(0, now - start) / 8000) * 100) / 100,
    ),
  );
}
export function crashOutcome(game, now) {
  const multiplier = crashMultiplier(game.startedAt, now);
  const crashed = now >= game.crashAt;
  return {
    multiplier: crashed ? game.crash : multiplier,
    crashed,
    payout: crashed
      ? 0
      : Math.floor((game.bet * Math.round(multiplier * 100)) / 100),
  };
}
