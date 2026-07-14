// gnss.js — fonte de posição: GPS interno, receptor externo via Bluetooth (NMEA) ou via TCP local (ex.: app GNSS Master)
const GNSS = (() => {
  let watchId = null;
  let listeners = [];
  let lastFix = null;
  let source = 'internal';
  let btConnected = false;
  let tcpConnected = false;
  let nmeaBuffer = '';

  const FIX_QUALITY = {
    0: 'Sem fixação', 1: 'GPS simples', 2: 'DGPS', 4: 'RTK fixo', 5: 'RTK flutuante', 6: 'Estimado'
  };

  function on(cb) { listeners.push(cb); }
  function emit() { listeners.forEach(cb => cb(lastFix)); }

  let statusListeners = [];
  function onStatus(cb) { statusListeners.push(cb); }
  function emitStatus(info) { statusListeners.forEach(cb => cb(info)); }

  function getLast() { return lastFix; }
  function getSource() { return source; }
  function isBluetoothConnected() { return btConnected; }
  function isTcpConnected() { return tcpConnected; }

  // ---------- GPS interno ----------
  let satListenerHandle = null;
  function nativeGnssStatus() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GnssStatus;
  }
  async function startSatelliteListener() {
    const plugin = nativeGnssStatus();
    if (!plugin) return; // indisponível fora do app compilado (ex.: navegador de teste)
    try {
      satListenerHandle = await plugin.addListener('gnssStatusChange', data => {
        if (lastFix && lastFix.source === 'internal') {
          lastFix.satellites = data.satellitesUsed;
          lastFix.satellitesInView = data.satellitesInView;
          emit();
        }
      });
      await plugin.startListening();
    } catch (e) { console.warn('GnssStatus indisponível:', e); }
  }
  async function stopSatelliteListener() {
    const plugin = nativeGnssStatus();
    if (!plugin) return;
    try {
      if (satListenerHandle) { satListenerHandle.remove(); satListenerHandle = null; }
      await plugin.stopListening();
    } catch (e) { /* ignore */ }
  }

  function startInternal() {
    stop();
    source = 'internal';
    if (!navigator.geolocation) { throw new Error('Geolocalização não disponível neste dispositivo'); }
    watchId = navigator.geolocation.watchPosition(pos => {
      lastFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        alt: pos.coords.altitude,
        accuracy: pos.coords.accuracy,
        altAccuracy: pos.coords.altitudeAccuracy,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        satellites: lastFix?.source === 'internal' ? lastFix.satellites : null,
        satellitesInView: lastFix?.source === 'internal' ? lastFix.satellitesInView : null,
        fixQuality: null,
        hdop: null,
        source: 'internal',
        timestamp: pos.timestamp
      };
      emit();
    }, err => {
      console.error('Erro GPS interno:', err);
    }, { enableHighAccuracy: true, maximumAge: 500, timeout: 20000 });
    startSatelliteListener();
  }

  function stop() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    stopSatelliteListener();
    if (btConnected) disconnectBluetooth();
    if (tcpConnected) disconnectTcp();
  }

  // ---------- Bluetooth Classic SPP (cordova-plugin-bluetooth-serial) ----------
  function btAvailable() {
    return typeof window.bluetoothSerial !== 'undefined';
  }

  function listPairedDevices() {
    return new Promise((resolve, reject) => {
      if (!btAvailable()) { reject(new Error('Plugin Bluetooth indisponível (só funciona no app compilado)')); return; }
      window.bluetoothSerial.list(resolve, reject);
    });
  }

  function connectBluetooth(address) {
    return new Promise((resolve, reject) => {
      if (!btAvailable()) { reject(new Error('Plugin Bluetooth indisponível (só funciona no app compilado)')); return; }
      stop();
      source = 'bluetooth';
      window.bluetoothSerial.connect(address, () => {
        btConnected = true;
        nmeaBuffer = '';
        window.bluetoothSerial.subscribe('\n', onBtData, err => console.error('BT subscribe erro:', err));
        emitStatus({ type: 'bluetooth', connected: true, error: null });
        resolve();
      }, err => { emitStatus({ type: 'bluetooth', connected: false, error: String(err) }); reject(err); });
    });
  }

  function disconnectBluetooth() {
    if (btAvailable() && btConnected) {
      window.bluetoothSerial.unsubscribe(() => {}, () => {});
      window.bluetoothSerial.disconnect(() => {}, () => {});
    }
    btConnected = false;
  }

  function onBtData(data) {
    nmeaBuffer += data;
    const lines = nmeaBuffer.split('\n');
    nmeaBuffer = lines.pop();
    lines.forEach(l => parseNMEA(l, 'bluetooth'));
  }

  // ---------- TCP local (ex.: app "GNSS Master" com Receiver Data Output = TCP Server) ----------
  // Útil para receptores conectados via USB-C/OTG: o GNSS Master lê o receptor e repassa o NMEA
  // por um socket TCP local, ao qual este app se conecta como cliente.
  let tcpListenersAdded = false;
  function tcpAvailable() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TcpNmea;
  }

  async function connectTcp(host, port) {
    const plugin = tcpAvailable();
    if (!plugin) throw new Error('Plugin TCP indisponível (só funciona no app compilado)');
    stop();
    source = 'gnssmaster';
    nmeaBuffer = '';

    if (!tcpListenersAdded) {
      await plugin.addListener('nmeaLine', data => parseNMEA(data.line, 'gnssmaster'));
      await plugin.addListener('tcpStatus', data => {
        tcpConnected = !!data.connected;
        if (!data.connected && data.error) console.warn('TCP GNSS Master:', data.error);
        emitStatus({ type: 'gnssmaster', connected: tcpConnected, error: data.error || null });
      });
      tcpListenersAdded = true;
    }
    await plugin.connect({ host: host || '127.0.0.1', port: Number(port) });
  }

  function disconnectTcp() {
    const plugin = tcpAvailable();
    if (plugin) plugin.disconnect();
    tcpConnected = false;
  }

  // ---------- Parser NMEA 0183 (compartilhado entre Bluetooth e TCP) ----------

  // Erro base típico (m) por tipo de fixação, usado como fallback quando o receptor não envia GST.
  // O HDOP/VDOP é um fator adimensional que multiplica esse erro base — usar 3m fixo para todos os
  // tipos (como antes) fazia uma solução RTK fixo aparecer com a mesma imprecisão de um GPS simples.
  const BASE_ERROR_BY_QUALITY = {
    0: null,  // sem fixação
    1: 2.5,   // GPS simples (autônomo)
    2: 1.0,   // DGPS
    4: 0.02,  // RTK fixo (~2 cm)
    5: 0.3,   // RTK flutuante (~30 cm)
    6: 3.0    // estimado / dead reckoning
  };

  function nmeaToDecimal(raw, hemi) {
    if (!raw) return null;
    const dotIdx = raw.indexOf('.');
    const degLen = dotIdx - 2;
    const deg = parseFloat(raw.slice(0, degLen));
    const min = parseFloat(raw.slice(degLen));
    let dec = deg + min / 60;
    if (hemi === 'S' || hemi === 'W') dec = -dec;
    return dec;
  }

  // Recalcula a estimativa de precisão (HDOP/VDOP x erro base da fixação atual) — só usada como
  // fallback; é sobrescrita por valores reais vindos da sentença GST quando o receptor os envia.
  function estimateAccuracy(fix) {
    const base = fix.fixQuality != null ? BASE_ERROR_BY_QUALITY[fix.fixQuality] : null;
    if (base == null) return;
    if (fix.hdop != null) fix.accuracy = +(fix.hdop * base).toFixed(3);
    if (fix.vdop != null) fix.vAccuracy = +(fix.vdop * base).toFixed(3);
  }

  function parseNMEA(line, fixSource) {
    line = (line || '').trim();
    if (!line.startsWith('$')) return;
    const body = line.split('*')[0];
    const f = body.split(',');
    const type = f[0].slice(3); // remove talker id (GP/GN/GA...)

    if (type === 'GGA' && f.length >= 10) {
      const lat = nmeaToDecimal(f[2], f[3]);
      const lng = nmeaToDecimal(f[4], f[5]);
      const quality = parseInt(f[6], 10);
      const sats = parseInt(f[7], 10);
      const hdop = parseFloat(f[8]);
      const alt = parseFloat(f[9]);
      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        const prev = lastFix;
        lastFix = {
          lat, lng, alt: isNaN(alt) ? null : alt,
          accuracy: null, vAccuracy: null, accuracySource: null,
          altAccuracy: null, speed: prev?.speed ?? null, heading: prev?.heading ?? null,
          satellites: isNaN(sats) ? null : sats,
          fixQuality: isNaN(quality) ? null : quality,
          fixQualityLabel: FIX_QUALITY[quality] || '—',
          hdop: isNaN(hdop) ? null : hdop,
          vdop: prev?.vdop ?? null,
          pdop: prev?.pdop ?? null,
          source: fixSource || 'bluetooth',
          timestamp: Date.now()
        };
        estimateAccuracy(lastFix);
        emit();
      }
    } else if (type === 'GSA' && f.length >= 18) {
      // Campos finais da GSA: ..., PDOP, HDOP, VDOP (checksum já removido de "body")
      const pdop = parseFloat(f[15]);
      const hdop = parseFloat(f[16]);
      const vdop = parseFloat(f[17]);
      if (lastFix) {
        if (!isNaN(pdop)) lastFix.pdop = pdop;
        if (!isNaN(hdop)) lastFix.hdop = hdop;
        if (!isNaN(vdop)) lastFix.vdop = vdop;
        if (lastFix.accuracySource !== 'gst') estimateAccuracy(lastFix);
        emit();
      }
    } else if (type === 'GST' && f.length >= 9) {
      // Sentença de estatística de ruído do próprio receptor — erro real (m), muito mais preciso
      // que a estimativa por HDOP. Sempre que presente, tem prioridade sobre o cálculo acima.
      const latErr = parseFloat(f[6]);
      const lonErr = parseFloat(f[7]);
      const altErr = parseFloat(f[8]);
      if (lastFix) {
        if (!isNaN(latErr) && !isNaN(lonErr)) {
          lastFix.accuracy = +Math.sqrt(latErr * latErr + lonErr * lonErr).toFixed(3);
          lastFix.accuracySource = 'gst';
        }
        if (!isNaN(altErr)) lastFix.vAccuracy = +altErr.toFixed(3);
        emit();
      }
    } else if (type === 'RMC' && f.length >= 8) {
      const speedKn = parseFloat(f[7]);
      const heading = parseFloat(f[8]);
      if (lastFix) {
        lastFix.speed = !isNaN(speedKn) ? speedKn * 0.514444 : lastFix.speed;
        lastFix.heading = !isNaN(heading) ? heading : lastFix.heading;
      }
    }
  }


  function start(src) {
    if (src === 'bluetooth') { source = 'bluetooth'; /* conexão feita via connectBluetooth() */ }
    else if (src === 'gnssmaster') { source = 'gnssmaster'; /* conexão feita via connectTcp() */ }
    else startInternal();
  }

  return {
    on, onStatus, start, stop, getLast, getSource, isBluetoothConnected, isTcpConnected,
    listPairedDevices, connectBluetooth, disconnectBluetooth, btAvailable,
    connectTcp, disconnectTcp, tcpAvailable,
    FIX_QUALITY
  };
})();
