/* GeoSniper · aba "Realidade" (realidade aumentada leve)
 *
 * Câmera traseira ao fundo + camada desenhada em canvas por cima, cruzando:
 *   - a posição do operador (GPS já lido pelo app: gpsLatestReading),
 *   - a orientação do aparelho (deviceorientationabsolute → matriz de rotação),
 *   - os marcadores táticos (tacticalMarkers) e as áreas desenhadas (tacticalDrawings).
 *
 * Projeção 3D de verdade (câmera "pinhole"): cada ponto vira um vetor Leste/Norte/Cima
 * em relação ao operador, entra no referencial do aparelho pela matriz de rotação e é
 * projetado na tela. Por isso funciona igual em retrato e paisagem (screen.orientation)
 * e permite desenhar paredes translúcidas para as áreas de risco.
 *
 * Só LÊ os dados do app: não grava nada nos marcadores nem nos desenhos.
 */
(function (root) {
  'use strict';

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var M_PER_DEG = 111320;

  // ---------- matemática pura (testável em Node) ----------
  function rotMatrix(alphaDeg, betaDeg, gammaDeg) {
    // Matriz do referencial do aparelho para o da Terra (x=Leste, y=Norte, z=Cima) — padrão W3C.
    var a = alphaDeg * D2R, b = betaDeg * D2R, g = gammaDeg * D2R;
    var cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    return [
      [cA * cG - sA * sB * sG, -cB * sA, cG * sA * sB + cA * sG],
      [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
      [-cB * sG, sB, cB * cG]
    ];
  }

  function orthonormalize(R) {
    var r0 = R[0].slice(), r1 = R[1].slice();
    var n0 = Math.hypot(r0[0], r0[1], r0[2]) || 1;
    r0 = [r0[0] / n0, r0[1] / n0, r0[2] / n0];
    var d = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2];
    r1 = [r1[0] - d * r0[0], r1[1] - d * r0[1], r1[2] - d * r0[2]];
    var n1 = Math.hypot(r1[0], r1[1], r1[2]) || 1;
    r1 = [r1[0] / n1, r1[1] / n1, r1[2] / n1];
    var r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
    return [r0, r1, r2];
  }

  function smoothMatrix(prev, next, k) {
    if (!prev) return next;
    var out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out[i][j] = prev[i][j] + k * (next[i][j] - prev[i][j]);
    return orthonormalize(out);
  }

  // Eixos da tela (direita / cima) escritos no referencial do aparelho, conforme a rotação da tela.
  function screenAxes(angle) {
    switch (((angle % 360) + 360) % 360) {
      case 90: return { right: [0, -1, 0], up: [1, 0, 0] };
      case 180: return { right: [-1, 0, 0], up: [0, -1, 0] };
      case 270: return { right: [0, 1, 0], up: [-1, 0, 0] };
      default: return { right: [1, 0, 0], up: [0, 1, 0] };
    }
  }

  // Vetor em coordenadas da câmera: x = direita da tela, y = cima da tela, z = profundidade (à frente).
  function toCamera(R, axes, P) {
    var dx = R[0][0] * P[0] + R[1][0] * P[1] + R[2][0] * P[2];
    var dy = R[0][1] * P[0] + R[1][1] * P[1] + R[2][1] * P[2];
    var dz = R[0][2] * P[0] + R[1][2] * P[1] + R[2][2] * P[2];
    return {
      x: dx * axes.right[0] + dy * axes.right[1] + dz * axes.right[2],
      y: dx * axes.up[0] + dy * axes.up[1] + dz * axes.up[2],
      z: -dz
    };
  }

  function camToPixel(c, cam) {
    return { x: cam.cx + cam.f * c.x / c.z, y: cam.cy - cam.f * c.y / c.z };
  }

  // Direção para onde a câmera aponta (rumo verdadeiro 0..360 e elevação em graus).
  function cameraLook(R) {
    var fe = -R[0][2], fn = -R[1][2], fu = -R[2][2];
    return {
      heading: (Math.atan2(fe, fn) * R2D + 360) % 360,
      pitch: Math.asin(Math.max(-1, Math.min(1, fu))) * R2D
    };
  }

  function enuFrom(lat0, lng0, lat, lng) {
    return [(lng - lng0) * M_PER_DEG * Math.cos(lat0 * D2R), (lat - lat0) * M_PER_DEG];
  }

  function bearingOf(e, n) { return (Math.atan2(e, n) * R2D + 360) % 360; }

  // Gira o plano horizontal: aplica o desvio de bússola (graus somados ao rumo medido).
  function applyOffset(e, n, offDeg) {
    var t = -offDeg * D2R, c = Math.cos(t), s = Math.sin(t);
    return [e * c + n * s, -e * s + n * c];
  }

  // Recorte de polígono (camera space) contra o plano z >= near.
  function clipNear(poly, near) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var ain = a.z >= near, bin = b.z >= near;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = (near - a.z) / (b.z - a.z);
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: near });
      }
    }
    return out;
  }

  function pointInPolygon(e, n, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > n) !== (yj > n)) && (e < (xj - xi) * (n - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m'; }
  function cardinal(deg) { return ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8]; }
  function wrap180(d) { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; }

  // Pontos (lat,lng) de uma área desenhada. Só formas que delimitam área/linha viram parede.
  function shapeRing(d) {
    var data = d && d.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return null; } }
    if (!data) return null;
    var t = d.shapeType, pts = [], i;
    function circle(lat, lng, r) {
      var out = [], steps = 48;
      for (i = 0; i < steps; i++) {
        var a = (i / steps) * 2 * Math.PI;
        out.push([lat + (r * Math.cos(a)) / M_PER_DEG, lng + (r * Math.sin(a)) / (M_PER_DEG * Math.cos(lat * D2R))]);
      }
      return out;
    }
    if (t === 'rectangle' && data.bounds && data.bounds.length >= 2) {
      var b = data.bounds, la1 = b[0][0], ln1 = b[0][1], la2 = b[1][0], ln2 = b[1][1];
      return { pts: [[la1, ln1], [la1, ln2], [la2, ln2], [la2, ln1]], closed: true };
    }
    if (t === 'circle' && typeof data.lat === 'number') return { pts: circle(data.lat, data.lng, data.radius), closed: true };
    if (t === 'encirclement' && data.center && typeof data.radius === 'number') {
      var c = data.center;
      return { pts: circle(Array.isArray(c) ? c[0] : c.lat, Array.isArray(c) ? c[1] : c.lng, data.radius), closed: true };
    }
    if ((t === 'polyline' || t === 'freehand') && data.latlngs && data.latlngs.length >= 2) {
      pts = data.latlngs.map(function (p) { return Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lng]; });
      if (pts.length > 80) { var step = Math.ceil(pts.length / 80); pts = pts.filter(function (_, k) { return k % step === 0 || k === pts.length - 1; }); }
      return { pts: pts, closed: false };
    }
    return null;
  }

  var ARMath = {
    rotMatrix: rotMatrix, orthonormalize: orthonormalize, smoothMatrix: smoothMatrix, screenAxes: screenAxes,
    toCamera: toCamera, camToPixel: camToPixel, cameraLook: cameraLook, enuFrom: enuFrom, bearingOf: bearingOf,
    applyOffset: applyOffset, clipNear: clipNear, pointInPolygon: pointInPolygon, shapeRing: shapeRing,
    fmtDist: fmtDist, cardinal: cardinal, wrap180: wrap180
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ARMath;
  if (typeof window === 'undefined') return;

  // ---------- interface ----------
  var TAB_ID = 'tabRealidade';
  var LS = { fov: 'geosniper_ar_fov', off: 'geosniper_ar_offset_deg', wall: 'geosniper_ar_parede_m', range: 'geosniper_ar_alcance_m', eye: 'geosniper_ar_olho_m' };
  var st = {
    built: false, active: false, stream: null, raf: 0, timer: 0,
    R: null, hasAbs: false, lastAbsAt: 0, lastOriAt: 0, yawFix: 0,
    fov: num(LS.fov, 67), off: num(LS.off, 0), wall: num(LS.wall, 15), range: num(LS.range, 3000), eye: num(LS.eye, 1.6),
    filter: 'all', screenAngle: 0, hits: [], pose: null, selected: null, camError: ''
  };

  function num(key, def) {
    try { var v = parseFloat(localStorage.getItem(key)); return isNaN(v) ? def : v; } catch (e) { return def; }
  }
  function save(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  var CSS = '' +
    '#tabRealidade{background:#05070a;}' +
    '#tabRealidade .ar-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#0b0f14;}' +
    '#tabRealidade .ar-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:manipulation;}' +
    '#tabRealidade .ar-top{position:absolute;left:0;right:0;top:54px;display:flex;gap:6px;padding:6px 8px;flex-wrap:wrap;align-items:center;pointer-events:none;}' +
    '#tabRealidade .ar-top>*{pointer-events:auto;}' +
    '#tabRealidade select,#tabRealidade .ar-btn{background:rgba(12,16,22,.82);color:#f2d168;border:1px solid rgba(242,209,104,.45);border-radius:8px;padding:7px 9px;font:700 12px sans-serif;max-width:46vw;}' +
    '#tabRealidade .ar-btn{cursor:pointer;}' +
    '#tabRealidade .ar-bottom{position:absolute;left:0;right:0;bottom:0;padding:6px 10px;background:linear-gradient(transparent,rgba(0,0,0,.72));color:#e8edf2;font:600 12px sans-serif;pointer-events:none;display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;}' +
    '#tabRealidade .ar-panel{position:absolute;right:8px;top:104px;width:min(300px,86vw);background:rgba(12,16,22,.92);border:1px solid rgba(242,209,104,.4);border-radius:10px;padding:10px;color:#e8edf2;font:12px sans-serif;display:none;max-height:calc(100% - 160px);overflow:auto;}' +
    '#tabRealidade .ar-panel label{display:block;margin:8px 0 3px;font-weight:700;color:#f2d168;}' +
    '#tabRealidade .ar-panel input[type=range]{width:100%;}' +
    '#tabRealidade .ar-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}' +
    '#tabRealidade .ar-card{position:absolute;left:8px;right:8px;bottom:36px;background:rgba(12,16,22,.92);border:1px solid rgba(242,209,104,.5);border-radius:10px;padding:10px 12px;color:#e8edf2;font:13px sans-serif;display:none;}' +
    '#tabRealidade .ar-msg{position:absolute;left:12px;right:12px;bottom:46px;text-align:center;color:#f2d168;font:700 14px sans-serif;background:rgba(0,0,0,.55);padding:12px;border-radius:10px;display:none;}' +
    '#tabRealidade .ar-start{position:absolute;right:12px;bottom:100px;padding:12px 18px;font-size:14px;display:none;}' +
    'body.ar-full .tabs,body.ar-full #gpsAccuracyBadge{display:none !important;}' +
    'body.ar-full #tabRealidade{position:fixed;inset:0;height:100vh !important;min-height:0 !important;z-index:60;}' +
    'body.ar-full #tabRealidade .ar-top{top:54px;}';

  function build() {
    if (st.built) return;
    var tab = $(TAB_ID);
    if (!tab) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    tab.innerHTML =
      '<video id="arVideo" class="ar-video" playsinline muted autoplay></video>' +
      '<canvas id="arCanvas" class="ar-canvas"></canvas>' +
      '<div class="ar-top">' +
      '<select id="arFiltro" title="O que exibir na realidade aumentada"></select>' +
      '<select id="arAlcance" title="Alcance">' +
      [500, 1000, 2000, 3000, 5000, 20000].map(function (m) { return '<option value="' + m + '">Até ' + (m >= 1000 ? m / 1000 + ' km' : m + ' m') + '</option>'; }).join('') + '</select>' +
      '<button class="ar-btn" id="arBtnAjustes" type="button">⚙ Ajustes</button>' +
      '<button class="ar-btn" id="arBtnCheia" type="button">⛶ Tela cheia</button>' +
      '</div>' +
      '<div class="ar-panel" id="arPanel">' +
      '<label>Campo de visão da câmera: <span id="arFovTxt"></span>°</label><input type="range" id="arFov" min="40" max="100" step="1">' +
      '<label>Desvio da bússola: <span id="arOffTxt"></span>°</label>' +
      '<div class="ar-row"><button class="ar-btn" data-off="-5" type="button">−5</button><button class="ar-btn" data-off="-1" type="button">−1</button><button class="ar-btn" data-off="1" type="button">+1</button><button class="ar-btn" data-off="5" type="button">+5</button><button class="ar-btn" data-off="0" type="button">Zerar</button></div>' +
      '<div class="ar-row"><button class="ar-btn" id="arAlinhar" type="button">🎯 Alinhar no ponto central</button></div>' +
      '<div style="margin-top:4px;color:#9fb0c0;">Mire o centro da tela num marcador que você enxerga no terreno e toque em Alinhar: o app corrige o desvio da bússola (inclui a declinação magnética, que no Brasil fica entre −14° e −24°).</div>' +
      '<label>Altura das paredes das áreas</label><select id="arParede"><option value="3">3 m</option><option value="8">8 m</option><option value="15">15 m</option><option value="30">30 m</option><option value="60">60 m</option></select>' +
      '<label>Altura dos seus olhos (m): <span id="arEyeTxt"></span></label><input type="range" id="arEye" min="0.5" max="3" step="0.1">' +
      '</div>' +
      '<div class="ar-card" id="arCard"></div>' +
      '<div class="ar-msg" id="arMsg"></div>' +
      '<button class="ar-btn ar-start" id="arStart" type="button">📷 Ativar câmera e sensores</button>' +
      '<div class="ar-bottom"><span id="arSt1"></span><span id="arSt2"></span></div>';

    $('arFov').value = st.fov; $('arFovTxt').textContent = st.fov;
    $('arEye').value = st.eye; $('arEyeTxt').textContent = st.eye.toFixed(1);
    $('arParede').value = String(st.wall);
    $('arAlcance').value = String(st.range);
    $('arOffTxt').textContent = st.off.toFixed(0);

    $('arFov').addEventListener('input', function () { st.fov = +this.value; $('arFovTxt').textContent = st.fov; save(LS.fov, st.fov); });
    $('arEye').addEventListener('input', function () { st.eye = +this.value; $('arEyeTxt').textContent = st.eye.toFixed(1); save(LS.eye, st.eye); });
    $('arParede').addEventListener('change', function () { st.wall = +this.value; save(LS.wall, st.wall); });
    $('arAlcance').addEventListener('change', function () { st.range = +this.value; save(LS.range, st.range); buildFilter(); });
    $('arFiltro').addEventListener('change', function () { st.filter = this.value; st.selected = null; $('arCard').style.display = 'none'; });
    $('arBtnAjustes').addEventListener('click', function () { var p = $('arPanel'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; });
    $('arBtnCheia').addEventListener('click', toggleFull);
    $('arStart').addEventListener('click', function () { startAll(true); });
    $('arAlinhar').addEventListener('click', alignOnCenter);
    $('arPanel').querySelectorAll('[data-off]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = +this.getAttribute('data-off');
        setOffset(v === 0 ? 0 : st.off + v);
      });
    });
    $('arCanvas').addEventListener('click', onCanvasTap);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', onResize);
    document.addEventListener('visibilitychange', function () {
      if (!st.active) return;
      if (document.hidden) stopCamera(); else startCamera();
    });
    st.built = true;
  }

  function setOffset(v) {
    st.off = wrap180(v);
    save(LS.off, st.off);
    var t = $('arOffTxt'); if (t) t.textContent = st.off.toFixed(0);
  }

  function toggleFull() {
    document.body.classList.toggle('ar-full');
    var b = $('arBtnCheia');
    var full = document.body.classList.contains('ar-full');
    if (b) b.textContent = full ? '✕ Sair da tela cheia' : '⛶ Tela cheia';
    onResize();
  }

  function onResize() {
    st.screenAngle = st.fakeAngle != null ? st.fakeAngle : (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (typeof window.orientation === 'number' ? (window.orientation + 360) % 360 : 0);
    var c = $('arCanvas'), tab = $(TAB_ID);
    if (!c || !tab) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = tab.clientWidth, h = tab.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    st.dpr = dpr; st.W = w; st.H = h;
  }

  // ---------- sensores / câmera ----------
  function onOrientation(ev, absolute) {
    if (ev.alpha === null || ev.alpha === undefined || ev.beta === null) return;
    var now = performance.now();
    if (absolute) { st.hasAbs = true; st.lastAbsAt = now; }
    else if (st.hasAbs && now - st.lastAbsAt < 1500) return; // há evento absoluto recente: ignora o relativo
    st.lastOriAt = now;
    var alpha = ev.alpha;
    if (!absolute && typeof ev.webkitCompassHeading === 'number') {
      // iOS: alpha é relativo; ancora pelo compasso quando o aparelho está quase deitado.
      if (Math.abs(ev.beta) < 40 && Math.abs(ev.gamma) < 40) st.yawFix = (360 - ev.webkitCompassHeading) - ev.alpha;
      alpha = ev.alpha + st.yawFix;
    }
    var R = rotMatrix(alpha, ev.beta, ev.gamma || 0);
    st.R = smoothMatrix(st.R, R, 0.35);
  }
  var onAbs = function (e) { onOrientation(e, true); };
  var onRel = function (e) { onOrientation(e, false); };

  function startOrientation() {
    var attach = function () {
      window.removeEventListener('deviceorientationabsolute', onAbs, true);
      window.removeEventListener('deviceorientation', onRel, true);
      window.addEventListener('deviceorientationabsolute', onAbs, true);
      window.addEventListener('deviceorientation', onRel, true);
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission().then(function (r) { if (r === 'granted') attach(); }).catch(function () {});
    }
    attach();
    return Promise.resolve();
  }

  function startCamera() {
    if (st.stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!navigator.mediaDevices) st.camError = 'Câmera indisponível neste navegador.';
      return Promise.resolve();
    }
    var v = $('arVideo');
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (s) { st.stream = s; st.camError = ''; v.srcObject = s; var p = v.play(); if (p && p.catch) p.catch(function () {}); })
      .catch(function () { st.camError = 'Sem acesso à câmera: libere a permissão. As marcações continuam aparecendo sobre fundo escuro.'; });
  }

  function stopCamera() {
    if (st.stream) { st.stream.getTracks().forEach(function (t) { t.stop(); }); st.stream = null; }
    var v = $('arVideo'); if (v) v.srcObject = null;
  }

  function startAll(fromTap) {
    var s = $('arStart'); if (s) s.style.display = 'none';
    startOrientation();
    return startCamera().then(function () {
      if (st.camError && !fromTap) { var s2 = $('arStart'); if (s2) s2.style.display = 'block'; }
    });
  }

  // ---------- dados ----------
  function operatorPos() {
    var g = (typeof gpsLatestReading !== 'undefined') ? gpsLatestReading : null;
    if (st.fakePos) return st.fakePos;
    return g ? { lat: g.lat, lng: g.lng, acc: g.acc } : null;
  }

  function markerList() {
    var out = [];
    var src = (typeof tacticalMarkers !== 'undefined') ? tacticalMarkers : {};
    Object.keys(src).forEach(function (id) {
      var m = src[id];
      if (m && typeof m.lat === 'number' && typeof m.lng === 'number') out.push(m);
    });
    return out;
  }
  function drawingList() {
    var out = [];
    var src = (typeof tacticalDrawings !== 'undefined') ? tacticalDrawings : {};
    Object.keys(src).forEach(function (id) {
      var d = src[id]; var ring = d && shapeRing(d);
      if (ring) out.push({ d: d, ring: ring });
    });
    return out;
  }
  var SHAPE_NAME = { rectangle: 'Retângulo', circle: 'Círculo', encirclement: 'Envolvimento', polyline: 'Caminho', freehand: 'Traço' };
  function drawingName(d, idx) { return d.label || d.name || ('Área ' + (idx + 1) + ' · ' + (SHAPE_NAME[d.shapeType] || d.shapeType)); }
  function markerName(m) { return m.label || (typeof getTacticalType === 'function' ? getTacticalType(m.type).label : m.type) || 'Ponto'; }

  function buildFilter() {
    var sel = $('arFiltro'); if (!sel) return;
    var pos = operatorPos();
    var ms = markerList();
    if (pos) ms.sort(function (a, b) { return dist(pos, a) - dist(pos, b); });
    var types = {};
    ms.forEach(function (m) { types[m.type] = (typeof getTacticalType === 'function' ? getTacticalType(m.type).label : m.type); });
    var ds = drawingList();
    var html = '<option value="all">Exibir tudo</option><option value="markers">Só marcadores</option><option value="areas">Só áreas (paredes)</option>';
    var tk = Object.keys(types);
    if (tk.length) html += '<optgroup label="Tipo de marcador">' + tk.map(function (t) { return '<option value="t:' + esc(t) + '">' + esc(types[t]) + '</option>'; }).join('') + '</optgroup>';
    if (ms.length) html += '<optgroup label="Marcador específico">' + ms.slice(0, 80).map(function (m) { return '<option value="m:' + esc(m.id) + '">' + esc(markerName(m) + (m.localidade ? ' · ' + m.localidade : '')) + '</option>'; }).join('') + '</optgroup>';
    if (ds.length) html += '<optgroup label="Área específica">' + ds.map(function (x, i) { return '<option value="d:' + esc(x.d.id) + '">' + esc(drawingName(x.d, i)) + '</option>'; }).join('') + '</optgroup>';
    var key = html;
    if (st.lastFilterHtml === key) return;
    st.lastFilterHtml = key;
    sel.innerHTML = html;
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === st.filter; });
    if (!has) st.filter = 'all';
    sel.value = st.filter;
  }

  function dist(pos, p) {
    var v = enuFrom(pos.lat, pos.lng, p.lat, p.lng);
    return Math.hypot(v[0], v[1]);
  }

  function wantMarker(m) {
    var f = st.filter;
    if (f === 'all' || f === 'markers') return true;
    if (f.indexOf('t:') === 0) return m.type === f.slice(2);
    if (f.indexOf('m:') === 0) return String(m.id) === f.slice(2);
    return false;
  }
  function wantArea(d) {
    var f = st.filter;
    if (f === 'all' || f === 'areas') return true;
    if (f.indexOf('d:') === 0) return String(d.id) === f.slice(2);
    return false;
  }

  // ---------- desenho ----------
  var iconCache = {};
  function iconFor(type) {
    if (iconCache[type]) return iconCache[type];
    var url = (typeof getTacticalType === 'function') ? getTacticalType(type).icon : null;
    var img = new Image();
    img.src = url || '';
    iconCache[type] = img;
    return img;
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [250, 204, 21];
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function frame() {
    st.raf = requestAnimationFrame(frame);
    var cv = $('arCanvas'); if (!cv) return;
    if (!st.W) onResize();
    var ctx = cv.getContext('2d');
    var dpr = st.dpr || 1, W = st.W, H = st.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var pos = operatorPos();
    var R = st.R;
    var info1 = $('arSt1'), info2 = $('arSt2'), msg = $('arMsg');
    var warn = '';
    if (!pos) warn = '📡 Aguardando o GPS…';
    else if (!R || (!st.fakePose && performance.now() - st.lastOriAt > 3000)) warn = '🧭 Sem leitura do sensor de orientação. Mova o aparelho; se persistir, veja a permissão de sensores.';
    else if (st.camError) warn = st.camError;
    if (msg) { msg.style.display = warn ? 'block' : 'none'; msg.textContent = warn; }
    if (!pos || !R) { if (info1) info1.textContent = ''; if (info2) info2.textContent = ''; st.hits = []; return; }

    // Câmera
    var v = $('arVideo');
    var vw = (v && v.videoWidth) || 1280, vh = (v && v.videoHeight) || 720;
    if ((vw > vh) !== (W > H)) { var t0 = vw; vw = vh; vh = t0; }
    var scale = Math.max(W / vw, H / vh);
    var Lpx = Math.max(vw, vh) * scale;
    var cam = { cx: W / 2, cy: H / 2, f: (Lpx / 2) / Math.tan(st.fov * D2R / 2) };
    var axes = screenAxes(st.screenAngle);
    var look = cameraLook(R);
    var headTrue = (look.heading + st.off + 360) % 360;
    var NEAR = 0.8;

    function toCam(e, n, up) {
      var rn = applyOffset(e, n, st.off);
      return toCamera(R, axes, [rn[0], rn[1], up - st.eye]);
    }

    var hits = [];
    var inside = null;

    // Linha do horizonte (referência)
    (function () {
      var a = toCam(Math.sin((headTrue - 35) * D2R) * 2000, Math.cos((headTrue - 35) * D2R) * 2000, st.eye);
      var b = toCam(Math.sin((headTrue + 35) * D2R) * 2000, Math.cos((headTrue + 35) * D2R) * 2000, st.eye);
      if (a.z > NEAR && b.z > NEAR) {
        var pa = camToPixel(a, cam), pb = camToPixel(b, cam);
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
      }
    })();

    // Paredes (áreas)
    var walls = [];
    drawingList().forEach(function (x, idx) {
      if (!wantArea(x.d)) return;
      var color = hexToRgb(x.d.color);
      var pts = x.ring.pts.map(function (p) { return enuFrom(pos.lat, pos.lng, p[0], p[1]); });
      var minD = Infinity;
      pts.forEach(function (p) { minD = Math.min(minD, Math.hypot(p[0], p[1])); });
      if (x.ring.closed && pointInPolygon(0, 0, pts)) { inside = inside || drawingName(x.d, idx); minD = 0; }
      if (minD > st.range) return;
      var n = pts.length, last = x.ring.closed ? n : n - 1;
      for (var i = 0; i < last; i++) {
        var p1 = pts[i], p2 = pts[(i + 1) % n];
        var c1 = toCam(p1[0], p1[1], 0), c2 = toCam(p2[0], p2[1], 0);
        var c3 = toCam(p2[0], p2[1], st.wall), c4 = toCam(p1[0], p1[1], st.wall);
        var poly = clipNear([c1, c2, c3, c4], NEAR);
        if (poly.length < 3) continue;
        var depth = (c1.z + c2.z) / 2;
        walls.push({ poly: poly, depth: depth, color: color, bottom: [c1, c2] });
      }
    });
    walls.sort(function (a, b) { return b.depth - a.depth; });
    walls.forEach(function (w) {
      var px = w.poly.map(function (c) { return camToPixel(c, cam); });
      var ys = px.map(function (p) { return p.y; });
      var top = Math.min.apply(null, ys), bot = Math.max.apply(null, ys);
      var g = ctx.createLinearGradient(0, bot, 0, top);
      var rgb = w.color.join(',');
      g.addColorStop(0, 'rgba(' + rgb + ',0.38)');
      g.addColorStop(1, 'rgba(' + rgb + ',0.07)');
      ctx.fillStyle = g;
      ctx.beginPath(); px.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(' + rgb + ',0.95)'; ctx.lineWidth = 1.6;
      ctx.stroke();
    });

    // Marcadores
    var items = [];
    markerList().forEach(function (m) {
      if (!wantMarker(m)) return;
      var e = enuFrom(pos.lat, pos.lng, m.lat, m.lng);
      var d = Math.hypot(e[0], e[1]);
      if (d > st.range) return;
      items.push({ m: m, e: e, d: d });
    });
    items.sort(function (a, b) { return a.d - b.d; });

    var labelRects = [];
    var offscreen = [];
    items.forEach(function (it) {
      var ground = toCam(it.e[0], it.e[1], 0);
      var head = toCam(it.e[0], it.e[1], 4);
      var onScreen = false;
      if (head.z > NEAR) {
        var ph = camToPixel(head, cam), pg = camToPixel(ground, cam);
        var size = Math.max(28, Math.min(56, 22 + 3000 / (it.d + 60)));
        if (ph.x > -size && ph.x < W + size && ph.y > -size && ph.y < H + size) {
          onScreen = true;
          ctx.strokeStyle = 'rgba(242,209,104,.65)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(ph.x, ph.y + size / 2); ctx.lineTo(pg.x, pg.y); ctx.stroke();
          ctx.fillStyle = 'rgba(242,209,104,.9)'; ctx.beginPath(); ctx.arc(pg.x, pg.y, 3, 0, 6.2832); ctx.fill();
          var img = iconFor(it.m.type);
          if (img.complete && img.naturalWidth) ctx.drawImage(img, ph.x - size / 2, ph.y - size / 2, size, size);
          else { ctx.fillStyle = '#f2d168'; ctx.beginPath(); ctx.arc(ph.x, ph.y, size / 3, 0, 6.2832); ctx.fill(); }
          var txt = markerName(it.m) + ' · ' + fmtDist(it.d);
          ctx.font = '700 12px sans-serif';
          var tw = ctx.measureText(txt).width + 12, th = 18;
          var rx = ph.x - tw / 2, ry = ph.y + size / 2 + 3;
          var clash = labelRects.some(function (r) { return rx < r.x + r.w && rx + tw > r.x && ry < r.y + r.h && ry + th > r.y; });
          if (!clash) {
            labelRects.push({ x: rx, y: ry, w: tw, h: th });
            ctx.fillStyle = 'rgba(8,11,16,.78)'; ctx.fillRect(rx, ry, tw, th);
            ctx.strokeStyle = 'rgba(242,209,104,.7)'; ctx.lineWidth = 1; ctx.strokeRect(rx, ry, tw, th);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, ph.x, ry + th / 2 + 0.5);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          }
          hits.push({ kind: 'm', id: it.m.id, x: ph.x - size / 2, y: ph.y - size / 2, w: size, h: size + 24 });
        }
      }
      if (!onScreen) offscreen.push({ it: it, c: head.z > 0 ? head : ground });
    });

    // Setas de borda para o que está fora da tela
    offscreen.slice(0, 10).forEach(function (o) {
      var c = o.c;
      var dx = c.x, dy = -c.y;
      if (c.z < 0) { dx = -dx; dy = -dy; }
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dx = 1;
      var ang = Math.atan2(dy, dx);
      var mx = W / 2 - 26, my = H / 2 - 62;
      var tx = Math.cos(ang), ty = Math.sin(ang);
      var k = Math.min(Math.abs(tx) > 1e-6 ? mx / Math.abs(tx) : 1e9, Math.abs(ty) > 1e-6 ? my / Math.abs(ty) : 1e9);
      var x = W / 2 + tx * k, y = H / 2 + ty * k + 6;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(242,209,104,.92)'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.font = '700 10px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3;
      var lb = fmtDist(o.it.d);
      ctx.strokeText(lb, x, y + 22); ctx.fillText(lb, x, y + 22); ctx.textAlign = 'left';
    });

    // Faixa de bússola
    drawCompass(ctx, W, cam.f, headTrue, items);

    if (inside) {
      var bar = document.querySelector('#tabRealidade .ar-top');
      var by = 54 + (bar ? bar.offsetHeight : 36) + 4, bw = Math.min(W - 16, 340);
      ctx.fillStyle = 'rgba(193,72,61,.88)'; ctx.fillRect(W / 2 - bw / 2, by, bw, 24);
      ctx.fillStyle = '#fff'; ctx.font = '800 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠ VOCÊ ESTÁ DENTRO: ' + inside, W / 2, by + 12, bw - 12); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    st.hits = hits;
    st.pose = { heading: headTrue, rawHeading: look.heading, pitch: look.pitch };
    var accTxt = pos.acc != null ? '±' + Math.round(pos.acc) + ' m' : '—';
    if (info1) info1.textContent = '📡 GPS ' + accTxt + ' · 🧭 ' + Math.round(headTrue) + '° ' + cardinal(headTrue) + ' · ↕ ' + (look.pitch >= 0 ? '+' : '') + Math.round(look.pitch) + '°';
    if (info2) info2.textContent = items.length + ' ponto(s) · ' + walls.length + ' parede(s)' + (st.off ? ' · desvio ' + (st.off > 0 ? '+' : '') + st.off.toFixed(0) + '°' : '');
  }

  function drawCompass(ctx, W, f, heading, items) {
    var top = 4, h = 26;
    var pxPerDeg = f * D2R;
    ctx.fillStyle = 'rgba(8,11,16,.7)'; ctx.fillRect(0, top, W, h);
    ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var span = W / pxPerDeg / 2 + 5;
    var start = Math.floor((heading - span) / 5) * 5;
    for (var a = start; a <= heading + span; a += 5) {
      var x = W / 2 + (a - heading) * pxPerDeg;
      var norm = ((a % 360) + 360) % 360;
      var major = norm % 45 === 0, mid = norm % 15 === 0;
      ctx.strokeStyle = major ? '#f2d168' : 'rgba(255,255,255,.6)'; ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, top + h); ctx.lineTo(x, top + h - (major ? 12 : mid ? 8 : 4)); ctx.stroke();
      if (major) { ctx.fillStyle = norm % 90 === 0 ? '#f2d168' : '#fff'; ctx.fillText(cardinal(norm), x, top + 8); }
      else if (mid && pxPerDeg * 15 > 30) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 10px sans-serif'; ctx.fillText(String(norm), x, top + 8); ctx.font = '700 12px sans-serif'; }
    }
    items.slice(0, 40).forEach(function (it) {
      var b = bearingOf(it.e[0], it.e[1]);
      var diff = wrap180(b - heading);
      var x = W / 2 + diff * pxPerDeg;
      if (x < 4 || x > W - 4) return;
      ctx.fillStyle = '#ff5a4a';
      ctx.beginPath(); ctx.moveTo(x, top + h + 1); ctx.lineTo(x - 4, top + h + 8); ctx.lineTo(x + 4, top + h + 8); ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W / 2, top + h + 1); ctx.lineTo(W / 2 - 5, top + h + 9); ctx.lineTo(W / 2 + 5, top + h + 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 11px sans-serif';
    ctx.fillText(Math.round(heading) + '°', W / 2, top + h + 19);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function onCanvasTap(ev) {
    var r = $('arCanvas').getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    var hit = null;
    for (var i = st.hits.length - 1; i >= 0; i--) {
      var h = st.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) { hit = h; break; }
    }
    var card = $('arCard');
    if (!hit) { card.style.display = 'none'; return; }
    var m = (typeof tacticalMarkers !== 'undefined') ? tacticalMarkers[hit.id] : null;
    var pos = operatorPos();
    if (!m || !pos) return;
    var e = enuFrom(pos.lat, pos.lng, m.lat, m.lng);
    var d = Math.hypot(e[0], e[1]), b = bearingOf(e[0], e[1]);
    var rows = ['<b style="color:#f2d168">' + esc(markerName(m)) + '</b> · ' + fmtDist(d) + ' · rumo ' + Math.round(b) + '° ' + cardinal(b)];
    if (m.localidade) rows.push('📍 ' + esc(m.localidade));
    if (m.observation) rows.push('📝 ' + esc(m.observation));
    var who = [m.unitName, m.operator || m.responsavel].filter(Boolean).join(' · ');
    if (who) rows.push('👤 ' + esc(who));
    card.innerHTML = rows.join('<br>') + '<div style="text-align:right;margin-top:6px;"><button class="ar-btn" type="button" onclick="document.getElementById(\'arCard\').style.display=\'none\'">Fechar</button></div>';
    card.style.display = 'block';
  }

  // Corrige o desvio da bússola usando o marcador mais próximo do centro da tela.
  function alignOnCenter() {
    var pos = operatorPos();
    if (!pos || !st.pose) return;
    var best = null;
    markerList().forEach(function (m) {
      var e = enuFrom(pos.lat, pos.lng, m.lat, m.lng);
      var d = Math.hypot(e[0], e[1]);
      if (d < 30 || d > st.range) return;
      var diff = wrap180(bearingOf(e[0], e[1]) - st.pose.rawHeading); // rumo real − rumo medido
      if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { m: m, diff: diff };
    });
    var msg = $('arMsg');
    if (!best || Math.abs(best.diff) > 35) {
      if (msg) { msg.textContent = 'Nenhum marcador perto do centro da tela. Aponte para um marcador que você consiga ver no terreno e tente de novo.'; msg.style.display = 'block'; setTimeout(function () { msg.style.display = 'none'; }, 3500); }
      return;
    }
    setOffset(best.diff);
    if (msg) { msg.textContent = '🎯 Bússola alinhada em "' + markerName(best.m) + '": desvio ' + st.off.toFixed(0) + '°.'; msg.style.display = 'block'; setTimeout(function () { msg.style.display = 'none'; }, 3000); }
  }

  // ---------- ciclo de vida ----------
  function start() {
    build();
    if (!st.built || st.active) return;
    st.active = true;
    onResize();
    buildFilter();
    st.timer = setInterval(buildFilter, 2500);
    if (!st.raf) st.raf = requestAnimationFrame(frame);
    startAll(false);
  }
  function stop() {
    if (!st.active) return;
    st.active = false;
    clearInterval(st.timer);
    cancelAnimationFrame(st.raf); st.raf = 0;
    window.removeEventListener('deviceorientationabsolute', onAbs, true);
    window.removeEventListener('deviceorientation', onRel, true);
    stopCamera();
    document.body.classList.remove('ar-full');
    var b = $('arBtnCheia'); if (b) b.textContent = '⛶ Tela cheia';
  }

  root.GeoAR = {
    start: start, stop: stop, math: ARMath, state: st,
    // gancho de teste (não usado pelo app): pose e posição simuladas
    _setPose: function (alpha, beta, gamma) { st.fakePose = true; st.hasAbs = true; st.lastAbsAt = st.lastOriAt = performance.now(); st.R = rotMatrix(alpha, beta, gamma); },
    _setPos: function (lat, lng, acc) { st.fakePos = lat == null ? null : { lat: lat, lng: lng, acc: acc || 5 }; },
    _setAngle: function (a) { st.fakeAngle = a; st.screenAngle = a; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
