// Lightweight deterministic text similarity (Jaccard over normalised tokens).

const STOP = new Set(
  'a an the is are was were of on in at to for and or with near this that there here it its very please our my we i has have been be by from road street area lane'.split(' '),
);

export function tokens(text = '') {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
      .map((t) => t.replace(/(ing|es|s)$/, '')),
  );
}

export function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 1000) / 1000;
}
