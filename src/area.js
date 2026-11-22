// UK area enrichment for a grid point: nearest postcode (postcodes.io, free) -> LSOA 2021 ->
// English Indices of Deprivation 2025. England only; other places return null.

import IOD from './data/iod2025.js';

export function iodFor(lsoaCode) {
  if (!lsoaCode || !lsoaCode.startsWith('E01')) return null;
  const row = IOD[lsoaCode.slice(3)];
  return row ? { imdDecile: row[0], incomeDecile: row[1], population: row[2] } : null;
}

export async function lookupArea(lat, lng, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1&radius=2000`);
    if (!res.ok) return null;
    const body = await res.json();
    const r = body.result && body.result[0];
    if (!r) return null;
    const code = (r.codes && (r.codes.lsoa21 || r.codes.lsoa)) || null;
    const iod = iodFor(code);
    return {
      postcode: r.postcode,
      lsoa: code,
      lsoaName: r.lsoa21 || r.lsoa || null,
      district: r.admin_district || null,
      ...(iod || {}),
    };
  } catch {
    return null;
  }
}
