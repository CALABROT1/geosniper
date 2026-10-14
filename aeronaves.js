/* GeoSniper — camada de aeronaves (dados do OpenSky Network, via API do GeoSniper).
   Botão flutuante liga/desliga a camada nos mapas táticos. Desligada: nenhuma consulta,
   nenhum marcador e nenhuma rota. Ligada: mostra aeronaves do Estado, com filtro por tipo
   (avião / helicóptero), busca por indicativo ou ICAO24, e para a aeronave escolhida: posição,
   altitude, velocidade, rumo, rota percorrida (amarela) e tempo estimado até um marcador
   (por ex. a Boia Aérea).
   Depende de globais do index.html (todas lidas com guarda): currentPos, tacticalMarkers,
   getTacticalType, pinExpired, openTacticalPinModal, getUnitCode. */
(function () {
  'use strict';

  var API = 'https://api.geosniper.com.br';
  var REGION = 'RJ';
  var POLL_MS = 20000;          // o servidor só consulta o OpenSky a cada 30 s e divide a resposta entre todos
  var TICK_MS = 1000;
  var MAX_EXTRAPOLATE_S = 90;   // até quanto tempo se projeta a posição a partir do último contato
  var TRAIL_MINUTES = 30;       // quanto histórico pedir ao servidor para a rota percorrida
  var TRAIL_REFRESH_MS = 60000;
  var CRUMBS_MAX = 400;         // pontos guardados no aparelho, por aeronave, enquanto a camada está ligada
  var BUOY_TYPE = 'aerobuoy';

  // ---------- geodésia / cálculo ----------
  var R = 6371000, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function haversine(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }
  function destPoint(lat, lon, brg, dist) {
    var d = dist / R, b = brg * D2R, p1 = lat * D2R, l1 = lon * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
  }
  // Aeronave `a` ({lat, lon, track, speed}) em relação ao ponto `t` ({lat, lon}).
  //   direct   : tempo para chegar em linha reta, na velocidade atual
  //   closing  : true se a rota atual ainda se aproxima do ponto
  //   miss     : distância da menor aproximação seguindo a rota atual (m)
  //   tClosest : tempo até essa menor aproximação (s)
  function approach(a, t) {
    var d = haversine(a.lat, a.lon, t.lat, t.lon), brg = bearing(a.lat, a.lon, t.lat, t.lon);
    var v = typeof a.speed === 'number' ? a.speed : 0;
    var out = { distance: d, bearing: brg, direct: v > 1 ? d / v : null, closing: null, miss: null, tClosest: null, offTrack: null };
    if (typeof a.track === 'number' && v > 1) {
      var delta = (brg - a.track) * D2R;
      var along = d * Math.cos(delta), cross = Math.abs(d * Math.sin(delta));
      out.closing = along > 0;
      out.miss = out.closing ? cross : d;
      out.tClosest = out.closing ? along / v : null;
      out.offTrack = ((brg - a.track + 540) % 360) - 180;
    }
    return out;
  }
  var CARD = ['N', 'NNE', 'NE', 'ENE', 'L', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  function cardinal(deg) { return CARD[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }

  // ---------- formatação ----------
  function fmtDist(m) {
    if (m == null || isNaN(m)) return '—';
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: m < 100000 ? 1 : 0 }) + ' km';
  }
  function fmtDur(s) {
    if (s == null || isNaN(s) || !isFinite(s)) return '—';
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return h > 0 ? h + ' h ' + p2(m) + ' min' : p2(m) + ':' + p2(ss);
  }
  function fmtCoord(v) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(5); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- tipo da aeronave ----------
  // O servidor manda `kind` (aviao | helicoptero | outro | desconhecido) a partir da categoria ADS-B.
  function kindOf(a) {
    if (a.kind) return a.kind;
    var c = a.cat;
    if (c === 8) return 'helicoptero';
    if ((c >= 2 && c <= 7) || c === 12) return 'aviao';
    if (c === 9 || c === 10 || c === 11 || (c >= 13 && c <= 20)) return 'outro';
    return 'desconhecido';
  }
  var KIND_LABEL = { aviao: 'Avião', helicoptero: 'Helicóptero', outro: 'Outro tipo', desconhecido: 'Sem classificação' };
  var KIND_ICON = { aviao: '✈', helicoptero: '🚁', outro: '◆', desconhecido: '•' };

  // ---------- estado compartilhado entre os mapas ----------
  var S = {
    enabled: false, aircraft: [], byId: {}, status: 'ok', fetchedAt: 0, serverTime: 0, credits: null, error: '',
    selectedId: null, destId: null, follow: false, trail: true, trailPoints: null, trailFor: null, trailLoadedAt: 0,
    showGround: false, kindFilter: 'todos', query: '', crumbs: {},
    pollTimer: null, tickTimer: null, inflight: false, collapsed: false, armedMap: null
  };
  try { S.collapsed = localStorage.getItem('geosniper_aero_collapsed') === '1'; } catch (e) {}
  var views = {};   // nome do mapa -> { map, layer, route, trailLayer, fab, panel, markers{id:marker}, ... }

  function now() { return Date.now(); }
  function myPos() { try { return (typeof currentPos !== 'undefined' && currentPos && currentPos.length === 2) ? { lat: currentPos[0], lon: currentPos[1] } : null; } catch (e) { return null; } }
  function pins() { try { return (typeof tacticalMarkers !== 'undefined' && tacticalMarkers) ? Object.keys(tacticalMarkers).map(function (k) { return tacticalMarkers[k]; }) : []; } catch (e) { return []; } }
  function pinTypeLabel(p) { try { return getTacticalType(p.type).label; } catch (e) { return p.type; } }
  function pinGone(p) { try { return typeof pinExpired === 'function' && pinExpired(p); } catch (e) { return false; } }

  // posição projetada até agora, a partir do último contato
  function live(a) {
    var age = a.ageS + (now() - S.fetchedAt) / 1000;
    var dt = Math.min(Math.max(age, 0), MAX_EXTRAPOLATE_S);
    var p = { lat: a.lat, lon: a.lon, age: age, speed: a.speed, track: a.track, alt: a.alt, vrate: a.vrate };
    if (!a.onGround && typeof a.speed === 'number' && typeof a.track === 'number' && a.speed > 2 && dt > 0) {
      var q = destPoint(a.lat, a.lon, a.track, a.speed * dt); p.lat = q.lat; p.lon = q.lon;
    }
    return p;
  }

  // ---------- filtros ----------
  function passesFilters(a) {
    if (a.id === S.selectedId) return true;                       // a escolhida nunca some
    if (a.onGround && !S.showGround) return false;
    if (S.kindFilter !== 'todos' && kindOf(a) !== S.kindFilter) return false;
    if (S.query) {
      var q = S.query;
      if (a.id.toLowerCase().indexOf(q) < 0 && String(a.callsign || '').toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function visibleAircraft() { return S.aircraft.filter(passesFilters); }

  // ---------- dados ----------
  function unitHeaders() {
    var h = {};
    try { if (typeof getUnitCode === 'function') { var u = getUnitCode(); if (u) h['x-unit-code'] = u; } } catch (e) {}
    return h;
  }
  function anyMapVisible() {
    return Object.keys(views).some(function (k) { var c = views[k].map && views[k].map.getContainer(); return c && c.offsetParent !== null; });
  }
  async function poll() {
    if (!S.enabled || S.inflight || document.hidden || !anyMapVisible()) return;
    S.inflight = true;
    try {
      var r = await fetch(API + '/api/aircraft?region=' + REGION, { credentials: 'include', headers: unitHeaders() });
      if (r.status === 401 || r.status === 403) { S.error = r.status === 401 ? 'Sessão encerrada. Entre novamente.' : 'Sua conta não tem acesso às aeronaves.'; var msg = S.error; setEnabled(false, true); alert(msg); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var t = Date.now();
      S.serverTime = d.serverTime || t;
      S.aircraft = (d.aircraft || []).map(function (a) {
        a.ageS = Math.max(0, S.serverTime / 1000 - (a.lastContact || S.serverTime / 1000)); return a;
      });
      S.byId = {};
      S.aircraft.forEach(function (a) {
        S.byId[a.id] = a;
        // migalhas do percurso: guarda cada posição nova informada pela aeronave
        var arr = S.crumbs[a.id] || (S.crumbs[a.id] = []), last = arr[arr.length - 1];
        if (!last || last.t !== a.lastContact) { arr.push({ t: a.lastContact, lat: a.lat, lon: a.lon }); if (arr.length > CRUMBS_MAX) arr.shift(); }
      });
      S.fetchedAt = t; S.status = d.status || 'ok'; S.credits = d.creditsRemaining; S.error = '';
      if (S.selectedId && !S.byId[S.selectedId]) { S.selectedId = null; clearRoute(); drawTrail(); }
      if (S.selectedId && S.trail && t - S.trailLoadedAt > TRAIL_REFRESH_MS) loadTrail();
    } catch (e) {
      S.error = 'Sem conexão com o servidor.';
    } finally { S.inflight = false; }
    render();
  }
  async function loadTrail() {
    var id = S.selectedId;
    if (!S.trail || !id) return;
    S.trailLoadedAt = now();
    try {
      var r = await fetch(API + '/api/aircraft/' + encodeURIComponent(id) + '/trail?minutes=' + TRAIL_MINUTES, { credentials: 'include', headers: unitHeaders() });
      if (!r.ok || S.selectedId !== id) return;
      var d = await r.json();
      S.trailPoints = (d.points || []).map(function (p) { return { t: p.t, lat: p.lat, lon: p.lon }; });
      S.trailFor = id;
      drawTrail();
    } catch (e) {}
  }

  // ---------- ligar / desligar ----------
  function setEnabled(on, silent) {
    on = !!on;
    if (S.enabled === on && !silent) return;
    S.enabled = on;
    if (on) {
      S.error = '';
      poll();
      S.pollTimer = setInterval(poll, POLL_MS);
      S.tickTimer = setInterval(tick, TICK_MS);
    } else {
      clearInterval(S.pollTimer); clearInterval(S.tickTimer); S.pollTimer = S.tickTimer = null;
      S.aircraft = []; S.byId = {}; S.crumbs = {}; S.selectedId = null; S.follow = false; S.trailPoints = null; S.trailFor = null; S.armedMap = null;
      Object.keys(views).forEach(function (k) {
        var v = views[k];
        Object.keys(v.markers).forEach(function (id) { v.layer.removeLayer(v.markers[id]); });
        v.markers = {}; v.layer.clearLayers(); v.route.clearLayers(); v.trailLayer.clearLayers();
        if (v.map.hasLayer(v.layer)) v.map.removeLayer(v.layer);
        if (v.map.hasLayer(v.route)) v.map.removeLayer(v.route);
        if (v.map.hasLayer(v.trailLayer)) v.map.removeLayer(v.trailLayer);
        v.map.getContainer().style.cursor = '';
      });
    }
    Object.keys(views).forEach(function (k) {
      var v = views[k];
      v.fab.classList.toggle('on', on);
      v.fab.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) { [v.layer, v.trailLayer, v.route].forEach(function (g) { if (!v.map.hasLayer(g)) g.addTo(v.map); }); }
    });
    render();
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden && S.enabled) poll(); });

  // ---------- desenho no mapa ----------
  var PLANE_PATH = 'M16 2.5c1 0 1.7 1 1.7 2.4v7.2l11.3 7.4v2.9l-11.3-3.2v6.1l3 2.4v2.5L16 27.9l-4.7 1.4v-2.5l3-2.4v-6.1L3 22.4v-2.9l11.3-7.4V4.9c0-1.4.7-2.4 1.7-2.4z';
  function aircraftSvg(kind, color, rot) {
    var body;
    if (kind === 'helicoptero') {
      // vista superior: cabine, cauda e rotor principal (duas pás cruzadas)
      body = '<ellipse cx="16" cy="14" rx="4.6" ry="6.4" fill="' + color + '" stroke="#06210a" stroke-width="1.3"/>' +
        '<rect x="14.7" y="19" width="2.6" height="10" rx="1.2" fill="' + color + '" stroke="#06210a" stroke-width="1.1"/>' +
        '<rect x="11" y="27" width="10" height="2.6" rx="1.2" fill="' + color + '" stroke="#06210a" stroke-width="1.1"/>' +
        '<line x1="3" y1="14" x2="29" y2="14" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>' +
        '<line x1="16" y1="1.5" x2="16" y2="26.5" stroke="' + color + '" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>';
    } else {
      body = '<path d="' + PLANE_PATH + '" fill="' + color + '" stroke="#06210a" stroke-width="1.3" stroke-linejoin="round"/>';
    }
    return '<svg viewBox="0 0 32 32" width="30" height="30" style="transform:rotate(' + rot + 'deg); display:block;" aria-hidden="true">' + body + '</svg>';
  }
  function iconFor(a, p, selected, zoom) {
    var ground = a.onGround, kind = kindOf(a);
    var color = selected ? '#facc15' : (ground ? '#9aa5b1' : '#ffffff');
    var rot = typeof a.track === 'number' ? Math.round(a.track) : 0;
    var label = (a.callsign || a.id.toUpperCase());
    var showLabel = selected || (typeof zoom !== 'number' || zoom >= 9);
    var altTxt = (typeof a.alt === 'number' && !ground) ? ' · ' + Math.round(a.alt).toLocaleString('pt-BR') + ' m' : (ground ? ' · solo' : '');
    var html = '<div class="aero-mk' + (selected ? ' sel' : '') + (ground ? ' gnd' : '') + '">' + aircraftSvg(kind, color, rot) +
      (showLabel ? '<span class="aero-mk-tag">' + esc(label) + esc(altTxt) + '</span>' : '') + '</div>';
    return L.divIcon({ className: 'aero-divicon', html: html, iconSize: [30, 30], iconAnchor: [15, 15] });
  }
  function drawMarkers(v) {
    if (!S.enabled || !v.map.getContainer() || v.map.getContainer().offsetParent === null) return;
    var zoom = v.map.getZoom(), keep = {};
    visibleAircraft().forEach(function (a) {
      var p = live(a), sel = a.id === S.selectedId; keep[a.id] = true;
      var mk = v.markers[a.id];
      if (!mk) {
        mk = L.marker([p.lat, p.lon], { icon: iconFor(a, p, sel, zoom), keyboard: false, zIndexOffset: sel ? 1000 : 0 }).addTo(v.layer);
        mk.on('click', function () { select(a.id); });
        v.markers[a.id] = mk;
      } else {
        mk.setLatLng([p.lat, p.lon]);
        mk.setIcon(iconFor(a, p, sel, zoom));
        mk.setZIndexOffset(sel ? 1000 : 0);
      }
    });
    Object.keys(v.markers).forEach(function (id) { if (!keep[id]) { v.layer.removeLayer(v.markers[id]); delete v.markers[id]; } });
  }
  function destinationPoint() {
    if (S.destId === 'me') return myPos() ? { lat: myPos().lat, lon: myPos().lon, name: 'Minha posição' } : null;
    var p = pins().filter(function (x) { return x.id === S.destId; })[0];
    if (!p || typeof p.lat !== 'number') return null;
    return { lat: p.lat, lon: p.lng, name: pinTypeLabel(p) + (p.label && p.label !== pinTypeLabel(p) ? ' — ' + p.label : '') };
  }
  function clearRoute() { Object.keys(views).forEach(function (k) { views[k].route.clearLayers(); }); }
  // Rota prevista (mantendo o rumo: branca pontilhada) e linha até o destino (azul tracejada).
  function drawRoute(v) {
    v.route.clearLayers();
    var a = S.selectedId && S.byId[S.selectedId]; if (!a || !S.enabled) return;
    var p = live(a);
    if (typeof a.track === 'number' && !a.onGround && a.speed > 2) {
      var ahead = destPoint(p.lat, p.lon, a.track, 40000);
      L.polyline([[p.lat, p.lon], [ahead.lat, ahead.lon]], { color: '#ffffff', weight: 2, opacity: 0.85, dashArray: '2 7', interactive: false }).addTo(v.route);
    }
    var dest = destinationPoint();
    if (dest) L.polyline([[p.lat, p.lon], [dest.lat, dest.lon]], { color: '#38bdf8', weight: 2.5, opacity: 0.95, dashArray: '8 6', interactive: false }).addTo(v.route);
  }
  // Rota percorrida: amarela contínua = histórico do servidor + posições recebidas neste aparelho + posição atual.
  function trailLatLngs(id) {
    var byT = {}, pts = [];
    (S.trailFor === id && S.trailPoints ? S.trailPoints : []).concat(S.crumbs[id] || []).forEach(function (q) {
      if (byT[q.t] === undefined) { byT[q.t] = 1; pts.push(q); }
    });
    pts.sort(function (x, y) { return x.t - y.t; });
    var line = pts.map(function (q) { return [q.lat, q.lon]; });
    var a = S.byId[id];
    if (a && line.length) { var p = live(a); line.push([p.lat, p.lon]); }
    return line;
  }
  function drawTrail() {
    Object.keys(views).forEach(function (k) {
      var v = views[k]; v.trailLayer.clearLayers();
      if (!S.enabled || !S.trail || !S.selectedId) return;
      var line = trailLatLngs(S.selectedId);
      if (line.length > 1) L.polyline(line, { color: '#facc15', weight: 3.5, opacity: 0.95, interactive: false }).addTo(v.trailLayer);
    });
  }

  // ---------- painel ----------
  var CSS = '' +
    '.aero-fab{position:absolute;left:8px;bottom:126px;z-index:900;width:38px;height:38px;border-radius:10px;border:1px solid var(--line,#3a4a3a);background:var(--surface,#16241a);color:var(--ink,#e8efe3);font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.45);touch-action:manipulation}' +
    '.aero-fab.on{background:var(--action,#2f7a3a);border-color:var(--accent,#7ee08a);color:#fff}' +
    '.aero-fab.on::after{content:"";position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 2px rgba(0,0,0,.4)}' +
    '.aero-panel{position:absolute;left:54px;bottom:126px;z-index:900;width:min(340px,calc(100% - 66px));max-height:min(440px,calc(100% - 150px));display:none;flex-direction:column;border:1px solid var(--line,#3a4a3a);border-radius:12px;background:var(--surface,#16241a);color:var(--ink,#e8efe3);font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.55);overflow:hidden}' +
    '.aero-panel.show{display:flex}' +
    '.aero-fab.compact{bottom:8px}.aero-panel.compact{bottom:8px;max-height:calc(100% - 16px)}' +
    '.aero-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line,#3a4a3a);font-weight:800}' +
    '.aero-head .aero-sub{flex:1;min-width:0;font-weight:600;font-size:10.5px;color:var(--muted,#9fb09a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.aero-head button,.aero-btn{border:1px solid var(--line,#3a4a3a);background:var(--bg,#0f1a12);color:var(--ink,#e8efe3);border-radius:8px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;touch-action:manipulation}' +
    '.aero-btn.on{background:var(--action,#2f7a3a);border-color:var(--accent,#7ee08a);color:#fff}' +
    '.aero-body{overflow-y:auto;padding:6px 8px 8px;-webkit-overflow-scrolling:touch}' +
    '.aero-warn{margin:0 0 6px;padding:5px 7px;border-radius:7px;background:rgba(250,204,21,.14);border:1px solid rgba(250,204,21,.5);color:#facc15;font-size:11px}' +
    '.aero-controls{display:flex;flex-direction:column;gap:5px}' +
    '.aero-filters{display:flex;gap:5px}' +
    '.aero-filters>*{flex:1 1 0;min-width:0}' +
    '.aero-select,.aero-input{width:100%;box-sizing:border-box;padding:6px;border-radius:8px;border:1px solid var(--line,#3a4a3a);background:var(--bg,#0f1a12);color:var(--ink,#e8efe3);font-size:12px}' +
    '.aero-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin:8px 0}' +
    '.aero-grid div{display:flex;flex-direction:column;line-height:1.25}' +
    '.aero-grid small{color:var(--muted,#9fb09a);font-size:10px;text-transform:uppercase;letter-spacing:.3px}' +
    '.aero-grid .v{font-weight:800;font-size:12.5px}' +
    '.aero-eta{margin:6px 0;padding:7px 8px;border-radius:9px;background:var(--bg,#0f1a12);border:1px solid var(--line,#3a4a3a)}' +
    '.aero-eta .big{font-size:20px;font-weight:900;letter-spacing:.3px;font-variant-numeric:tabular-nums}' +
    '.aero-eta .lbl{font-size:10px;color:var(--muted,#9fb09a);text-transform:uppercase;letter-spacing:.3px}' +
    '.aero-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.aero-foot{color:var(--muted,#9fb09a);font-size:10.5px;margin-top:6px}' +
    '.aero-divicon{background:none;border:0}' +
    '.aero-mk{position:relative;width:30px;height:30px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}' +
    '.aero-mk.gnd{opacity:.8}' +
    '.aero-mk.sel svg{filter:drop-shadow(0 0 5px #facc15)}' +
    '.aero-mk-tag{position:absolute;left:30px;top:6px;white-space:nowrap;background:rgba(6,20,10,.82);color:#fff;border:1px solid rgba(255,255,255,.55);border-radius:8px;padding:0 5px;font-size:10px;font-weight:700;line-height:15px;pointer-events:none}' +
    '.aero-mk.sel .aero-mk-tag{background:#facc15;color:#1a1500;border-color:#1a1500}';
  function injectCss() {
    if (document.getElementById('aeroStyles')) return;
    var st = document.createElement('style'); st.id = 'aeroStyles'; st.textContent = CSS; document.head.appendChild(st);
  }

  function destOptions(a) {
    var p = live(a), list = [];
    pins().forEach(function (pin) {
      if (typeof pin.lat !== 'number' || typeof pin.lng !== 'number' || pinGone(pin)) return;
      var d = haversine(p.lat, p.lon, pin.lat, pin.lng);
      var name = pinTypeLabel(pin) + (pin.label && pin.label !== pinTypeLabel(pin) ? ' — ' + pin.label : '');
      list.push({ id: pin.id, name: name, d: d, buoy: pin.type === BUOY_TYPE });
    });
    list.sort(function (x, y) { return (y.buoy - x.buoy) || (x.d - y.d); });
    return list.slice(0, 60);
  }
  function ensureDest(a) {
    var opts = destOptions(a);
    var valid = S.destId === 'me' ? !!myPos() : opts.some(function (o) { return o.id === S.destId; });
    if (!valid) S.destId = opts.length ? opts[0].id : (myPos() ? 'me' : null);
    return opts;
  }

  function statusLine() {
    var n = S.aircraft.length, age = S.fetchedAt ? Math.round((now() - S.fetchedAt) / 1000) : null;
    if (S.error) return S.error;
    if (S.status === 'cota') return '⚠ cota diária do OpenSky esgotada — último dado';
    if (S.status === 'atrasado') return '⚠ dados atrasados';
    if (S.status === 'indisponivel') return '⚠ sem dados do OpenSky';
    if (!S.fetchedAt) return 'consultando…';
    return REGION + ' · ' + n + ' aeronave' + (n === 1 ? '' : 's') + ' · há ' + age + ' s';
  }

  // Opções do seletor: "ICAO24 · INDICATIVO · altitude · velocidade · distância de você"
  function pickerOptionsHtml() {
    var me = myPos();
    var rows = visibleAircraft().map(function (a) {
      var p = live(a);
      return { a: a, d: me ? haversine(me.lat, me.lon, p.lat, p.lon) : null };
    });
    rows.sort(function (x, y) { return (x.d == null ? 1e12 : x.d) - (y.d == null ? 1e12 : y.d); });
    var total = S.aircraft.length;
    var h = '<option value="">' + (rows.length ? 'Selecione a aeronave (' + rows.length + (rows.length !== total ? ' de ' + total : '') + ')'
      : (total ? 'Nenhuma aeronave com esse filtro' : 'Nenhuma aeronave no momento')) + '</option>';
    rows.slice(0, 150).forEach(function (r) {
      var a = r.a;
      var alt = a.onGround ? 'solo' : (typeof a.alt === 'number' ? Math.round(a.alt).toLocaleString('pt-BR') + ' m' : '—');
      var spd = typeof a.speed === 'number' ? Math.round(a.speed * 3.6) + ' km/h' : '—';
      h += '<option value="' + esc(a.id) + '"' + (a.id === S.selectedId ? ' selected' : '') + '>' +
        KIND_ICON[kindOf(a)] + ' ' + esc(a.id.toUpperCase()) + (a.callsign ? ' · ' + esc(a.callsign) : '') + ' · ' + alt + ' · ' + spd + (r.d == null ? '' : ' · ' + fmtDist(r.d)) + '</option>';
    });
    return h;
  }
  function typeOptionsHtml() {
    var c = { aviao: 0, helicoptero: 0, desconhecido: 0 };
    S.aircraft.forEach(function (a) { var k = kindOf(a); if (c[k] !== undefined) c[k]++; });
    function opt(v, txt) { return '<option value="' + v + '"' + (S.kindFilter === v ? ' selected' : '') + '>' + txt + '</option>'; }
    return opt('todos', 'Todas (' + S.aircraft.length + ')') + opt('aviao', 'Somente aviões (' + c.aviao + ')') +
      opt('helicoptero', 'Somente helicópteros (' + c.helicoptero + ')') + opt('desconhecido', 'Sem classificação (' + c.desconhecido + ')');
  }

  function detailHtml(a) {
    var p = live(a), opts = ensureDest(a), dest = destinationPoint();
    var kmh = typeof a.speed === 'number' ? Math.round(a.speed * 3.6) : null, kt = typeof a.speed === 'number' ? Math.round(a.speed * 1.943844) : null;
    var altM = typeof a.alt === 'number' ? Math.round(a.alt) : null, altFt = altM == null ? null : Math.round(altM * 3.28084);
    var me = myPos(), dMe = me ? haversine(me.lat, me.lon, p.lat, p.lon) : null;
    var kind = kindOf(a);
    var h = '<div style="display:flex;align-items:baseline;gap:6px;margin-top:8px;flex-wrap:wrap"><b style="font-size:14px">' + esc(a.callsign || a.id.toUpperCase()) + '</b>' +
      '<span style="color:var(--muted,#9fb09a)">ICAO24 ' + esc(a.id.toUpperCase()) + (a.country ? ' · ' + esc(a.country) : '') + '</span></div>';
    h += '<div class="aero-foot" style="margin-top:2px">' + KIND_ICON[kind] + ' ' + KIND_LABEL[kind] + '</div>';
    h += '<div class="aero-grid">' +
      '<div><small>Posição</small><span class="v">' + fmtCoord(p.lat) + ', ' + fmtCoord(p.lon) + '</span></div>' +
      '<div><small>Altitude</small><span class="v">' + (a.onGround ? 'no solo' : (altM == null ? '—' : altM.toLocaleString('pt-BR') + ' m · ' + altFt.toLocaleString('pt-BR') + ' ft')) + '</span></div>' +
      '<div><small>Velocidade</small><span class="v">' + (kmh == null ? '—' : kmh + ' km/h · ' + kt + ' kt') + '</span></div>' +
      '<div><small>Rumo</small><span class="v">' + (typeof a.track === 'number' ? Math.round(a.track) + '° ' + cardinal(a.track) : '—') + '</span></div>' +
      '<div><small>Razão vertical</small><span class="v">' + (typeof a.vrate === 'number' ? (a.vrate > 0.5 ? '▲ ' : a.vrate < -0.5 ? '▼ ' : '') + Math.abs(Math.round(a.vrate * 10) / 10).toLocaleString('pt-BR') + ' m/s' : '—') + '</span></div>' +
      '<div><small>De você</small><span class="v">' + (dMe == null ? '—' : fmtDist(dMe) + ' · ' + Math.round(bearing(me.lat, me.lon, p.lat, p.lon)) + '° ' + cardinal(bearing(me.lat, me.lon, p.lat, p.lon))) + '</span></div>' +
      '</div>';
    h += '<label class="aero-foot" style="margin:0">Tempo estimado até:</label><select class="aero-select" data-aero-dest style="margin-top:3px">';
    opts.forEach(function (o) { h += '<option value="' + esc(o.id) + '"' + (o.id === S.destId ? ' selected' : '') + '>' + (o.buoy ? '✈ ' : '') + esc(o.name) + ' · ' + fmtDist(o.d) + '</option>'; });
    if (me) h += '<option value="me"' + (S.destId === 'me' ? ' selected' : '') + '>📍 Minha posição · ' + fmtDist(dMe) + '</option>';
    h += '</select>';
    if (!dest) {
      h += '<div class="aero-foot">Não há marcador no mapa. Coloque uma Boia Aérea para ver o tempo estimado.</div>';
    } else {
      var ap = approach({ lat: p.lat, lon: p.lon, track: a.track, speed: a.onGround ? 0 : a.speed }, dest);
      h += '<div class="aero-eta">';
      h += '<div class="lbl">Tempo até ' + esc(dest.name) + '</div>';
      h += '<div class="big">' + (ap.direct == null ? (a.onGround ? 'aeronave no solo' : 'sem velocidade registrada') : fmtDur(ap.direct)) + '</div>';
      h += '<div class="lbl" style="margin-top:-2px">em linha reta, na velocidade atual' + (kmh != null && ap.direct != null ? ' (' + kmh + ' km/h)' : '') + '</div>';
      h += '<div style="margin-top:4px">Distância <b>' + fmtDist(ap.distance) + '</b> · rumo até lá <b>' + Math.round(ap.bearing) + '° ' + cardinal(ap.bearing) + '</b></div>';
      if (ap.closing === true) {
        h += '<div class="lbl" style="margin-top:6px">Mantendo o rumo atual</div><div style="font-weight:800">menor aproximação em ' + fmtDur(ap.tClosest) + ', a ' + fmtDist(ap.miss) + ' do ponto</div>';
      } else if (ap.closing === false) {
        h += '<div class="lbl" style="margin-top:6px">Mantendo o rumo atual</div><div style="font-weight:800;color:#facc15">afastando-se do ponto</div>';
      }
      h += '</div>';
    }
    if (p.age > 20) h += '<div class="aero-warn">Último contato há ' + Math.round(p.age) + ' s: posição estimada pelo rumo e velocidade.</div>';
    h += '<div class="aero-actions">' +
      '<button class="aero-btn' + (S.follow ? ' on' : '') + '" data-aero-act="follow">🎯 Seguir</button>' +
      '<button class="aero-btn' + (S.trail ? ' on' : '') + '" data-aero-act="trail" title="Linha amarela com o caminho já percorrido">🟡 Rota percorrida</button>' +
      '<button class="aero-btn" data-aero-act="buoy">＋ Boia Aérea</button></div>';
    return h;
  }

  // Um toque em andamento (ou um seletor/campo em uso) não deve ser interrompido por reconstrução do painel.
  // Baseado em tempo: nunca fica "preso" caso o navegador não entregue o pointerup (ex.: seletor nativo aberto).
  function interacting(v) {
    var age = now() - (v.touchAt || 0);
    if (age > 15000) return false;
    if (v.pressing && age < 1500) return true;
    var ae = document.activeElement;
    return !!(ae && v.panel.contains(ae) && ae.matches && ae.matches('select,input'));
  }

  function renderPanel(v) {
    var panel = v.panel, q = function (s) { return panel.querySelector(s); };
    var compact = v.map.getContainer().clientHeight < 400;   // mapas baixos (aba Pontos): encosta embaixo
    panel.classList.toggle('compact', compact); v.fab.classList.toggle('compact', compact);
    panel.classList.toggle('show', S.enabled);
    if (!S.enabled) return;
    q('.aero-sub').textContent = statusLine();
    q('[data-aero-act="min"]').textContent = S.collapsed ? '▴' : '▾';
    var body = q('.aero-body');
    body.style.display = S.collapsed ? 'none' : '';
    if (S.collapsed) return;

    var warn = (S.status === 'cota' || S.status === 'atrasado' || S.status === 'indisponivel' || S.error) ? '<div class="aero-warn">' + esc(statusLine()) + '</div>' : '';
    q('.aero-warnbox').innerHTML = warn;

    // controles fixos: só as opções são atualizadas, e nunca enquanto o próprio elemento está em uso
    var typeEl = q('[data-aero-type]'), pickEl = q('[data-aero-pick]'), gndEl = q('[data-aero-ground]');
    if (document.activeElement !== typeEl) typeEl.innerHTML = typeOptionsHtml();
    if (document.activeElement !== pickEl) pickEl.innerHTML = pickerOptionsHtml();
    if (document.activeElement !== gndEl) gndEl.checked = S.showGround;

    if (interacting(v)) return;
    var a = S.selectedId && S.byId[S.selectedId];
    var top = body.scrollTop;
    q('.aero-detail').innerHTML = a ? detailHtml(a) : '<div class="aero-foot">Escolha uma aeronave acima ou toque no avião no mapa.</div>';
    body.scrollTop = top;
  }

  function render() { Object.keys(views).forEach(function (k) { var v = views[k]; renderPanel(v); drawMarkers(v); drawRoute(v); drawTrail(); }); }
  function tick() {
    if (!S.enabled) return;
    if (S.follow && S.selectedId && S.byId[S.selectedId]) {
      var p = live(S.byId[S.selectedId]);
      Object.keys(views).forEach(function (k) { focusOn(views[k], p, true); });
    }
    render();
  }

  // Coloca a aeronave na faixa de cima do mapa (o painel aberto cobre a parte de baixo).
  // force=true (modo Seguir): sempre recentraliza; senão só move se ela estiver fora da área boa.
  function focusOn(v, p, force) {
    var c = v.map.getContainer();
    if (c.offsetParent === null) return;
    var pt = v.map.latLngToContainerPoint([p.lat, p.lon]), w = c.clientWidth, h = c.clientHeight;
    var panelOpen = S.enabled && !S.collapsed && !v.panel.classList.contains('compact');
    var goalY = panelOpen ? h * 0.2 : h * 0.5;
    var outside = pt.x < w * 0.1 || pt.x > w * 0.9 || pt.y < h * 0.08 || pt.y > (panelOpen ? h * 0.38 : h * 0.9);
    if (!force && !outside) return;
    var dx = pt.x - w / 2, dy = pt.y - goalY;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    v.map.panBy([dx, dy], { animate: !force });
  }

  function select(id) {
    S.selectedId = id; S.trailPoints = null; S.trailFor = null; S.trailLoadedAt = 0;
    Object.keys(views).forEach(function (k) { views[k].touchAt = 0; views[k].pressing = false; });   // seleção nova: o painel redesenha na hora
    var a = S.byId[id];
    if (a) {
      var p = live(a);
      Object.keys(views).forEach(function (k) { focusOn(views[k], p, false); });
    }
    if (S.trail) loadTrail();
    render();
  }
  function deselect() {
    S.selectedId = null; S.follow = false; S.trailPoints = null; S.trailFor = null;
    Object.keys(views).forEach(function (k) { views[k].touchAt = 0; views[k].pressing = false; });
    render();
  }

  function onPanelClick(v, ev) {
    var act = ev.target.closest && ev.target.closest('[data-aero-act]');
    if (!act) return;
    var k = act.getAttribute('data-aero-act');
    if (k === 'close') { setEnabled(false); return; }
    if (k === 'min') { S.collapsed = !S.collapsed; try { localStorage.setItem('geosniper_aero_collapsed', S.collapsed ? '1' : '0'); } catch (e) {} render(); return; }
    if (k === 'follow') { S.follow = !S.follow; v.touchAt = 0; render(); return; }
    if (k === 'trail') {
      S.trail = !S.trail; v.touchAt = 0;
      if (S.trail) loadTrail(); else { S.trailPoints = null; S.trailFor = null; }
      render(); return;
    }
    if (k === 'buoy') { armBuoy(v); return; }
  }
  function onPanelChange(v, ev) {
    var t = ev.target;
    v.touchAt = 0;
    if (t.matches('[data-aero-dest]')) { S.destId = t.value; t.blur(); render(); return; }
    if (t.matches('[data-aero-type]')) { S.kindFilter = t.value; t.blur(); render(); return; }
    if (t.matches('[data-aero-ground]')) { S.showGround = !!t.checked; render(); return; }
    if (t.matches('[data-aero-pick]')) {
      var val = t.value;
      t.blur();   // antes de renderizar: o seletor em foco não é reconstruído
      if (val) select(val); else deselect();
    }
  }
  function onPanelInput(v, ev) {
    if (ev.target.matches('[data-aero-search]')) { S.query = String(ev.target.value || '').trim().toLowerCase(); render(); }
  }

  // Boia Aérea: toque no mapa -> abre o cadastro de marcador normal do app com o tipo da boia.
  function armBuoy(v) {
    if (typeof openTacticalPinModal !== 'function') return;
    S.armedMap = v;
    v.map.getContainer().style.cursor = 'crosshair';
    var sub = v.panel.querySelector('.aero-sub'); if (sub) sub.textContent = 'Toque no mapa para posicionar a Boia Aérea';
    v.map.once('click', function (e) {
      v.map.getContainer().style.cursor = '';
      if (!S.enabled || S.armedMap !== v) return;
      S.armedMap = null;
      openTacticalPinModal(BUOY_TYPE, e.latlng.lat, e.latlng.lng);
    });
  }

  // ---------- integração com cada mapa ----------
  function attach(map, name) {
    if (!map || !window.L) return;
    injectCss();
    var old = views[name];
    if (old) { try { old.fab.remove(); old.panel.remove(); } catch (e) {} }
    var container = map.getContainer();
    var v = { map: map, markers: {}, layer: L.layerGroup(), trailLayer: L.layerGroup(), route: L.layerGroup(), touchAt: 0, pressing: false };

    var fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'aero-fab'; fab.title = 'Aeronaves (liga e desliga)'; fab.setAttribute('aria-label', 'Aeronaves'); fab.setAttribute('aria-pressed', 'false');
    fab.textContent = '✈️';
    fab.addEventListener('click', function () { setEnabled(!S.enabled); });
    var panel = document.createElement('div');
    panel.className = 'aero-panel';
    panel.innerHTML =
      '<div class="aero-head"><span>✈ Aeronaves</span><span class="aero-sub"></span>' +
      '<button type="button" data-aero-act="min" title="Minimizar">▾</button><button type="button" data-aero-act="close" title="Desligar">✕</button></div>' +
      '<div class="aero-body">' +
        '<div class="aero-warnbox"></div>' +
        '<div class="aero-controls">' +
          '<div class="aero-filters">' +
            '<select class="aero-select" data-aero-type aria-label="Tipo de aeronave"></select>' +
            '<input class="aero-input" data-aero-search type="search" placeholder="Buscar ICAO24 / indicativo" aria-label="Buscar aeronave" autocomplete="off" autocapitalize="none" spellcheck="false">' +
          '</div>' +
          '<select class="aero-select" data-aero-pick aria-label="Selecionar aeronave"></select>' +
        '</div>' +
        '<div class="aero-detail"></div>' +
        '<label class="aero-foot" style="display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer"><input type="checkbox" data-aero-ground> mostrar aeronaves no solo</label>' +
      '</div>';
    panel.addEventListener('click', function (ev) { onPanelClick(v, ev); });
    panel.addEventListener('change', function (ev) { onPanelChange(v, ev); });
    panel.addEventListener('input', function (ev) { onPanelInput(v, ev); });
    panel.addEventListener('pointerdown', function () { v.pressing = true; v.touchAt = now(); });
    panel.addEventListener('pointerup', function () { v.pressing = false; v.touchAt = now(); });
    panel.addEventListener('pointercancel', function () { v.pressing = false; });
    panel.addEventListener('focusin', function () { v.touchAt = now(); });
    panel.addEventListener('keydown', function () { v.touchAt = now(); });
    [fab, panel].forEach(function (el) {
      L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
      container.appendChild(el);
    });
    v.fab = fab; v.panel = panel;
    views[name] = v;
    map.on('zoomend', function () { if (S.enabled) { Object.keys(v.markers).forEach(function (id) { v.layer.removeLayer(v.markers[id]); }); v.markers = {}; drawMarkers(v); } });
    map.on('dragstart', function () { if (S.follow) { S.follow = false; render(); } });
    if (S.enabled) { fab.classList.add('on'); [v.layer, v.trailLayer, v.route].forEach(function (g) { g.addTo(map); }); render(); }
  }

  var API_PUBLIC = {
    attach: attach,
    setEnabled: setEnabled,
    isEnabled: function () { return S.enabled; },
    _calc: { haversine: haversine, bearing: bearing, destPoint: destPoint, approach: approach, cardinal: cardinal, fmtDist: fmtDist, fmtDur: fmtDur, kindOf: kindOf }
  };
  if (typeof window !== 'undefined') window.GeoAeronaves = API_PUBLIC;
  if (typeof module !== 'undefined' && module.exports) module.exports = API_PUBLIC;
})();
