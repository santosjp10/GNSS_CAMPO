// map.js — mapa Leaflet com camadas satélite/ruas e cache de tiles offline (IndexedDB)
const MapModule = (() => {
  let map, posMarker, posAccuracyCircle, layerGroup, draftLayerGroup, currentBase;
  let editable = false;
  let onVertexMoved = null; // callback(featureId, vertexIndex, {lat,lng})
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
    draftLayerGroup = L.layerGroup().addTo(map);
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

  function setEditable(flag, cb) {
    editable = flag;
    onVertexMoved = cb || null;
  }

  function vertexIcon(color) {
    return L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  // Desenha em tempo real a feição que está sendo coletada (mode: 'point'|'line'|'polygon', coords: [{lat,lng}] — array mutável)
  function updateDraft(mode, coords) {
    if (!draftLayerGroup) return;
    draftLayerGroup.clearLayers();
    if (!coords || !coords.length || mode === 'point') return;

    const latlngs = coords.map(c => [c.lat, c.lng]);
    let shape = null, closing = null, fill = null;

    if (mode === 'line') {
      shape = L.polyline(latlngs, { color: '#0f7ea3', weight: 4, dashArray: '2 6' }).addTo(draftLayerGroup);
    } else if (mode === 'polygon') {
      if (latlngs.length >= 2) shape = L.polyline(latlngs, { color: '#c2410c', weight: 3 }).addTo(draftLayerGroup);
      if (latlngs.length >= 3) {
        closing = L.polyline([latlngs[latlngs.length - 1], latlngs[0]], { color: '#c2410c', weight: 2, dashArray: '4 6' }).addTo(draftLayerGroup);
        fill = L.polygon(latlngs, { color: '#c2410c', weight: 0, fillOpacity: 0.16 }).addTo(draftLayerGroup);
      }
    }

    coords.forEach((c, i) => {
      const color = i === 0 ? '#c2410c' : '#0f7ea3';
      if (editable) {
        const m = L.marker([c.lat, c.lng], { icon: vertexIcon(color), draggable: true }).addTo(draftLayerGroup);
        m.on('drag', () => {
          const p = m.getLatLng();
          const live = coords.map((cc, ii) => ii === i ? [p.lat, p.lng] : [cc.lat, cc.lng]);
          if (mode === 'line' && shape) {
            shape.setLatLngs(live);
          } else if (mode === 'polygon') {
            if (shape) shape.setLatLngs(live);
            if (closing) closing.setLatLngs([live[live.length - 1], live[0]]);
            if (fill) fill.setLatLngs(live);
          }
        });
        m.on('dragend', () => {
          const p = m.getLatLng();
          coords[i].lat = p.lat; coords[i].lng = p.lng;
          if (onVertexMoved) onVertexMoved(null, i, { lat: p.lat, lng: p.lng });
        });
      } else {
        L.circleMarker([c.lat, c.lng], { radius: 5.5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(draftLayerGroup);
      }
    });
  }

  function clearDraft() { if (draftLayerGroup) draftLayerGroup.clearLayers(); }

  function drawFeature(f) {
    if (f.type === 'point') {
      const ll = [f.coords[0].lat, f.coords[0].lng];
      if (editable) {
        const m = L.marker(ll, { icon: vertexIcon('#1f7a52'), draggable: true })
          .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${f.category || ''}`).addTo(layerGroup);
        m.on('dragend', () => {
          const p = m.getLatLng();
          if (onVertexMoved) onVertexMoved(f.id, 0, { lat: p.lat, lng: p.lng });
        });
      } else {
        L.circleMarker(ll, { radius: 6, color: '#1f7a52', weight: 2, fillColor: '#e3f3ec', fillOpacity: 1 })
          .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${f.category || ''}`).addTo(layerGroup);
      }
    } else if (f.type === 'line') {
      const latlngs = f.coords.map(c => [c.lat, c.lng]);
      const line = L.polyline(latlngs, { color: '#0f7ea3', weight: 4 })
        .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${Geometry.fmtDist(f.length_m || 0)}`).addTo(layerGroup);
      if (editable) {
        f.coords.forEach((c, i) => {
          const m = L.marker([c.lat, c.lng], { icon: vertexIcon('#0f7ea3'), draggable: true }).addTo(layerGroup);
          m.on('drag', () => {
            const p = m.getLatLng();
            const ll2 = line.getLatLngs(); ll2[i] = p; line.setLatLngs(ll2);
          });
          m.on('dragend', () => {
            const p = m.getLatLng();
            if (onVertexMoved) onVertexMoved(f.id, i, { lat: p.lat, lng: p.lng });
          });
        });
      }
    } else if (f.type === 'polygon') {
      const latlngs = f.coords.map(c => [c.lat, c.lng]);
      const poly = L.polygon(latlngs, { color: '#c2410c', weight: 3, fillOpacity: 0.18 })
        .bindPopup(`<b>${escapeHtml(f.name)}</b><br>${Geometry.fmtArea(f.area_m2 || 0)}`).addTo(layerGroup);
      if (editable) {
        f.coords.forEach((c, i) => {
          const m = L.marker([c.lat, c.lng], { icon: vertexIcon('#c2410c'), draggable: true }).addTo(layerGroup);
          m.on('drag', () => {
            const p = m.getLatLng();
            const ring = poly.getLatLngs()[0]; ring[i] = p; poly.setLatLngs([ring]);
          });
          m.on('dragend', () => {
            const p = m.getLatLng();
            if (onVertexMoved) onVertexMoved(f.id, i, { lat: p.lat, lng: p.lng });
          });
        });
      }
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
    updateDraft, clearDraft, setEditable,
    fitAll, invalidateSize, tileCacheCount, clearTileCache, getMap: () => map
  };
})();
