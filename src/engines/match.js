// Shared matching helpers.

const SUFFIXES = /\b(ltd|limited|llc|inc|plc|co|company|uk|the)\b/g;

/** Loose name key: lowercase, letters and digits only, common company suffixes removed. */
export function nameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GOOGLE_HOST = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/** Bare domain, or null for empty values and Google's own redirect/viewer hosts. */
export function cleanDomain(d) {
  const s = String(d || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^(www|m)\./, '')
    .replace(/[/?#].*$/, '');
  if (!s || GOOGLE_HOST.test(s)) return null;
  return s;
}

/** Does this listing belong to the target business? CID first, then place ID, then name. */
export function matchesTarget(listing, target) {
  if (!listing || !target) return false;
  if (target.cid && listing.cid) return String(listing.cid) === String(target.cid);
  if (target.placeId && listing.placeId) return listing.placeId === target.placeId;
  const a = nameKey(listing.title);
  return a !== '' && a === nameKey(target.title);
}

/** Parse "0.4 mi · ..." style distances from a listing description into km. */
export function parseDistanceKm(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(mi|km|m)\b/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (m[2] === 'mi') return Math.round(v * 1.609344 * 100) / 100;
  if (m[2] === 'km') return v;
  return Math.round((v / 1000) * 100) / 100;
}
