// Deterministic PRNG so the mock dataset is identical on every render/reload.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string — lets any id become a seed. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rngFor(key) {
  return mulberry32(hashSeed(String(key)));
}

/** Random float in [min,max). */
export function between(rnd, min, max) {
  return min + rnd() * (max - min);
}

export function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length)];
}
