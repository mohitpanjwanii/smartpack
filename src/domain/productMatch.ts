/**
 * Matching invoice item names (e.g. "ATTA GUD GHEE COOKIES -250G") to
 * products. An exact match on a remembered name (alias) is trusted.
 * Anything else is only a *suggestion* that staff must confirm on the
 * review screen; confirmations are remembered for next time.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b\d+(\.\d+)?\s*(g|gm|gms|grams?|kg|ml|pcs?|pieces?|nos)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Words shared by many products; they say little about which product it is. */
const GENERIC = new Set(['cake', 'cakes', 'cookie', 'cookies', 'biscuit', 'biscuits', 'special', 'and', 'the', 'pack', 'box']);

function distinctive(s: string): string {
  const words = normalizeName(s).split(' ').filter((w) => w && !GENERIC.has(w));
  return words.join(' ') || normalizeName(s);
}

/**
 * Dice similarity on letter pairs, 0..1, using only the distinctive words
 * (so "Milky Bliss Cake" is not considered close to "Marble Cake" just
 * because both are cakes). Robust to small OCR mistakes.
 */
export function similarity(a: string, b: string): number {
  const A = bigrams(distinctive(a));
  const B = bigrams(distinctive(b));
  let inter = 0;
  let total = 0;
  for (const [, n] of A) total += n;
  for (const [, n] of B) total += n;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return total ? (2 * inter) / total : 0;
}

export interface MatchCandidate {
  id: string;
  name: string;
  sku: string;
}

export interface MatchResult {
  productId: string | null;
  /** 'alias' = remembered from an earlier confirmation; 'exact' = same name; 'suggested' = needs confirmation. */
  kind: 'alias' | 'exact' | 'suggested' | 'ambiguous' | 'none';
  score: number;
  alternatives: { id: string; score: number }[];
}

export function matchProduct(text: string, products: MatchCandidate[], aliases: Map<string, string>): MatchResult {
  const norm = normalizeName(text);
  const aliasHit = aliases.get(norm);
  if (aliasHit && products.some((p) => p.id === aliasHit)) {
    return { productId: aliasHit, kind: 'alias', score: 1, alternatives: [] };
  }
  const exacts = products.filter((p) => normalizeName(p.name) === norm || p.sku.toLowerCase() === text.trim().toLowerCase());
  if (exacts.length === 1) return { productId: exacts[0].id, kind: 'exact', score: 1, alternatives: [] };
  if (exacts.length > 1) {
    // e.g. "Vanilla Cup Cake" fits both the 6-piece and 12-piece packs: a person must choose.
    return { productId: null, kind: 'ambiguous', score: 1, alternatives: exacts.map((p) => ({ id: p.id, score: 1 })) };
  }
  const scored = products
    .map((p) => ({ id: p.id, score: similarity(text, p.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const best = scored[0];
  if (!best || best.score < 0.5) return { productId: null, kind: 'none', score: best?.score ?? 0, alternatives: scored };
  return { productId: best.id, kind: 'suggested', score: best.score, alternatives: scored };
}
