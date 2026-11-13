/**
 * Shared normalization helpers for duplicate detection and merge.
 *
 * All duplicate scoring in src/server/dedupe.ts compares records through
 * these pure functions so the finder, the API routes, and the tests share
 * exactly one definition of "the same value". No ML, no fuzzy libraries —
 * deterministic string normalization only.
 */

/**
 * A small hardcoded map of common English diminutives to their canonical
 * given name. Token-wise: "bob" and "robert" both normalize to "robert".
 * Keys and values are lowercase; lookup happens after punctuation stripping.
 */
const DIMINUTIVES: Record<string, string> = {
  bob: "robert",
  bobby: "robert",
  rob: "robert",
  robbie: "robert",
  alex: "alexander",
  al: "alexander",
  xander: "alexander",
  bill: "william",
  billy: "william",
  will: "william",
  willy: "william",
  liam: "william",
  jim: "james",
  jimmy: "james",
  jamie: "james",
  johnny: "john",
  jack: "john",
  mike: "michael",
  mick: "michael",
  mickey: "michael",
  dick: "richard",
  rich: "richard",
  rick: "richard",
  ricky: "richard",
  richie: "richard",
  joe: "joseph",
  joey: "joseph",
  tom: "thomas",
  tommy: "thomas",
  chris: "christopher",
  dan: "daniel",
  danny: "daniel",
  dave: "david",
  davey: "david",
  matt: "matthew",
  matty: "matthew",
  tony: "anthony",
  steve: "steven",
  stevie: "steven",
  andy: "andrew",
  drew: "andrew",
  ken: "kenneth",
  kenny: "kenneth",
  nick: "nicholas",
  nicky: "nicholas",
  ron: "ronald",
  ronnie: "ronald",
  don: "donald",
  donnie: "donald",
  ed: "edward",
  eddie: "edward",
  eddy: "edward",
  ted: "edward",
  teddy: "edward",
  greg: "gregory",
  jeff: "jeffrey",
  pat: "patrick",
  paddy: "patrick",
  phil: "philip",
  sam: "samuel",
  tim: "timothy",
  timmy: "timothy",
  larry: "lawrence",
  jerry: "gerald",
  gerry: "gerald",
  harry: "harold",
  hal: "harold",
  art: "arthur",
  artie: "arthur",
  jen: "jennifer",
  jenny: "jennifer",
  liz: "elizabeth",
  lizzy: "elizabeth",
  beth: "elizabeth",
  betty: "elizabeth",
  bess: "elizabeth",
  eliza: "elizabeth",
  kate: "katherine",
  katie: "katherine",
  kathy: "katherine",
  kat: "katherine",
  kitty: "katherine",
  cathy: "catherine",
  maggie: "margaret",
  meg: "margaret",
  peggy: "margaret",
  peg: "margaret",
  sue: "susan",
  susie: "susan",
  suzy: "susan",
  deb: "deborah",
  debbie: "deborah",
  barb: "barbara",
  becky: "rebecca",
  becca: "rebecca",
  vicky: "victoria",
  vic: "victoria",
  steph: "stephanie",
  angie: "angela",
  nan: "nancy",
  jan: "janet",
  fran: "frances",
  mandy: "amanda",
  geri: "geraldine",
};

/** Lowercase + trim an email address. Emails have no case semantics. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The local part of an already-normalized email (before the "@"). */
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

/**
 * Core text normalization shared by names and company names: lowercase,
 * hyphen-like characters become spaces, all remaining punctuation and
 * symbols are stripped (which also trims it), and whitespace runs collapse
 * to single spaces. No diminutive mapping at this level.
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-\u2010-\u2015\u2014]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a person name for comparison: normalizeText plus token-wise
 * diminutive mapping ("bob" and "rob" both become "robert").
 */
export function normalizeName(name: string): string {
  return normalizeText(name)
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => DIMINUTIVES[token] ?? token)
    .join(" ");
}

/**
 * Normalize a company name. Identical to normalizeText but WITHOUT the
 * diminutive map: a business called "Bob's Autos" must not turn into
 * "robert's autos".
 */
export function normalizeCompany(name: string): string {
  return normalizeText(name);
}
