import { shuffled } from "./util.mjs";
export function score(cards) {
  let n = 0,
    aces = 0;
  for (const c of cards) {
    const v = c % 13;
    if (v === 0) {
      n += 11;
      aces++;
    } else n += Math.min(v + 1, 10);
  }
  while (n > 21 && aces) {
    n -= 10;
    aces--;
  }
  return n;
}
export const cardLabel = (c) =>
  `${["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][c % 13]}${["S", "H", "D", "C"][Math.floor(c / 13)]}`;
export function createGame(type, bet) {
  if (type === "mine")
    return {
      type,
      bet,
      bombs: shuffled(9).slice(0, 3),
      opened: [],
      version: 0,
      status: "active",
    };
  if (type === "blackjack") {
    const deck = shuffled(52);
    const g = {
      type,
      bet,
      deck,
      player: [deck.pop(), deck.pop()],
      dealer: [deck.pop(), deck.pop()],
      version: 0,
      status: "active",
    };
    if (score(g.player) === 21 || score(g.dealer) === 21)
      resolveBlackjack(g, true);
    return g;
  }
  throw Error("Bilinmeyen oyun.");
}
export function mineMultiplier(opened) {
  if (!Number.isInteger(opened) || opened < 1 || opened > 6)
    throw Error("Geçersiz açılan hücre sayısı.");
  let survival = 1;
  for (let i = 0; i < opened; i++) survival *= (6 - i) / (9 - i);
  return 0.97 / survival;
}
function finish(g, payout, result) {
  g.status = "finished";
  g.payout = payout;
  g.result = result;
  return g;
}
function resolveBlackjack(g, natural = false) {
  const p = score(g.player),
    d = score(g.dealer);
  if (p > 21) return finish(g, 0, "BATTIN");
  if (natural) {
    if (p === 21 && d === 21) return finish(g, g.bet, "BERABERE");
    if (d === 21) return finish(g, 0, "KRUPİYE BLACKJACK");
    if (p === 21) return finish(g, Math.floor(g.bet * 2.5), "BLACKJACK");
  }
  if (d > 21 || p > d) return finish(g, g.bet * 2, "KAZANDIN");
  if (p === d) return finish(g, g.bet, "BERABERE");
  return finish(g, 0, "KRUPİYE KAZANDI");
}
export function advance(input, action) {
  const g = structuredClone(input);
  if (g.status !== "active") throw Error("Oyun zaten bitti.");
  g.version++;
  if (g.type === "mine") {
    if (action === "cash") {
      if (!g.opened.length) throw Error("Önce bir hücre açın.");
      return finish(
        g,
        Math.floor(g.bet * mineMultiplier(g.opened.length)),
        "BOZDURULDU",
      );
    }
    if (!/^cell[0-8]$/.test(action)) throw Error("Geçersiz hücre.");
    const n = Number(action.slice(4));
    if (g.opened.includes(n)) throw Error("Bu hücre açık.");
    g.opened.push(n);
    if (g.bombs.includes(n)) return finish(g, 0, "MAYINA BASTIN");
    if (g.opened.length === 6)
      return finish(g, Math.floor(g.bet * mineMultiplier(6)), "TÜM ELMASLAR");
    return g;
  }
  if (g.type === "blackjack") {
    if (action === "hit") {
      g.player.push(g.deck.pop());
      if (score(g.player) > 21) return finish(g, 0, "BATTIN");
      if (score(g.player) < 21) return g;
    } else if (action === "double") {
      if (g.player.length !== 2) throw Error("Yalnız ilk elde katlanabilir.");
      g.bet *= 2;
      g.player.push(g.deck.pop());
      if (score(g.player) > 21) return finish(g, 0, "BATTIN");
    } else if (action !== "stand") throw Error("Geçersiz hareket.");
    while (score(g.dealer) < 17) g.dealer.push(g.deck.pop());
    return resolveBlackjack(g);
  }
  throw Error("Bilinmeyen oyun.");
}
export const expireGame = (g) => ({
  ...structuredClone(g),
  status: "finished",
  version: g.version + 1,
  payout: 0,
  result: "SÜRE DOLDU",
});
