// exporters.js — geração e compartilhamento de arquivos (CSV, GeoJSON, KML, KMZ, GPX, SHP)
const Exporters = (() => {

  function ts() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // Salva/compartilha um arquivo. Usa Capacitor Filesystem + Share quando disponível (app nativo);
  // cai para download via <a> quando rodando em navegador comum (modo de desenvolvimento/teste).
  async function saveAndShare(filename, dataStrOrBlob, isBase64) {
    const CapPlugins = window.Capacitor && window.Capacitor.Plugins;
    if (CapPlugins && CapPlugins.Filesystem) {
      try {
        const { Filesystem, Share } = CapPlugins;
        const Directory = window.Capacitor.Directory || { Cache: 'CACHE' };
        let data = dataStrOrBlob;
        if (!isBase64 && dataStrOrBlob instanceof Blob) {
          data = await blobToBase64(dataStrOrBlob);
          isBase64 = true;
        }
        const writeRes = await Filesystem.writeFile({
          path: filename,
          data: data,
          directory: Directory.Cache,
          encoding: isBase64 ? undefined : 'utf8'
        });
        await Share.share({
          title: filename,
          url: writeRes.uri,
          dialogTitle: 'Exportar ' + filename
        });
        return true;
      } catch (e) {
        console.error('Falha ao salvar/compartilhar via Capacitor:', e);
        // segue para fallback abaixo
      }
    }
    // Fallback navegador comum
    const blob = dataStrOrBlob instanceof Blob ? dataStrOrBlob
      : new Blob([isBase64 ? atob(dataStrOrBlob) : dataStrOrBlob], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---------- CSV ----------
  function toCSV(features) {
    const rows = [['tipo', 'nome', 'categoria', 'observacoes', 'data_hora', 'lat_ou_seq', 'lng', 'alt_m', 'precisao_m', 'medida']];
    features.forEach(f => {
      const when = new Date(f.timestamp).toLocaleString('pt-BR');
      if (f.type === 'point') {
        const c = f.coords[0];
        rows.push(['ponto', f.name, f.category || '', (f.notes || '').replace(/\n/g, ' '), when, c.lat, c.lng, c.alt ?? '', c.accuracy ?? '', '']);
      } else {
        const measure = f.type === 'line' ? Geometry.fmtDist(f.length_m || 0) : Geometry.fmtArea(f.area_m2 || 0);
        f.coords.forEach((c, i) => {
          rows.push([f.type, i === 0 ? f.name : '', i === 0 ? (f.category || '') : '', i === 0 ? (f.notes || '').replace(/\n/g, ' ') : '', i === 0 ? when : '', i + 1, `${c.lat},${c.lng}`, c.alt ?? '', c.accuracy ?? '', i === 0 ? measure : '']);
        });
      }
    });
    return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  }
  async function exportCSV(features) {
    await saveAndShare(`levantamento-${ts()}.csv`, toCSV(features), false);
  }

  // ---------- GeoJSON ----------
  function toGeoJSON(features) {
    const geo = {
      type: 'FeatureCollection',
      features: features.map(f => {
        let geometry;
        if (f.type === 'point') geometry = { type: 'Point', coordinates: [f.coords[0].lng, f.coords[0].lat] };
        else if (f.type === 'line') geometry = { type: 'LineString', coordinates: f.coords.map(c => [c.lng, c.lat]) };
        else {
          const ring = f.coords.map(c => [c.lng, c.lat]);
          ring.push(ring[0]);
          geometry = { type: 'Polygon', coordinates: [ring] };
        }
        return {
          type: 'Feature',
          properties: {
            nome: f.name, categoria: f.category || '', observacoes: f.notes || '',
            data_hora: new Date(f.timestamp).toISOString(),
            ...(f.type === 'line' ? { comprimento_m: +(f.length_m || 0).toFixed(2) } : {}),
            ...(f.type === 'polygon' ? { area_m2: +(f.area_m2 || 0).toFixed(2), area_ha: +(f.area_ha || 0).toFixed(4), perimetro_m: +(f.perimeter_m || 0).toFixed(2) } : {}),
            fonte_gnss: f.coords[0]?.source || ''
          },
          geometry
        };
      })
    };
    return JSON.stringify(geo, null, 2);
  }
  async function exportGeoJSON(features) {
    await saveAndShare(`levantamento-${ts()}.geojson`, toGeoJSON(features), false);
  }

  // ---------- KML ----------
  function styleForType(type) {
    if (type === 'point') return `<Style id="pt"><IconStyle><color>ff52a31f</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
    if (type === 'line') return `<Style id="ln"><LineStyle><color>ffa37e0f</color><width>4</width></LineStyle></Style>`;
    return `<Style id="pg"><LineStyle><color>ff0c41c2</color><width>3</width></LineStyle><PolyStyle><color>4d0c41c2</color></PolyStyle></Style>`;
  }
  function kmlPlacemark(f) {
    const desc = `Categoria: ${f.category || '-'}\nObservações: ${f.notes || '-'}\nData: ${new Date(f.timestamp).toLocaleString('pt-BR')}`;
    let geom;
    if (f.type === 'point') {
      const c = f.coords[0];
      geom = `<Point><coordinates>${c.lng},${c.lat},${c.alt || 0}</coordinates></Point>`;
    } else if (f.type === 'line') {
      geom = `<LineString><tessellate>1</tessellate><coordinates>${f.coords.map(c => `${c.lng},${c.lat},${c.alt || 0}`).join(' ')}</coordinates></LineString>`;
    } else {
      const ring = [...f.coords, f.coords[0]];
      geom = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring.map(c => `${c.lng},${c.lat},${c.alt || 0}`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }
    const styleUrl = f.type === 'point' ? '#pt' : f.type === 'line' ? '#ln' : '#pg';
    return `<Placemark><name>${escapeXml(f.name)}</name><description>${escapeXml(desc)}</description><styleUrl>${styleUrl}</styleUrl>${geom}</Placemark>`;
  }
  function escapeXml(s) { return String(s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

  function toKML(features) {
    const styles = ['point', 'line', 'polygon'].map(styleForType).join('');
    const placemarks = features.map(kmlPlacemark).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>Levantamento de Campo GNSS</name>
${styles}
<Folder><name>Feições (${features.length})</name>
${placemarks}
</Folder>
</Document>
</kml>`;
  }
  async function exportKML(features) {
    await saveAndShare(`levantamento-${ts()}.kml`, toKML(features), false);
  }
  async function exportKMZ(features) {
    const kml = toKML(features);
    const zip = new JSZip();
    zip.file('doc.kml', kml);
    const blob = await zip.generateAsync({ type: 'blob' });
    await saveAndShare(`levantamento-${ts()}.kmz`, blob, false);
  }

  // ---------- GPX ----------
  function toGPX(features) {
    const wpts = [], trks = [];
    features.forEach(f => {
      if (f.type === 'point') {
        const c = f.coords[0];
        wpts.push(`<wpt lat="${c.lat}" lon="${c.lng}">${c.alt != null ? `<ele>${c.alt}</ele>` : ''}<time>${new Date(f.timestamp).toISOString()}</time><name>${escapeXml(f.name)}</name><desc>${escapeXml(f.category || '')}</desc></wpt>`);
      } else {
        const pts = f.coords.map(c => `<trkpt lat="${c.lat}" lon="${c.lng}">${c.alt != null ? `<ele>${c.alt}</ele>` : ''}</trkpt>`).join('');
        trks.push(`<trk><name>${escapeXml(f.name)}</name><desc>${escapeXml(f.type === 'polygon' ? 'Polígono' : 'Linha')}</desc><trkseg>${pts}${f.type === 'polygon' ? `<trkpt lat="${f.coords[0].lat}" lon="${f.coords[0].lng}"></trkpt>` : ''}</trkseg></trk>`);
      }
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GNSS Campo" xmlns="http://www.topografix.com/GPX/1/1">
${wpts.join('\n')}
${trks.join('\n')}
</gpx>`;
  }
  async function exportGPX(features) {
    await saveAndShare(`levantamento-${ts()}.gpx`, toGPX(features), false);
  }

  // ---------- SHP (Shapefile, via shpwrite/@mapbox) ----------
  // Um único .shp só suporta um tipo de geometria; o shpwrite separa automaticamente
  // pontos/linhas/polígonos presentes na coleção e agrupa tudo num único .zip.
  async function exportSHP(features) {
    const gj = JSON.parse(toGeoJSON(features));
    const blob = await shpwrite.zip(gj, {
      outputType: 'blob',
      types: { point: 'pontos', polyline: 'linhas', polygon: 'poligonos' }
    });
    await saveAndShare(`levantamento-shp-${ts()}.zip`, blob, false);
  }

  return { exportCSV, exportGeoJSON, exportKML, exportKMZ, exportGPX, exportSHP, saveAndShare };
})();
