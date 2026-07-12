// gnss.js — fonte de posição: GPS interno do celular OU receptor externo via Bluetooth (NMEA 0183)
const GNSS = (() => {
  let watchId = null;
  let listeners = [];
  let lastFix = null;
  let source = 'internal';
  let btConnected = false;
  let nmeaBuffer = '';

  const FIX_QUALITY = {
    0: 'Sem fixação', 1: 'GPS simples', 2: 'DGPS', 4: 'RTK fixo', 5: 'RTK flutuante', 6: 'Estimado'
  };

  function on(cb) { listeners.push(cb); }
  function emit() { listeners.forEach(cb => cb(lastFix)); }

  function getLast() { return lastFix; }
  function getSource() { return source; }
  function isBluetoothConnected() { return btConnected; }

  // ---------- GPS interno ----------
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
        satellites: null,
        fixQuality: null,
        hdop: null,
        source: 'internal',
        timestamp: pos.timestamp
      };
      emit();
    }, err => {
      console.error('Erro GPS interno:', err);
    }, { enableHighAccuracy: true, maximumAge: 500, timeout: 20000 });
  }

  function stop() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (btConnected) disconnectBluetooth();
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
        resolve();
      }, err => reject(err));
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
    lines.forEach(parseNMEA);
  }

  // ---------- Parser NMEA 0183 ----------
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

  function parseNMEA(line) {
    line = line.trim();
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
        lastFix = {
          lat, lng, alt: isNaN(alt) ? null : alt,
          accuracy: !isNaN(hdop) ? +(hdop * 3).toFixed(2) : null, // estimativa aproximada (HDOP x erro base 3m)
          altAccuracy: null, speed: lastFix?.speed ?? null, heading: lastFix?.heading ?? null,
          satellites: isNaN(sats) ? null : sats,
          fixQuality: isNaN(quality) ? null : quality,
          fixQualityLabel: FIX_QUALITY[quality] || '—',
          hdop: isNaN(hdop) ? null : hdop,
          source: 'bluetooth',
          timestamp: Date.now()
        };
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
    else startInternal();
  }

  return {
    on, start, stop, getLast, getSource, isBluetoothConnected,
    listPairedDevices, connectBluetooth, disconnectBluetooth, btAvailable,
    FIX_QUALITY
  };
})();
