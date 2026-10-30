/** Paavo age bands for a fixture with `n` residents aged 20–64 (all in 40–44). */
export function ages2064(n: number) {
  return { he_20_24: 0, he_25_29: 0, ...ages3064(n) };
}

/** The 30–64 bands only, for a fixture that sets its own he_20_24/he_25_29:
 *  pass the 20–64 total minus those two. */
export function ages3064(n: number) {
  return {
    he_30_34: 0, he_35_39: 0, he_40_44: n, he_45_49: 0,
    he_50_54: 0, he_55_59: 0, he_60_64: 0,
  };
}
