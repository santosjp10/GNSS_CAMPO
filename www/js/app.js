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
      if (!mapInited) {
        MapModule.init('map');
        mapInited = true;
        refreshTileCount();
        MapModule.getMap().on('click', onMapClickInsert);
      }
      setTimeout(() => { MapModule.invalidateSize(); MapModule.drawAll(features); MapModule.updateDraft(mode, draft); }, 50);
      document.getElementById('mapModeBadge').textContent = 'Modo: ' + MODE_LABELS[mode];
      document.getElementById('mapCollectInfo').classList.toggle('hidden', mode === 'point' || !draft.length);
      document.getElementById('btnMapUndo').classList.toggle('hidden', mode === 'point' || !draft.length);
      document.getElementById('btnMapFinish').classList.toggle('hidden', mode === 'point' || draft.length < (mode === 'line' ? 2 : 3));
      document.getElementById('btnMapCapture').textContent = mode === 'point' ? '📍' : '➕';
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
    else if (acc <= settings.minAccuracy) { badge.className = 'gnss-badge ok'; text.textContent = `±${fmtAccuracy(acc)}m`; }
    else { badge.className = 'gnss-badge warn'; text.textContent = `±${fmtAccuracy(acc)}m (baixa)`; }
  }

  function fmtAccuracy(v) {
    if (v == null) return '--';
    if (v < 1) return v.toFixed(3);   // precisão centimétrica (RTK) — mostra mm/cm
    return v.toFixed(2);
  }

  // ---------- Painel de posição ----------
  function updatePositionPanel(fix) {
    if (!fix) return;
    document.getElementById('posAccuracy').textContent = fmtAccuracy(fix.accuracy);
    const vAcc = fix.vAccuracy != null ? fix.vAccuracy : (fix.altAccuracy != null ? fix.altAccuracy : null);
    document.getElementById('posVAccuracy').textContent = fmtAccuracy(vAcc);
    document.getElementById('posSats').textContent = fix.satellites != null
      ? (fix.satellitesInView != null ? `${fix.satellites}/${fix.satellitesInView}` : fix.satellites)
      : '--';
    document.getElementById('posLat').textContent = Geometry.fmtCoord(fix.lat) + '°';
    document.getElementById('posLng').textContent = Geometry.fmtCoord(fix.lng) + '°';
    document.getElementById('posAlt').textContent = fix.alt != null ? fix.alt.toFixed(1) + ' m' : '--';
    document.getElementById('posSource').textContent =
      fix.source === 'bluetooth' ? `Bluetooth (${fix.fixQualityLabel || '—'})` :
      fix.source === 'gnssmaster' ? `GNSS Master (${fix.fixQualityLabel || '—'})` :
      'GPS interno';
    const dopRow = document.getElementById('posDopRow');
    if (fix.hdop != null || fix.vdop != null) {
      dopRow.classList.remove('hidden');
      document.getElementById('posDop').textContent = `${fix.hdop != null ? fix.hdop.toFixed(1) : '--'} / ${fix.vdop != null ? fix.vdop.toFixed(1) : '--'}`;
    } else {
      dopRow.classList.add('hidden');
    }
    try {
      const utm = Geometry.toUTM(fix.lat, fix.lng);
      document.getElementById('posUtm').textContent = `${utm.x.toFixed(1)}, ${utm.y.toFixed(1)} (${utm.zone}${utm.hemisphere})`;
    } catch (e) { /* ignore */ }
  }

  GNSS.onStatus(info => {
    if (info.type === 'gnssmaster') {
      const badge = document.getElementById('tcpStatusBadge');
      if (badge) {
        badge.textContent = info.connected ? 'Conectado ✓' : (info.error ? `Falha: ${info.error}` : 'Desconectado');
        badge.classList.toggle('ok', info.connected);
        badge.classList.toggle('err', !info.connected && !!info.error);
      }
      if (info.connected) toast('Conectado ao GNSS Master', 'success');
      else if (info.error) toast('Falha ao conectar ao GNSS Master: ' + info.error, 'error');
    } else if (info.type === 'bluetooth') {
      const badge = document.getElementById('btStatusBadge');
      if (badge) {
        badge.textContent = info.connected ? 'Conectado ✓' : (info.error ? `Falha: ${info.error}` : 'Desconectado');
        badge.classList.toggle('ok', info.connected);
        badge.classList.toggle('err', !info.connected && !!info.error);
      }
    }
  });

  GNSS.on(fix => {
    updateGnssBadge(fix);
    updatePositionPanel(fix);
    if (mapInited && fix) MapModule.updatePosition(fix, currentView === 'mapa');
  });

  const MODE_LABELS = { point: 'Ponto', line: 'Linha', polygon: 'Polígono' };

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
    document.getElementById('vertexCount').textContent = draft.length;
    document.getElementById('mapCollectCount').textContent = draft.length;
    let measureText = '';
    if (mode === 'line') {
      measureText = Geometry.fmtDist(Geometry.lineLength(draft));
    } else if (mode === 'polygon') {
      const a = draft.length >= 3 ? Geometry.polygonArea(draft) : { area_m2: 0 };
      measureText = Geometry.fmtArea(a.area_m2);
    }
    document.getElementById('vertexMeasure').textContent = measureText;
    document.getElementById('mapCollectMeasure').textContent = measureText;

    document.getElementById('mapModeBadge').textContent = 'Modo: ' + MODE_LABELS[mode];
    document.getElementById('mapCollectInfo').classList.toggle('hidden', mode === 'point' || !draft.length);
    document.getElementById('btnMapUndo').classList.toggle('hidden', mode === 'point' || !draft.length);
    const min = mode === 'line' ? 2 : 3;
    document.getElementById('btnMapFinish').classList.toggle('hidden', mode === 'point' || draft.length < min);

    if (mapInited) MapModule.updateDraft(mode, draft);
  }

  function doUndo() { draft.pop(); renderDraft(); }
  function doCancelDraft() { draft = []; renderDraft(); if (mapInited) MapModule.clearDraft(); }

  document.getElementById('btnUndo').addEventListener('click', doUndo);
  document.getElementById('btnCancelDraft').addEventListener('click', doCancelDraft);
  document.getElementById('btnMapUndo').addEventListener('click', doUndo);

  // ---------- Captura (compartilhada entre aba Coletar e aba Mapa) ----------
  function doCapture() {
    const fix = GNSS.getLast();
    if (!fix) { toast('Aguardando sinal GNSS...', 'error'); return; }
    if (fix.accuracy != null && fix.accuracy > settings.minAccuracy) {
      toast(`Precisão atual (±${fmtAccuracy(fix.accuracy)}m) está abaixo do limite configurado`, 'error');
    }
    const coord = { lat: fix.lat, lng: fix.lng, alt: fix.alt, accuracy: fix.accuracy, source: fix.source };

    if (mode === 'point') {
      saveFeature('point', [coord]);
    } else {
      draft.push(coord);
      renderDraft();
      toast(`Vértice ${draft.length} adicionado`, 'success');
    }
  }

  function doFinish() {
    const min = mode === 'line' ? 2 : 3;
    if (draft.length < min) { toast(`Mínimo de ${min} vértices para ${mode === 'line' ? 'linha' : 'polígono'}`, 'error'); return; }
    saveFeature(mode, draft.slice());
    draft = [];
    renderDraft();
    if (mapInited) MapModule.clearDraft();
  }

  document.getElementById('btnCapture').addEventListener('click', doCapture);
  document.getElementById('btnCapture').addEventListener('contextmenu', e => e.preventDefault());
  document.getElementById('btnMapCapture').addEventListener('click', doCapture);

  document.getElementById('btnFinishFeature').addEventListener('click', doFinish);
  document.getElementById('btnMapFinish').addEventListener('click', doFinish);

  const modeObserver = () => {
    document.getElementById('vertexActions').classList.toggle('hidden', mode === 'point');
    document.getElementById('mapModeBadge').textContent = 'Modo: ' + MODE_LABELS[mode];
    document.getElementById('btnMapCapture').textContent = mode === 'point' ? '📍' : '➕';
  };
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
  let expandedId = null;   // id da feição concluída atualmente expandida para edição
  let editCoords = null;   // cópia mutável dos vértices em edição

  function renderFeatureList() {
    const listEl = document.getElementById('featList');
    document.getElementById('countPoints').textContent = features.filter(f => f.type === 'point').length;
    document.getElementById('countLines').textContent = features.filter(f => f.type === 'line').length;
    document.getElementById('countPolygons').textContent = features.filter(f => f.type === 'polygon').length;

    let html = '';

    // Feição em coleta (ainda não finalizada) — editável em tempo real
    if (draft.length && mode !== 'point') {
      const measure = mode === 'line' ? Geometry.fmtDist(Geometry.lineLength(draft)) : Geometry.fmtArea(draft.length >= 3 ? Geometry.polygonArea(draft).area_m2 : 0);
      html += `<div class="section-label">Em coleta agora (${mode === 'line' ? 'linha' : 'polígono'})</div>
        <div class="edit-panel">
          <div class="stat-strip" style="margin-bottom:10px">
            <div class="stat-chip"><div class="n">${draft.length}</div><div class="l">Vértices</div></div>
            <div class="stat-chip"><div class="n" style="font-size:13px">${measure}</div><div class="l">${mode === 'line' ? 'Comprimento' : 'Área'}</div></div>
          </div>
          <div class="vertex-list" id="draftVertexList"></div>
          ${!draft.length ? '<p class="empty" style="padding:10px 0"><span style="font-size:12.5px">Volte à aba Coletar para adicionar vértices.</span></p>' : ''}
        </div>`;
    }

    if (!features.length && !(draft.length && mode !== 'point')) {
      listEl.innerHTML = `<div class="empty"><div class="ic">📭</div><p>Nenhuma feição coletada ainda.<br>Vá até a aba Coletar para começar.</p></div>`;
      return;
    }

    const icon = { point: '📍', line: '📏', polygon: '⬟' };
    features.slice().reverse().forEach(f => {
      const meta = f.type === 'point'
        ? `${f.category || '-'} · ${new Date(f.timestamp).toLocaleString('pt-BR')}`
        : f.type === 'line'
          ? `${Geometry.fmtDist(f.length_m || 0)} · ${f.coords.length} vértices`
          : `${Geometry.fmtArea(f.area_m2 || 0)} · ${f.coords.length} vértices`;
      html += `<div class="feat-item" data-id="${f.id}" data-expandable="${f.type !== 'point'}">
        <div class="feat-icon ${f.type}">${icon[f.type]}</div>
        <div class="feat-body"><div class="feat-name">${escapeHtml(f.name)}</div><div class="feat-meta">${meta}</div></div>
        <button class="feat-del" data-id="${f.id}">✕</button>
      </div>`;
      if (f.id === expandedId && editCoords) {
        html += `<div class="edit-panel" id="editPanel">
          <div class="vertex-list" id="editVertexList"></div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="btnSaveEdit">Salvar alterações</button>
          </div>
        </div>`;
      }
    });

    listEl.innerHTML = html;

    if (draft.length && mode !== 'point') renderVertexEditor('draftVertexList', draft, null);
    if (expandedId && editCoords) renderVertexEditor('editVertexList', editCoords, expandedId);

    listEl.querySelectorAll('.feat-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.feat-del')) return;
        const id = item.dataset.id;
        if (item.dataset.expandable !== 'true') return;
        if (expandedId === id) { expandedId = null; editCoords = null; }
        else {
          const f = features.find(x => x.id === id);
          expandedId = id;
          editCoords = f.coords.map(c => ({ ...c }));
        }
        renderFeatureList();
      });
    });
    listEl.querySelectorAll('.feat-del').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.id === expandedId) { expandedId = null; editCoords = null; }
      features = Storage.deleteFeature(btn.dataset.id);
      renderFeatureList();
      if (mapInited) MapModule.drawAll(features);
    }));
    const cancelBtn = document.getElementById('btnCancelEdit');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { expandedId = null; editCoords = null; renderFeatureList(); });
    const saveBtn = document.getElementById('btnSaveEdit');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const min = features.find(f => f.id === expandedId)?.type === 'line' ? 2 : 3;
      if (editCoords.length < min) { toast(`Mínimo de ${min} vértices`, 'error'); return; }
      const list = Storage.getFeatures();
      const f = list.find(x => x.id === expandedId);
      f.coords = editCoords;
      if (f.type === 'line') { f.length_m = Geometry.lineLength(f.coords); }
      if (f.type === 'polygon') {
        const a = Geometry.polygonArea(f.coords);
        f.area_m2 = a.area_m2; f.area_ha = a.area_ha; f.perimeter_m = a.perimeter_m; f.utm_zone = a.zone;
      }
      Storage.saveFeatures(list);
      features = list;
      expandedId = null; editCoords = null;
      toast('Feição atualizada', 'success');
      renderFeatureList();
      if (mapInited) MapModule.drawAll(features);
    });
  }

  // Renderiza uma lista de vértices editável (reordenar / excluir) dentro do container informado.
  // targetArray é a referência mutável (draft ou editCoords); se editingFeatureId for null, é a coleta em andamento.
  function renderVertexEditor(containerId, targetArray, editingFeatureId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = targetArray.map((c, i) => `
      <div class="vertex-item">
        <div class="vn">${i + 1}</div>
        <div class="vc">${Geometry.fmtCoord(c.lat)}, ${Geometry.fmtCoord(c.lng)}</div>
        <button class="vbtn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="vbtn" data-act="down" data-i="${i}" ${i === targetArray.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="vbtn danger" data-act="del" data-i="${i}">✕</button>
      </div>`).join('');
    el.querySelectorAll('.vbtn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.i, 10);
      const act = btn.dataset.act;
      if (act === 'up' && i > 0) { [targetArray[i - 1], targetArray[i]] = [targetArray[i], targetArray[i - 1]]; }
      else if (act === 'down' && i < targetArray.length - 1) { [targetArray[i + 1], targetArray[i]] = [targetArray[i], targetArray[i + 1]]; }
      else if (act === 'del') { targetArray.splice(i, 1); }
      if (editingFeatureId === null) renderDraft();
      renderFeatureList();
    }));
  }

  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (!features.length) return;
    if (confirm('Apagar todas as feições coletadas? Esta ação não pode ser desfeita.')) {
      Storage.clearAll();
      features = [];
      expandedId = null; editCoords = null;
      renderFeatureList();
      if (mapInited) MapModule.drawAll(features);
      toast('Todos os dados foram apagados');
    }
  });
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Aba Exportar ----------
  let selectedExportIds = new Set();
  let knownExportIds = new Set();

  function renderExportSummary() {
    const currentIds = new Set(features.map(f => f.id));
    // feições novas entram selecionadas por padrão
    for (const id of currentIds) if (!knownExportIds.has(id)) { selectedExportIds.add(id); knownExportIds.add(id); }
    // feições removidas saem do controle de seleção
    for (const id of [...knownExportIds]) if (!currentIds.has(id)) { knownExportIds.delete(id); selectedExportIds.delete(id); }

    const listEl = document.getElementById('exportFeatList');
    if (!features.length) {
      listEl.innerHTML = `<div class="empty" style="padding:20px 10px"><div class="ic">📭</div><p>Nenhuma feição coletada ainda.</p></div>`;
    } else {
      const icon = { point: '📍', line: '📏', polygon: '⬟' };
      listEl.innerHTML = features.slice().reverse().map(f => {
        const meta = f.type === 'point' ? (f.category || '-')
          : f.type === 'line' ? Geometry.fmtDist(f.length_m || 0)
          : Geometry.fmtArea(f.area_m2 || 0);
        const checked = selectedExportIds.has(f.id);
        return `<div class="export-feat-item" data-id="${f.id}">
          <div class="export-checkbox ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</div>
          <div class="efi-icon">${icon[f.type]}</div>
          <div class="efi-body"><div class="efi-name">${escapeHtml(f.name)}</div><div class="efi-meta">${meta}</div></div>
        </div>`;
      }).join('');
      listEl.querySelectorAll('.export-feat-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          if (selectedExportIds.has(id)) selectedExportIds.delete(id); else selectedExportIds.add(id);
          renderExportSummary();
        });
      });
    }

    const selected = features.filter(f => selectedExportIds.has(f.id));
    document.getElementById('expTotal').textContent = selected.length;
    document.getElementById('expPoints').textContent = selected.filter(f => f.type === 'point').length;
    document.getElementById('expLines').textContent = selected.filter(f => f.type === 'line').length;
    document.getElementById('expPolygons').textContent = selected.filter(f => f.type === 'polygon').length;
  }
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    selectedExportIds = new Set(features.map(f => f.id));
    renderExportSummary();
  });
  document.getElementById('btnSelectNone').addEventListener('click', () => {
    selectedExportIds = new Set();
    renderExportSummary();
  });

  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const selected = features.filter(f => selectedExportIds.has(f.id));
      if (!selected.length) { toast('Selecione ao menos uma feição para exportar', 'error'); return; }
      const fmt = btn.dataset.fmt;
      toast('Gerando arquivo...');
      try {
        if (fmt === 'geojson') await Exporters.exportGeoJSON(selected);
        else if (fmt === 'kml') await Exporters.exportKML(selected);
        else if (fmt === 'kmz') await Exporters.exportKMZ(selected);
        else if (fmt === 'csv') await Exporters.exportCSV(selected);
        else if (fmt === 'gpx') await Exporters.exportGPX(selected);
        else if (fmt === 'shp') await Exporters.exportSHP(selected);
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

  // ---------- Edição direta no mapa (inserir por toque / mover por arraste) ----------
  let mapEditMode = false;
  document.getElementById('btnMapEdit').addEventListener('click', () => {
    mapEditMode = !mapEditMode;
    document.getElementById('btnMapEdit').classList.toggle('active', mapEditMode);
    document.getElementById('mapEditHint').classList.toggle('hidden', !mapEditMode);
    MapModule.setEditable(mapEditMode, handleVertexMoved);
    MapModule.drawAll(features);
    MapModule.updateDraft(mode, draft);
    toast(mapEditMode ? 'Edição no mapa ativada' : 'Edição no mapa desativada');
  });

  function onMapClickInsert(e) {
    if (!mapEditMode) return;
    const coord = { lat: e.latlng.lat, lng: e.latlng.lng, alt: null, accuracy: null, source: 'manual' };
    if (mode === 'point') {
      saveFeature('point', [coord]);
      toast('Ponto inserido manualmente', 'success');
    } else {
      draft.push(coord);
      renderDraft();
      toast(`Vértice ${draft.length} inserido manualmente`, 'success');
    }
  }

  // Chamado quando o usuário arrasta um vértice de uma feição já salva (featureId) para uma nova posição.
  function handleVertexMoved(featureId, vertexIndex, newLatLng) {
    if (!featureId) return; // vértice do rascunho — já foi atualizado internamente pelo map.js
    const list = Storage.getFeatures();
    const f = list.find(x => x.id === featureId);
    if (!f) return;
    f.coords[vertexIndex] = { ...f.coords[vertexIndex], lat: newLatLng.lat, lng: newLatLng.lng };
    if (f.type === 'line') f.length_m = Geometry.lineLength(f.coords);
    if (f.type === 'polygon') {
      const a = Geometry.polygonArea(f.coords);
      f.area_m2 = a.area_m2; f.area_ha = a.area_ha; f.perimeter_m = a.perimeter_m; f.utm_zone = a.zone;
    }
    Storage.saveFeatures(list);
    features = list;
    toast('Posição atualizada', 'success');
    if (currentView === 'dados') renderFeatureList();
    if (currentView === 'exportar') renderExportSummary();
  }
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
    document.getElementById('swGnssMaster').classList.toggle('on', settings.gnssSource === 'gnssmaster');
    document.getElementById('btDeviceSection').classList.toggle('hidden', settings.gnssSource !== 'bluetooth');
    document.getElementById('tcpConfigSection').classList.toggle('hidden', settings.gnssSource !== 'gnssmaster');
    document.getElementById('tcpHost').value = settings.tcpHost || '127.0.0.1';
    document.getElementById('tcpPort').value = settings.tcpPort || '';
    const tcpBadge = document.getElementById('tcpStatusBadge');
    tcpBadge.textContent = GNSS.isTcpConnected() ? 'Conectado ✓' : 'Desconectado';
    tcpBadge.classList.toggle('ok', GNSS.isTcpConnected());
    const btBadge = document.getElementById('btStatusBadge');
    btBadge.textContent = GNSS.isBluetoothConnected() ? 'Conectado ✓' : 'Desconectado';
    btBadge.classList.toggle('ok', GNSS.isBluetoothConnected());
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

  document.querySelectorAll('#swInternal, #swBluetooth, #swGnssMaster').forEach(sw => {
    sw.addEventListener('click', () => {
      const src = sw.dataset.src;
      settings.gnssSource = src;
      Storage.saveSettings(settings);
      document.getElementById('swInternal').classList.toggle('on', src === 'internal');
      document.getElementById('swBluetooth').classList.toggle('on', src === 'bluetooth');
      document.getElementById('swGnssMaster').classList.toggle('on', src === 'gnssmaster');
      document.getElementById('btDeviceSection').classList.toggle('hidden', src !== 'bluetooth');
      document.getElementById('tcpConfigSection').classList.toggle('hidden', src !== 'gnssmaster');
      if (src === 'internal') { GNSS.disconnectBluetooth(); GNSS.disconnectTcp(); GNSS.start('internal'); toast('Usando GPS interno'); }
      else if (src === 'bluetooth') { GNSS.stop(); toast('Selecione um dispositivo Bluetooth pareado'); }
      else { GNSS.stop(); toast('Informe a porta configurada no GNSS Master e conecte'); }
    });
  });

  document.getElementById('btnTcpConnect').addEventListener('click', async () => {
    const host = document.getElementById('tcpHost').value.trim() || '127.0.0.1';
    const port = parseInt(document.getElementById('tcpPort').value, 10);
    if (!port) { toast('Informe a porta TCP configurada no GNSS Master', 'error'); return; }
    settings.tcpHost = host;
    settings.tcpPort = port;
    Storage.saveSettings(settings);
    const badge = document.getElementById('tcpStatusBadge');
    badge.textContent = 'Conectando...';
    badge.classList.remove('ok', 'err');
    try {
      await GNSS.connectTcp(host, port);
      toast('Conectando ao GNSS Master...');
    } catch (e) {
      badge.textContent = 'Falha: ' + (e.message || e);
      badge.classList.add('err');
      toast('Falha ao conectar: ' + (e.message || e), 'error');
    }
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
    try { GNSS.start('internal'); } catch (e) { toast('Ative a localização para usar o GNSS'); }
    // Nota: se gnssSource for 'bluetooth' ou 'gnssmaster', o usuário precisa reconectar manualmente
    // na aba Config a cada abertura do app (seleção de dispositivo pareado ou host/porta TCP).
    modeObserver();
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
