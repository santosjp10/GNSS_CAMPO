// storage.js — persistência local via localStorage (feições) + IndexedDB (tiles offline)
const Storage = (() => {
  const KEY_FEATURES = 'gnsscampo_features_v1';
  const KEY_SETTINGS = 'gnsscampo_settings_v1';

  function getFeatures() {
    try { return JSON.parse(localStorage.getItem(KEY_FEATURES)) || []; }
    catch (e) { return []; }
  }
  function saveFeatures(list) {
    localStorage.setItem(KEY_FEATURES, JSON.stringify(list));
  }
  function addFeature(f) {
    const list = getFeatures();
    list.push(f);
    saveFeatures(list);
    return list;
  }
  function deleteFeature(id) {
    const list = getFeatures().filter(f => f.id !== id);
    saveFeatures(list);
    return list;
  }
  function clearAll() {
    saveFeatures([]);
  }

  const DEFAULT_SETTINGS = {
    theme: 'light',
    coordFormat: 'geo', // geo | utm
    minAccuracy: 15,     // metros — alerta se pior que isso
    baseLayer: 'satellite',
    gnssSource: 'internal', // internal | bluetooth | gnssmaster
    tcpHost: '127.0.0.1',
    tcpPort: '',
    projectName: '',
    operatorName: ''
  };
  function getSettings() {
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}) }; }
    catch (e) { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings(s) {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  }

  function uid() {
    return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  return { getFeatures, saveFeatures, addFeature, deleteFeature, clearAll, getSettings, saveSettings, uid };
})();
