// geometry.js — cálculos de distância, área e conversão para UTM (WGS84)
const Geometry = (() => {

  const R = 6378137; // raio equatorial WGS84 (m)

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  // Distância Haversine entre dois pontos (lat/lng em graus) -> metros
  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Comprimento total de uma polilinha (array de {lat,lng})
  function lineLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
    return total;
  }

  // Zona UTM a partir da longitude
  function utmZone(lng) {
    return Math.floor((lng + 180) / 6) + 1;
  }

  // Conversão geográfica (WGS84) -> UTM. Retorna {x, y, zone, hemisphere}
  function toUTM(lat, lng) {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e = Math.sqrt(f * (2 - f));
    const e2 = e * e;
    const ep2 = e2 / (1 - e2);

    const zone = utmZone(lng);
    const lng0 = toRad((zone - 1) * 6 - 180 + 3);
    const latR = toRad(lat);
    const lngR = toRad(lng);

    const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
    const T = Math.tan(latR) ** 2;
    const C = ep2 * Math.cos(latR) ** 2;
    const A = Math.cos(latR) * (lngR - lng0);

    const M = a * (
      (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latR
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latR)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latR)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * latR)
    );

    let x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let y = k0 * (M + N * Math.tan(latR) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));

    const hemisphere = lat >= 0 ? 'N' : 'S';
    if (lat < 0) y += 10000000;

    return { x, y, zone, hemisphere };
  }

  // Área de polígono (array de {lat,lng}) projetando em UTM e usando Shoelace (Gauss)
  // Retorna { area_m2, area_ha, perimeter_m, zone }
  function polygonArea(coords) {
    if (coords.length < 3) return { area_m2: 0, area_ha: 0, perimeter_m: 0, zone: null };
    const zone = utmZone(coords[0].lng);
    const pts = coords.map(c => toUTM(c.lat, c.lng));

    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      area += (p1.x * p2.y - p2.x * p1.y);
    }
    area = Math.abs(area / 2);

    let perimeter = 0;
    const closed = [...coords, coords[0]];
    for (let i = 1; i < closed.length; i++) perimeter += haversine(closed[i - 1], closed[i]);

    return { area_m2: area, area_ha: area / 10000, perimeter_m: perimeter, zone };
  }

  function fmtCoord(v) { return v.toFixed(6); }
  function fmtArea(m2) {
    if (m2 >= 10000) return (m2 / 10000).toFixed(4) + ' ha';
    return m2.toFixed(2) + ' m²';
  }
  function fmtDist(m) {
    if (m >= 1000) return (m / 1000).toFixed(3) + ' km';
    return m.toFixed(2) + ' m';
  }

  return { haversine, lineLength, toUTM, utmZone, polygonArea, fmtCoord, fmtArea, fmtDist, toRad, toDeg };
})();
