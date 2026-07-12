// map.js — mapa Leaflet com camadas satélite/ruas e cache de tiles offline (IndexedDB)
const MapModule = (() => {
  let map, posMarker, posAccuracyCircle, layerGroup, currentBase;
  let dbPromise;
  const DB_NAME = 'gnsscampo_tiles';
  const STORE = 'tiles';

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function tileGet(key) {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }
  async function tilePut(key, blob) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
    } catch (e) { /* ignore */ }
  }
  async function tileCacheCount() {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      });
    } catch (e) { return 0; }
  }
  async function clearTileCache() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
    } catch (e) { /* ignore */ }
  }

  // GridLayer customizado: busca tile da rede e grava no IndexedDB; se offline, usa cache
  const OfflineTileLayer = L.GridLayer.extend({
    initialize: function (urlTemplate, options) {
      this._urlTemplate = urlTemplate;
      L.GridLayer.prototype.initialize.call(this, options);
    },
    createTile: function (coords, done) {
      const img = document.createElement('img');
      img.setAttribute('role', 'presentation');
      const key = `${this.options.id}/${coords.z}/${coords.x}/${coords.y}`;
      const url = L.Util.template(this._urlTemplate, { ...coords, s: this._getSubdomain ? this._getSubdomain(coords) : 'a' });

      tileGet(key).then(cached => {
        if (cached) {
          img.src = URL.createObjectURL(cached);
          done(null, img);
        }
        // sempre tenta atualizar da rede em segundo plano (se online), sem bloquear o cache já exibido
        fetch(url, { mode: 'cors' }).then(r => {
          if (!r.ok) throw new Error('tile http ' + r.status);
          return r.blob();
        }).then(blob => {
          tilePut(key, blob);
          if (!cached) { img.src = URL.createObjectURL(blob); done(null, img); }
        }).catch(err => {
          if (!cached) done(err, img);
        });
      });
      return img;
    }
  });

  const BASE_LAYERS = {
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', id: 'sat', attribution: 'Esri, Maxar, Earthstar Geographics' },
    streets: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', id: 'osm', attribution: 'OpenStreetMap contributors' }
  };

  function init(elId) {
    map = L.map(elId, { zoomControl: false, attributionControl: true }).setView([-11.72, -49.06], 14);
    layerGroup = L.layerGroup().addTo(map);
    setBaseLayer('satellite');
    return map;
  }

  function setBaseLayer(name) {
    if (currentBase) map.removeLayer(currentBase);
    const cfg = BASE_LAYERS[name];
    currentBase = new OfflineTileLayer(cfg.url, { id: cfg.id, maxZoom: 20, attribution: cfg.attribution });
    currentBase.addTo(map);
  }

  function updatePosition(fix, follow) {
    const ll = [fix.lat, fix.lng];
    if (!posMarker) {
      posMarker = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#1f7a52', fillOpacity: 1 }).addTo(map);
      posAccuracyCircle = L.circle(ll, { radius: fix.accuracy || 5, color: '#1f7a52', weight: 1, fillOpacity: 0.12 }).addTo(map);
    } else {
      posMarker.setLatLng(ll);
      posAccuracyCircle.setLatLng(ll);
      posAccuracyCircle.setRadius(fix.accuracy || 5);
    }
    if (follow) map.setView(ll, map.getZoom() < 15 ? 17 : map.getZoom());
  }

  function centerOnPosition(fix) {
    if (fix) map.setView([fix.lat, fix.lng], 18);
  }

  function clearFeatures() { layerGroup.clearLayers(); }

  function drawFeature(f) {
    if (f.type === 'point') {
      L.circleMarker([f.coords[0].lat, f.coords[0].lng], { radius: 6, color: '#1f7a52', weight: 2, fillColor: '#e3f3ec', fillOpacity: 1 })
        .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${f.category || ''}`).addTo(layerGroup);
    } else if (f.type === 'line') {
      const latlngs = f.coords.map(c => [c.lat, c.lng]);
      L.polyline(latlngs, { color: '#0f7ea3', weight: 4 })
        .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${Geometry.fmtDist(f.length_m || 0)}`).addTo(layerGroup);
    } else if (f.type === 'polygon') {
      const latlngs = f.coords.map(c => [c.lat, c.lng]);
      L.polygon(latlngs, { color: '#c2410c', weight: 3, fillOpacity: 0.18 })
        .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${Geometry.fmtArea(f.area_m2 || 0)}`).addTo(layerGroup);
    }
  }

  function drawAll(features) {
    clearFeatures();
    features.forEach(drawFeature);
  }

  function fitAll(features) {
    const pts = [];
    features.forEach(f => f.coords.forEach(c => pts.push([c.lat, c.lng])));
    if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function invalidateSize() { if (map) map.invalidateSize(); }

  return {
    init, setBaseLayer, updatePosition, centerOnPosition, drawAll, clearFeatures,
    fitAll, invalidateSize, tileCacheCount, clearTileCache, getMap: () => map
  };
})();
