// Grid generation: N x N points centred on a coordinate.

const KM_PER_DEG_LAT = 111.32;
const KM_PER_MILE = 1.609344;

function round7(n) {
  return Math.round(n * 1e7) / 1e7;
}

/**
 * Build a square grid of points.
 * @param {object} o
 * @param {number} o.lat centre latitude
 * @param {number} o.lng centre longitude
 * @param {number} o.size points per side (odd number, 3 to 15)
 * @param {number} o.spacing distance between neighbouring points
 * @param {'km'|'mi'} [o.unit]
 * @returns {Array<{row:number,col:number,lat:number,lng:number,distanceKm:number}>}
 */
function buildGrid({ lat, lng, size, spacing, unit = 'km' }) {
  if (!Number.isFinite(lat) || lat < -85 || lat > 85) throw new Error('Invalid centre latitude');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('Invalid centre longitude');
  if (!Number.isInteger(size) || size < 3 || size > 15 || size % 2 === 0) {
    throw new Error('Grid size must be an odd number from 3 to 15');
  }
  if (!Number.isFinite(spacing) || spacing <= 0 || spacing > 50) throw new Error('Spacing must be between 0 and 50');

  const stepKm = unit === 'mi' ? spacing * KM_PER_MILE : spacing;
  const half = (size - 1) / 2;
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const points = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dyKm = (half - row) * stepKm; // row 0 is the north edge
      const dxKm = (col - half) * stepKm;
      points.push({
        row,
        col,
        lat: round7(lat + dyKm / KM_PER_DEG_LAT),
        lng: round7(lng + dxKm / kmPerDegLng),
        distanceKm: Math.round(Math.hypot(dxKm, dyKm) * 100) / 100,
      });
    }
  }
  return points;
}

module.exports = { buildGrid, KM_PER_MILE };
