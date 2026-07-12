// app.js — orquestra UI, captura de feições, mapa e navegação por abas
(() => {
  let settings = Storage.getSettings();
  let features = Storage.getFeatures();
  let mode = 'point'; // point | line | polygon
  let draft = []; // vértices em progresso (line/polygon)
  let currentView = 'coletar';
  let mapInited = false;

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------- Navegação por abas ----------
  const TAB_TITLES = { coletar: 'Coletar', mapa: 'Mapa', dados: 'Dados', exportar: 'Exportar', config: 'Configurações' };
  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.getElementById('topTitle').textContent = TAB_TITLES[name];

    if (name === 'mapa') {
      if (!mapInited) { MapModule.init('map'); mapInited = true; refreshTileCount(); }
      setTimeout(() => { MapModule.invalidateSize(); MapModule.drawAll(features); }, 50);
    }
    if (name === 'dados') renderFeatureList();
    if (name === 'exportar') renderExportSummary();
    if (name === 'config') renderConfig();
  }
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));

  // ---------- Badge de GNSS ----------
  function updateGnssBadge(fix) {
    const badge = document.getElementById('gnssBadge');
    const text = document.getElementById('gnssBadgeText');
    const dot = badge.querySelector('.gnss-dot');
    if (!fix) {
      badge.className = 'gnss-badge';
      text.textContent = 'Sem sinal';
      dot.classList.remove('pulse');
      return;
    }
    dot.classList.add('pulse');
    const acc = fix.accuracy;
    if (acc == null) { badge.className = 'gnss-badge warn'; text.textContent = 'Buscando...'; }
    else if (acc <= settings.minAccuracy) { badge.className = 'gnss-badge ok'; text.textContent = `±${acc.toFixed(1)}m`; }
    else { badge.className = 'gnss-badge warn'; text.textContent = `±${acc.toFixed(1)}m (baixa)`; }
  }

  // ---------- Painel de posição ----------
  function updatePositionPanel(fix) {
    if (!fix) return;
    document.getElementById('posAccuracy').textContent = fix.accuracy != null ? fix.accuracy.toFixed(1) : '--';
    document.getElementById('posSats').textContent = fix.satellites != null ? fix.satellites : '--';
    document.getElementById('posLat').textContent = Geometry.fmtCoord(fix.lat) + '°';
    document.getElementById('posLng').textContent = Geometry.fmtCoord(fix.lng) + '°';
    document.getElementById('posAlt').textContent = fix.alt != null ? fix.alt.toFixed(1) + ' m' : '--';
    document.getElementById('posSource').textContent = fix.source === 'bluetooth' ? `Bluetooth (${fix.fixQualityLabel || '—'})` : 'GPS interno';
    try {
      const utm = Geometry.toUTM(fix.lat, fix.lng);
      document.getElementById('posUtm').textContent = `${utm.x.toFixed(1)}, ${utm.y.toFixed(1)} (${utm.zone}${utm.hemisphere})`;
    } catch (e) { /* ignore */ }
  }

  GNSS.on(fix => {
    updateGnssBadge(fix);
    updatePositionPanel(fix);
    if (mapInited && fix) MapModule.updatePosition(fix, currentView === 'mapa');
  });

  // ---------- Modo de captura ----------
  document.querySelectorAll('.mode-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      if (draft.length) { toast('Finalize ou cancele a feição atual antes de trocar o modo', 'error'); return; }
      mode = opt.dataset.mode;
      document.querySelectorAll('.mode-opt').forEach(o => o.classList.toggle('active', o === opt));
      document.getElementById('vertexSection').classList.toggle('hidden', mode === 'point');
      document.getElementById('vertexMeasureLabel').textContent = mode === 'line' ? 'Comprimento' : 'Área';
      document.getElementById('btnCapture').textContent = mode === 'point' ? 'Marcar ponto aqui' : 'Adicionar vértice aqui';
      renderDraft();
    });
  });

  function renderDraft() {
    const list = document.getElementById('vertexList');
    list.innerHTML = draft.map((c, i) => `
      <div class="vertex-item"><div class="vn">${i + 1}</div><div class="vc">${Geometry.fmtCoord(c.lat)}, ${Geometry.fmtCoord(c.lng)}</div></div>
    `).join('');
    document.getElementById('vertexCount').textContent = draft.length;
    if (mode === 'line') {
      document.getElementById('vertexMeasure').textContent = Geometry.fmtDist(Geometry.lineLength(draft));
    } else if (mode === 'polygon') {
      const a = draft.length >= 3 ? Geometry.polygonArea(draft) : { area_m2: 0 };
      document.getElementById('vertexMeasure').textContent = Geometry.fmtArea(a.area_m2);
    }
  }

  document.getElementById('btnUndo').addEventListener('click', () => { draft.pop(); renderDraft(); });
  document.getElementById('btnCancelDraft').addEventListener('click', () => { draft = []; renderDraft(); });

  // ---------- Captura ----------
  document.getElementById('btnCapture').addEventListener('click', () => {
    const fix = GNSS.getLast();
    if (!fix) { toast('Aguardando sinal GNSS...', 'error'); return; }
    if (fix.accuracy != null && fix.accuracy > settings.minAccuracy) {
      toast(`Precisão atual (±${fix.accuracy.toFixed(1)}m) está abaixo do limite configurado`, 'error');
    }
    const coord = { lat: fix.lat, lng: fix.lng, alt: fix.alt, accuracy: fix.accuracy, source: fix.source };

    if (mode === 'point') {
      saveFeature('point', [coord]);
    } else {
      draft.push(coord);
      renderDraft();
      toast(`Vértice ${draft.length} adicionado`, 'success');
    }
  });

  document.getElementById('btnCapture').addEventListener('contextmenu', e => e.preventDefault());

  // Botão de finalizar feição (linha/polígono) — reaproveita o botão principal com toque longo? Melhor: botão dedicado
  function addFinishButton() {
    const metaCard = document.getElementById('metaCard');
    const finishBtn = document.createElement('button');
    finishBtn.className = 'btn btn-outline';
    finishBtn.id = 'btnFinishFeature';
    finishBtn.textContent = 'Finalizar feição';
    finishBtn.style.marginBottom = '10px';
    finishBtn.addEventListener('click', () => {
      const min = mode === 'line' ? 2 : 3;
      if (draft.length < min) { toast(`Mínimo de ${min} vértices para ${mode === 'line' ? 'linha' : 'polígono'}`, 'error'); return; }
      saveFeature(mode, draft.slice());
      draft = [];
      renderDraft();
    });
    metaCard.parentNode.insertBefore(finishBtn, document.getElementById('btnCapture'));
  }
  addFinishButton();
  document.getElementById('btnFinishFeature').style.display = 'none';
  const modeObserver = () => { document.getElementById('btnFinishFeature').style.display = mode === 'point' ? 'none' : 'block'; };
  document.querySelectorAll('.mode-opt').forEach(o => o.addEventListener('click', modeObserver));

  function saveFeature(type, coords) {
    const name = document.getElementById('fName').value.trim() || defaultName(type);
    const category = document.getElementById('fCategory').value;
    const notes = document.getElementById('fNotes').value.trim();
    const f = { id: Storage.uid(), type, name, category, notes, coords, timestamp: Date.now() };

    if (type === 'line') f.length_m = Geometry.lineLength(coords);
    if (type === 'polygon') {
      const a = Geometry.polygonArea(coords);
      f.area_m2 = a.area_m2; f.area_ha = a.area_ha; f.perimeter_m = a.perimeter_m; f.utm_zone = a.zone;
    }

    features = Storage.addFeature(f);
    document.getElementById('fName').value = '';
    document.getElementById('fNotes').value = '';
    toast('Feição salva com sucesso', 'success');
    if (mapInited) MapModule.drawAll(features);
  }

  function defaultName(type) {
    const n = features.filter(f => f.type === type).length + 1;
    return (type === 'point' ? 'Ponto ' : type === 'line' ? 'Linha ' : 'Polígono ') + n;
  }

  // ---------- Aba Dados ----------
  function renderFeatureList() {
    const listEl = document.getElementById('featList');
    document.getElementById('countPoints').textContent = features.filter(f => f.type === 'point').length;
    document.getElementById('countLines').textContent = features.filter(f => f.type === 'line').length;
    document.getElementById('countPolygons').textContent = features.filter(f => f.type === 'polygon').length;

    if (!features.length) {
      listEl.innerHTML = `<div class="empty"><div class="ic">📭</div><p>Nenhuma feição coletada ainda.<br>Vá até a aba Coletar para começar.</p></div>`;
      return;
    }
    const icon = { point: '📍', line: '📏', polygon: '⬟' };
    listEl.innerHTML = features.slice().reverse().map(f => {
      const meta = f.type === 'point'
        ? `${f.category || '-'} · ${new Date(f.timestamp).toLocaleString('pt-BR')}`
        : f.type === 'line'
          ? `${Geometry.fmtDist(f.length_m || 0)} · ${f.coords.length} vértices`
          : `${Geometry.fmtArea(f.area_m2 || 0)} · ${f.coords.length} vértices`;
      return `<div class="feat-item">
        <div class="feat-icon ${f.type}">${icon[f.type]}</div>
        <div class="feat-body"><div class="feat-name">${escapeHtml(f.name)}</div><div class="feat-meta">${meta}</div></div>
        <button class="feat-del" data-id="${f.id}">✕</button>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.feat-del').forEach(btn => btn.addEventListener('click', () => {
      features = Storage.deleteFeature(btn.dataset.id);
      renderFeatureList();
      if (mapInited) MapModule.drawAll(features);
    }));
  }
  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (!features.length) return;
    if (confirm('Apagar todas as feições coletadas? Esta ação não pode ser desfeita.')) {
      Storage.clearAll();
      features = [];
      renderFeatureList();
      if (mapInited) MapModule.drawAll(features);
      toast('Todos os dados foram apagados');
    }
  });
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Aba Exportar ----------
  function renderExportSummary() {
    document.getElementById('expTotal').textContent = features.length;
    document.getElementById('expPoints').textContent = features.filter(f => f.type === 'point').length;
    document.getElementById('expLines').textContent = features.filter(f => f.type === 'line').length;
    document.getElementById('expPolygons').textContent = features.filter(f => f.type === 'polygon').length;
  }
  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!features.length) { toast('Nenhuma feição para exportar', 'error'); return; }
      const fmt = btn.dataset.fmt;
      toast('Gerando arquivo...');
      try {
        if (fmt === 'geojson') await Exporters.exportGeoJSON(features);
        else if (fmt === 'kml') await Exporters.exportKML(features);
        else if (fmt === 'kmz') await Exporters.exportKMZ(features);
        else if (fmt === 'csv') await Exporters.exportCSV(features);
        else if (fmt === 'gpx') await Exporters.exportGPX(features);
        else if (fmt === 'shp') await Exporters.exportSHP(features);
        toast('Arquivo pronto para compartilhar/salvar', 'success');
      } catch (e) {
        console.error(e);
        toast('Erro ao exportar: ' + e.message, 'error');
      }
    });
  });

  // ---------- Aba Mapa ----------
  document.getElementById('btnLayerSat').addEventListener('click', () => setBase('satellite', 'btnLayerSat'));
  document.getElementById('btnLayerStreets').addEventListener('click', () => setBase('streets', 'btnLayerStreets'));
  function setBase(name, activeBtnId) {
    MapModule.setBaseLayer(name);
    settings.baseLayer = name;
    Storage.saveSettings(settings);
    ['btnLayerSat', 'btnLayerStreets'].forEach(id => document.getElementById(id).classList.toggle('active', id === activeBtnId));
  }
  document.getElementById('btnFitAll').addEventListener('click', () => {
    if (!features.length) { toast('Nenhuma feição no mapa'); return; }
    MapModule.fitAll(features);
  });
  document.getElementById('btnLocate').addEventListener('click', () => MapModule.centerOnPosition(GNSS.getLast()));
  async function refreshTileCount() {
    const n = await MapModule.tileCacheCount();
    document.getElementById('tileCount').textContent = n;
    const cfgEl = document.getElementById('cfgTileCount');
    if (cfgEl) cfgEl.textContent = n;
  }
  setInterval(() => { if (currentView === 'mapa' || currentView === 'config') refreshTileCount(); }, 4000);

  // ---------- Aba Config ----------
  function renderConfig() {
    document.getElementById('cfgProject').value = settings.projectName || '';
    document.getElementById('cfgOperator').value = settings.operatorName || '';
    document.getElementById('cfgMinAccuracy').value = settings.minAccuracy;
    document.getElementById('swInternal').classList.toggle('on', settings.gnssSource === 'internal');
    document.getElementById('swBluetooth').classList.toggle('on', settings.gnssSource === 'bluetooth');
    document.getElementById('btDeviceSection').classList.toggle('hidden', settings.gnssSource !== 'bluetooth');
    refreshTileCount();
  }
  document.getElementById('cfgProject').addEventListener('change', e => { settings.projectName = e.target.value; Storage.saveSettings(settings); });
  document.getElementById('cfgOperator').addEventListener('change', e => { settings.operatorName = e.target.value; Storage.saveSettings(settings); });
  document.getElementById('cfgMinAccuracy').addEventListener('change', e => {
    settings.minAccuracy = parseFloat(e.target.value) || 15;
    Storage.saveSettings(settings);
  });
  document.getElementById('btnClearTiles').addEventListener('click', async () => {
    await MapModule.clearTileCache();
    toast('Cache de mapa limpo');
    refreshTileCount();
  });

  document.querySelectorAll('#swInternal, #swBluetooth').forEach(sw => {
    sw.addEventListener('click', () => {
      const src = sw.dataset.src;
      settings.gnssSource = src;
      Storage.saveSettings(settings);
      document.getElementById('swInternal').classList.toggle('on', src === 'internal');
      document.getElementById('swBluetooth').classList.toggle('on', src === 'bluetooth');
      document.getElementById('btDeviceSection').classList.toggle('hidden', src !== 'bluetooth');
      if (src === 'internal') { GNSS.disconnectBluetooth(); GNSS.start('internal'); toast('Usando GPS interno'); }
      else { GNSS.stop(); toast('Selecione um dispositivo Bluetooth pareado'); }
    });
  });

  document.getElementById('btnBtScan').addEventListener('click', async () => {
    try {
      const devices = await GNSS.listPairedDevices();
      const sel = document.getElementById('btDeviceList');
      sel.innerHTML = devices.length
        ? devices.map(d => `<option value="${d.address}">${escapeHtml(d.name)} (${d.address})</option>`).join('')
        : '<option value="">Nenhum dispositivo pareado encontrado</option>';
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  document.getElementById('btnBtConnect').addEventListener('click', async () => {
    const addr = document.getElementById('btDeviceList').value;
    if (!addr) { toast('Selecione um dispositivo', 'error'); return; }
    try {
      await GNSS.connectBluetooth(addr);
      toast('Receptor conectado', 'success');
    } catch (e) {
      toast('Falha ao conectar: ' + (e.message || e), 'error');
    }
  });

  // ---------- Inicialização ----------
  function init() {
    try { GNSS.start(settings.gnssSource === 'bluetooth' ? 'internal' : 'internal'); } catch (e) { toast('Ative a localização para usar o GNSS'); }
    // Nota: se gnssSource for 'bluetooth', o usuário precisa conectar manualmente na aba Config
    // pois requer seleção de dispositivo pareado.
    modeObserver();
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
