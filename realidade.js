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
  var LS = {
    fov: 'geosniper_ar_fov', off: 'geosniper_ar_offset_deg', wall: 'geosniper_ar_parede_m', range: 'geosniper_ar_alcance_m', eye: 'geosniper_ar_olho_m',
    elev: 'geosniper_ar_elevado', elevAng: 'geosniper_ar_elevado_ang', elevMax: 'geosniper_ar_elevado_max_m',
    walk: 'geosniper_ar_kmh_pe', car: 'geosniper_ar_kmh_veiculo',
    radar: 'geosniper_ar_radar', radarRange: 'geosniper_ar_radar_alcance', radarHead: 'geosniper_ar_radar_frente'
  };
  var st = {
    built: false, active: false, stream: null, raf: 0, timer: 0, frameN: 0,
    R: null, hasAbs: false, lastAbsAt: 0, lastOriAt: 0, yawFix: 0,
    fov: num(LS.fov, 67), off: num(LS.off, 0), wall: num(LS.wall, 15), range: num(LS.range, 3000), eye: num(LS.eye, 1.6),
    elev: num(LS.elev, 1), elevAng: num(LS.elevAng, 45), elevMax: num(LS.elevMax, 5000),
    walk: num(LS.walk, 5), car: num(LS.car, 40),
    radarOpen: num(LS.radar, 0) === 1, radarMin: false, radarFull: false, radarRange: strv(LS.radarRange, 'auto'), radarUp: num(LS.radarHead, 1) === 1,
    ctlMin: false, rd: null,
    filter: 'all', screenAngle: 0, hits: [], pose: null, selected: null, camError: ''
  };

  function num(key, def) {
    try { var v = parseFloat(localStorage.getItem(key)); return isNaN(v) ? def : v; } catch (e) { return def; }
  }
  function strv(key, def) {
    try { var v = localStorage.getItem(key); return v == null ? def : v; } catch (e) { return def; }
  }
  function save(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  var CSS = '' +
    '#tabRealidade{background:#05070a;}' +
    '#tabRealidade .ar-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#0b0f14;}' +
    '#tabRealidade .ar-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:manipulation;}' +
    '#tabRealidade select,#tabRealidade .ar-btn{background:rgba(12,16,22,.82);color:#f2d168;border:1px solid rgba(242,209,104,.45);border-radius:8px;padding:7px 9px;font:700 12px sans-serif;max-width:100%;}' +
    '#tabRealidade .ar-btn{cursor:pointer;}' +
    '#tabRealidade .ar-bottom{position:absolute;left:0;right:0;bottom:0;padding:6px 10px;background:linear-gradient(transparent,rgba(0,0,0,.72));color:#e8edf2;font:600 12px sans-serif;pointer-events:none;display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;}' +
    '#tabRealidade .ar-win,#tabRealidade .ar-ctl{background:rgba(12,16,22,.86);border:1px solid rgba(242,209,104,.45);border-radius:10px;color:#e8edf2;font:11px sans-serif;pointer-events:auto;}' +
    '#tabRealidade .ar-wh{display:flex;align-items:center;gap:4px;padding:4px 6px;background:rgba(242,209,104,.12);border-radius:9px 9px 0 0;color:#f2d168;font:700 11px sans-serif;}' +
    '#tabRealidade .ar-wh .sp{flex:1;}' +
    '#tabRealidade .ar-wh button{background:rgba(0,0,0,.4);color:#f2d168;border:1px solid rgba(242,209,104,.4);border-radius:6px;padding:2px 7px;font:700 11px sans-serif;cursor:pointer;}' +
    '#tabRealidade .ar-wb{padding:6px;}' +
    '#tabRealidade .ar-win.min .ar-wb,#tabRealidade .ar-ctl.min .ar-wb{display:none;}' +
    '#tabRealidade .ar-win.min .ar-wh,#tabRealidade .ar-ctl.min .ar-wh{border-radius:9px;}' +
    '#tabRealidade .ar-ctl{position:absolute;left:8px;top:54px;width:min(340px,calc(100% - 16px));max-height:calc(100% - 150px);overflow:auto;z-index:5;}' +
    '#tabRealidade .ar-ctl.min{width:auto;overflow:visible;}' +
    '#tabRealidade .ar-g2{display:grid;grid-template-columns:1fr 1fr;gap:6px;}' +
    '#tabRealidade .ar-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px;}' +
    '#tabRealidade .ar-g3 .ar-btn{padding:7px 4px;font-size:11px;}' +
    '#tabRealidade .ar-panel{display:none;margin-top:8px;border-top:1px solid rgba(242,209,104,.3);padding-top:4px;font:12px sans-serif;max-height:46vh;overflow:auto;}' +
    '#tabRealidade .ar-panel label{display:block;margin:8px 0 3px;font-weight:700;color:#f2d168;}' +
    '#tabRealidade .ar-panel select{width:100%;}' +
    '#tabRealidade .ar-panel input[type=range]{width:100%;}' +
    '#tabRealidade .ar-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}' +
    '#tabRealidade .ar-card{position:absolute;left:8px;right:8px;bottom:36px;z-index:6;background:rgba(12,16,22,.92);border:1px solid rgba(242,209,104,.5);border-radius:10px;padding:10px 12px;color:#e8edf2;font:13px sans-serif;display:none;}' +
    '#tabRealidade .ar-msg{position:absolute;left:12px;right:12px;top:38%;text-align:center;color:#f2d168;font:700 14px sans-serif;background:rgba(0,0,0,.55);padding:12px;border-radius:10px;display:none;z-index:4;}' +
    '#tabRealidade .ar-start{position:absolute;left:50%;top:54%;transform:translateX(-50%);padding:12px 18px;font-size:14px;display:none;z-index:4;}' +
    '#tabRealidade .ar-dock{position:absolute;left:8px;bottom:46px;display:flex;flex-direction:column-reverse;align-items:flex-start;gap:6px;pointer-events:none;z-index:3;}' +
    '#tabRealidade .ar-dock .ar-win{width:208px;}' +
    '#tabRealidade .ar-dock.hide{display:none;}' +
    '#tabRealidade #arRadarCv{display:block;width:min(188px,34vh,50vw);aspect-ratio:1;margin:0 auto;}' +
    '#tabRealidade .ar-rdft{display:flex;gap:6px;align-items:center;justify-content:space-between;margin-top:4px;color:#9fb0c0;}' +
    '#tabRealidade .ar-rdft select{padding:3px 5px;font-size:11px;border-radius:6px;}' +
    '#tabRealidade #arInfoBody{max-height:min(17vh,112px);overflow:auto;padding:4px 6px;}' +
    '#tabRealidade .ar-it{display:grid;grid-template-columns:14px 1fr auto;gap:4px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:10px;line-height:1.25;}' +
    '#tabRealidade .ar-it b{color:#f2d168;}' +
    '#tabRealidade .ar-it span.t{color:#9fe8a8;white-space:nowrap;text-align:right;}' +
    '#tabRealidade.ar-rfull #arCanvas{visibility:hidden;}' +
    '#tabRealidade.ar-rfull .ar-start,#tabRealidade.ar-rfull .ar-msg{display:none !important;}' +
    '#tabRealidade.ar-rfull .ar-dock{left:0;right:0;top:0;bottom:0;padding:0 8px 40px;flex-direction:column;align-items:stretch;background:#03100a;z-index:3;}' +
    '#tabRealidade.ar-rfull .ar-dock .ar-win{width:auto;}' +
    '#tabRealidade.ar-rfull #arRadarWin{flex:1;min-height:0;overflow:hidden;}' +
    '#tabRealidade.ar-rfull #arInfoWin{max-height:32%;overflow:auto;}' +
    '@media (orientation:landscape){#tabRealidade .ar-dock{left:auto;right:8px;bottom:34px;flex-direction:row;align-items:flex-end;}#tabRealidade #arInfoBody{max-height:30vh;}#tabRealidade.ar-rfull .ar-dock{flex-direction:row;align-items:stretch;}#tabRealidade.ar-rfull #arInfoWin{max-height:none;width:240px;flex:none;}}' +
    'body.ar-full .tabs,body.ar-full #gpsAccuracyBadge{display:none !important;}' +
    'body.ar-full #tabRealidade{position:fixed;inset:0;height:100vh !important;min-height:0 !important;z-index:60;}' +
    '';

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
      '<div class="ar-ctl" id="arCtl">' +
      '<div class="ar-wh"><b>🎛 Controles</b><span class="sp"></span><button id="arCtlMin" type="button" title="Minimizar / abrir">▾</button></div>' +
      '<div class="ar-wb">' +
      '<div class="ar-g2"><select id="arFiltro" title="O que exibir na realidade aumentada"></select>' +
      '<select id="arAlcance" title="Alcance">' +
      [500, 1000, 2000, 3000, 5000, 20000].map(function (m) { return '<option value="' + m + '">Até ' + (m >= 1000 ? m / 1000 + ' km' : m + ' m') + '</option>'; }).join('') + '</select></div>' +
      '<div class="ar-g3"><button class="ar-btn" id="arBtnAjustes" type="button">⚙ Ajustes</button>' +
      '<button class="ar-btn" id="arBtnRadar" type="button">📡 Radar</button>' +
      '<button class="ar-btn" id="arBtnCheia" type="button">⛶ Tela cheia</button></div>' +
      '<div class="ar-panel" id="arPanel">' +
      '<label>Campo de visão da câmera: <span id="arFovTxt"></span>°</label><input type="range" id="arFov" min="40" max="100" step="1">' +
      '<label>Desvio da bússola: <span id="arOffTxt"></span>°</label>' +
      '<div class="ar-row"><button class="ar-btn" data-off="-5" type="button">−5</button><button class="ar-btn" data-off="-1" type="button">−1</button><button class="ar-btn" data-off="1" type="button">+1</button><button class="ar-btn" data-off="5" type="button">+5</button><button class="ar-btn" data-off="0" type="button">Zerar</button></div>' +
      '<div class="ar-row"><button class="ar-btn" id="arAlinhar" type="button">🎯 Alinhar no ponto central</button></div>' +
      '<div style="margin-top:4px;color:#9fb0c0;">Mire o centro da tela num marcador que você enxerga no terreno e toque em Alinhar: o app corrige o desvio da bússola (inclui a declinação magnética, que no Brasil fica entre −14° e −24°).</div>' +
      '<label>Marcador elevado (gêmeo no céu)</label><select id="arElev"><option value="1">Ligado</option><option value="0">Desligado</option></select>' +
      '<label>Ângulo do marcador elevado</label><select id="arElevAng"><option value="20">20° acima do horizonte</option><option value="30">30°</option><option value="45">45°</option><option value="60">60°</option></select>' +
      '<label>Limite do marcador elevado</label><select id="arElevMax"><option value="300">Até 300 m</option><option value="1000">Até 1 km</option><option value="2000">Até 2 km</option><option value="5000">Até 5 km</option><option value="20000">Até 20 km</option></select>' +
      '<label>Velocidade a pé / de veículo (km/h)</label><div class="ar-g2"><select id="arWalk"><option value="4">🚶 4</option><option value="5">🚶 5</option><option value="6">🚶 6</option></select><select id="arCar"><option value="30">🚗 30</option><option value="40">🚗 40</option><option value="60">🚗 60</option><option value="80">🚗 80</option></select></div>' +
      '<label>Altura das paredes das áreas</label><select id="arParede"><option value="3">3 m</option><option value="8">8 m</option><option value="15">15 m</option><option value="30">30 m</option><option value="60">60 m</option></select>' +
      '<label>Altura dos seus olhos (m): <span id="arEyeTxt"></span></label><input type="range" id="arEye" min="0.5" max="3" step="0.1">' +
      '</div>' +
      '</div></div>' +
      '<div class="ar-dock hide" id="arDock">' +
      '<div class="ar-win" id="arRadarWin">' +
      '<div class="ar-wh"><b>📡 Radar</b><span class="sp"></span><button id="arRdHead" type="button" title="Frente do operador para cima / Norte para cima">▲ frente</button><button id="arRdFull" type="button" title="Radar em tela cheia / voltar à câmera">⤢</button><button id="arRdMin" type="button" title="Minimizar">▾</button><button id="arRdClose" type="button" title="Fechar o radar">✕</button></div>' +
      '<div class="ar-wb"><canvas id="arRadarCv"></canvas>' +
      '<div class="ar-rdft"><span>Alcance</span><select id="arRdRange"><option value="auto">Automático</option><option value="200">200 m</option><option value="500">500 m</option><option value="1000">1 km</option><option value="2000">2 km</option><option value="5000">5 km</option><option value="10000">10 km</option><option value="20000">20 km</option></select></div></div>' +
      '</div>' +
      '<div class="ar-win" id="arInfoWin">' +
      '<div class="ar-wh"><b>🎯 Alvos</b><span style="font-weight:400;color:#9fb0c0">linha reta</span><span class="sp"></span><button id="arInfMin" type="button" title="Minimizar">▾</button></div>' +
      '<div id="arInfoBody" class="ar-wb"></div>' +
      '</div>' +
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
    $('arElev').value = String(st.elev); $('arElevAng').value = String(st.elevAng); $('arElevMax').value = String(st.elevMax);
    $('arWalk').value = String(st.walk); $('arCar').value = String(st.car);
    $('arRdRange').value = st.radarRange;

    $('arElev').addEventListener('change', function () { st.elev = +this.value; save(LS.elev, st.elev); });
    $('arElevAng').addEventListener('change', function () { st.elevAng = +this.value; save(LS.elevAng, st.elevAng); });
    $('arElevMax').addEventListener('change', function () { st.elevMax = +this.value; save(LS.elevMax, st.elevMax); });
    $('arWalk').addEventListener('change', function () { st.walk = +this.value; save(LS.walk, st.walk); updateInfo(); });
    $('arCar').addEventListener('change', function () { st.car = +this.value; save(LS.car, st.car); updateInfo(); });
    $('arCtlMin').addEventListener('click', function () {
      st.ctlMin = !st.ctlMin;
      $('arCtl').classList.toggle('min', st.ctlMin);
      this.textContent = st.ctlMin ? '▸' : '▾';
    });
    $('arBtnRadar').addEventListener('click', function () { setRadar(!st.radarOpen); });
    $('arRdClose').addEventListener('click', function () { setRadar(false); });
    $('arRdMin').addEventListener('click', function () {
      st.radarMin = !st.radarMin;
      $('arRadarWin').classList.toggle('min', st.radarMin);
      this.textContent = st.radarMin ? '▸' : '▾';
    });
    $('arInfMin').addEventListener('click', function () {
      var w = $('arInfoWin'), m = !w.classList.contains('min');
      w.classList.toggle('min', m);
      this.textContent = m ? '▸' : '▾';
    });
    $('arRdFull').addEventListener('click', function () { setRadarFull(!st.radarFull); });
    $('arRdHead').addEventListener('click', function () {
      st.radarUp = !st.radarUp; save(LS.radarHead, st.radarUp ? 1 : 0);
      this.textContent = st.radarUp ? '▲ frente' : 'N ▲';
    });
    $('arRdRange').addEventListener('change', function () { st.radarRange = this.value; save(LS.radarRange, st.radarRange); });
    $('arRdHead').textContent = st.radarUp ? '▲ frente' : 'N ▲';
    setRadar(st.radarOpen);

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

  // Barra de status do celular: no app (Capacitor) o plugin nativo GeoImmersive a esconde; no navegador usa a API de tela cheia.
  function immersive(on) {
    try {
      var C = window.Capacitor;
      if (C && C.isNativePlatform && C.isNativePlatform() && C.registerPlugin) {
        st.imm = st.imm || C.registerPlugin('GeoImmersive');
        var p = st.imm.set({ enabled: !!on });
        if (p && p.catch) p.catch(function () {});
      } else if (on && document.documentElement.requestFullscreen) {
        var q = document.documentElement.requestFullscreen();
        if (q && q.catch) q.catch(function () {});
      } else if (!on && document.fullscreenElement && document.exitFullscreen) {
        var q2 = document.exitFullscreen();
        if (q2 && q2.catch) q2.catch(function () {});
      }
    } catch (e) {}
  }

  function setFull(full) {
    document.body.classList.toggle('ar-full', full);
    var b = $('arBtnCheia');
    if (b) b.textContent = full ? '✕ Sair da tela cheia' : '⛶ Tela cheia';
    immersive(full);
    onResize();
    setTimeout(onResize, 300); // a barra some depois do clique: mede o tamanho de novo
  }
  function toggleFull() { setFull(!document.body.classList.contains('ar-full')); }

  // ---------- radar ----------
  function setRadar(open) {
    st.radarOpen = !!open;
    save(LS.radar, st.radarOpen ? 1 : 0);
    var d = $('arDock'); if (d) d.classList.toggle('hide', !st.radarOpen);
    var b = $('arBtnRadar'); if (b) b.style.background = st.radarOpen ? 'rgba(57,255,20,.2)' : '';
    if (!st.radarOpen) setRadarFull(false);
    else updateInfo();
  }
  function setRadarFull(full) {
    st.radarFull = !!full && st.radarOpen;
    var tab = $(TAB_ID); if (tab) tab.classList.toggle('ar-rfull', st.radarFull);
    var b = $('arRdFull'); if (b) { b.textContent = st.radarFull ? '⤡' : '⤢'; b.title = st.radarFull ? 'Voltar à câmera' : 'Radar em tela cheia'; }
    if (st.radarFull && st.radarMin) { st.radarMin = false; $('arRadarWin').classList.remove('min'); $('arRdMin').textContent = '▾'; }
    layoutDock();
  }
  // No radar em tela cheia o painel de controles continua por cima: empurra o radar para baixo dele (retrato) ou para o lado (paisagem).
  function layoutDock() {
    var d = $('arDock'), c = $('arCtl');
    if (!d || !c) return;
    var land = st.W > st.H;
    d.style.paddingTop = (st.radarFull && !land) ? (c.offsetTop + c.offsetHeight + 6) + 'px' : '';
    d.style.paddingLeft = (st.radarFull && land) ? (c.offsetLeft + c.offsetWidth + 6) + 'px' : '';
  }

  function fmtTime(sec) {
    if (sec < 90) return Math.max(1, Math.round(sec)) + ' s';
    var m = sec / 60;
    if (m < 90) return Math.round(m) + ' min';
    var h = Math.floor(m / 60), mm = Math.round(m - h * 60);
    return h + ' h' + (mm ? ' ' + (mm < 10 ? '0' : '') + mm : '');
  }

  // Lista de alvos: distância e tempo em linha reta, a pé e de veículo (estimativa: não considera ruas nem relevo).
  function updateInfo() {
    var body = $('arInfoBody'); if (!body || !st.radarOpen) return;
    var rd = st.rd;
    if (!rd) { body.innerHTML = '<span style="color:#9fb0c0">Aguardando o GPS…</span>'; return; }
    if (!rd.items.length) { body.innerHTML = '<span style="color:#9fb0c0">Nenhum marcador no filtro e alcance atuais.</span>'; return; }
    var wv = st.walk / 3.6, cv = st.car / 3.6;
    body.innerHTML = rd.items.slice(0, 30).map(function (it, i) {
      var b = bearingOf(it.e[0], it.e[1]);
      return '<div class="ar-it"><b>' + (i + 1) + '</b><span>' + esc(markerName(it.m)) + '<br><span style="color:#9fb0c0">' + fmtDist(it.d) + ' · ' + Math.round(b) + '° ' + cardinal(b) + '</span></span>' +
        '<span class="t">🚶 ' + fmtTime(it.d / wv) + '<br>🚗 ' + fmtTime(it.d / cv) + '</span></div>';
    }).join('') + (rd.items.length > 30 ? '<div style="color:#9fb0c0;padding-top:3px">+ ' + (rd.items.length - 30) + ' mais distantes</div>' : '');
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

  // Dados filtrados que alimentam a câmera e o radar: marcadores e áreas dentro do alcance.
  function collect(pos) {
    var items = [], areas = [], inside = null;
    markerList().forEach(function (m) {
      if (!wantMarker(m)) return;
      var e = enuFrom(pos.lat, pos.lng, m.lat, m.lng);
      var d = Math.hypot(e[0], e[1]);
      if (d > st.range) return;
      items.push({ m: m, e: e, d: d });
    });
    items.sort(function (a, b) { return a.d - b.d; });
    drawingList().forEach(function (x, idx) {
      if (!wantArea(x.d)) return;
      var pts = x.ring.pts.map(function (p) { return enuFrom(pos.lat, pos.lng, p[0], p[1]); });
      var minD = Infinity;
      pts.forEach(function (p) { minD = Math.min(minD, Math.hypot(p[0], p[1])); });
      if (x.ring.closed && pointInPolygon(0, 0, pts)) { inside = inside || drawingName(x.d, idx); minD = 0; }
      if (minD > st.range) return;
      areas.push({ pts: pts, closed: x.ring.closed, rgb: hexToRgb(x.d.color) });
    });
    return { items: items, areas: areas, inside: inside };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawLabel(ctx, labelRects, cx, y, txt) {
    ctx.font = '700 12px sans-serif';
    var tw = ctx.measureText(txt).width + 12, th = 18;
    var rx = cx - tw / 2, ry = y;
    var clash = labelRects.some(function (r) { return rx < r.x + r.w && rx + tw > r.x && ry < r.y + r.h && ry + th > r.y; });
    if (clash) return;
    labelRects.push({ x: rx, y: ry, w: tw, h: th });
    ctx.fillStyle = 'rgba(8,11,16,.78)'; ctx.fillRect(rx, ry, tw, th);
    ctx.strokeStyle = 'rgba(242,209,104,.7)'; ctx.lineWidth = 1; ctx.strokeRect(rx, ry, tw, th);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, cx, ry + th / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function drawIcon(ctx, type, x, y, size) {
    var img = iconFor(type);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    else { ctx.fillStyle = '#f2d168'; ctx.beginPath(); ctx.arc(x, y, size / 3, 0, 6.2832); ctx.fill(); }
  }

  function frame() {
    st.raf = requestAnimationFrame(frame);
    st.frameN++;
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
    if (st.radarFull && pos) warn = '';
    if (msg) { msg.style.display = warn ? 'block' : 'none'; msg.textContent = warn; }
    if (!pos) { if (info1) info1.textContent = ''; if (info2) info2.textContent = ''; st.hits = []; st.rd = null; if (st.radarOpen && st.frameN % 3 === 0) drawRadar(); return; }

    // Câmera
    var v = $('arVideo');
    var vw = (v && v.videoWidth) || 1280, vh = (v && v.videoHeight) || 720;
    if ((vw > vh) !== (W > H)) { var t0 = vw; vw = vh; vh = t0; }
    var scale = Math.max(W / vw, H / vh);
    var Lpx = Math.max(vw, vh) * scale;
    var cam = { cx: W / 2, cy: H / 2, f: (Lpx / 2) / Math.tan(st.fov * D2R / 2) };
    var axes = screenAxes(st.screenAngle);
    var look = R ? cameraLook(R) : { heading: 0, pitch: 0 };
    var headTrue = (look.heading + st.off + 360) % 360;
    var NEAR = 0.8;

    var data = collect(pos);
    var items = data.items, inside = data.inside;
    st.rd = { items: items, areas: data.areas, head: headTrue, hfov: 2 * Math.atan((W / 2) / cam.f) * R2D, pos: pos };
    if (st.radarOpen && st.frameN % 3 === 0) drawRadar();
    if (st.radarOpen && st.frameN % 45 === 0) { updateInfo(); if (st.radarFull) layoutDock(); }
    if (!R || st.radarFull) {
      st.hits = []; st.pose = R ? { heading: headTrue, rawHeading: look.heading, pitch: look.pitch } : null;
      if (info1) info1.textContent = '';
      if (info2) info2.textContent = '';
      return;
    }

    function toCam(e, n, up) {
      var rn = applyOffset(e, n, st.off);
      return toCamera(R, axes, [rn[0], rn[1], up - st.eye]);
    }

    var hits = [];

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
    data.areas.forEach(function (ar) {
      var pts = ar.pts, n = pts.length, last = ar.closed ? n : n - 1;
      for (var i = 0; i < last; i++) {
        var p1 = pts[i], p2 = pts[(i + 1) % n];
        var c1 = toCam(p1[0], p1[1], 0), c2 = toCam(p2[0], p2[1], 0);
        var c3 = toCam(p2[0], p2[1], st.wall), c4 = toCam(p1[0], p1[1], st.wall);
        var poly = clipNear([c1, c2, c3, c4], NEAR);
        if (poly.length < 3) continue;
        walls.push({ poly: poly, depth: (c1.z + c2.z) / 2, color: ar.rgb });
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

    // Marcadores. Com o "marcador elevado" ligado, cada alvo ganha um gêmeo no céu (ângulo fixo acima do horizonte, na
    // mesma direção do alvo) ligado por uma linha tracejada ao ponto real no chão, que fica mais transparente com a distância.
    var labelRects = [];
    var offscreen = [];
    var twins = 0;
    // o gêmeo nunca sobe acima da faixa de bússola nem fica escondido atrás da janela de controles
    var ctlEl = $('arCtl');
    var yTop = Math.max(62, Math.min(ctlEl ? ctlEl.offsetTop + ctlEl.offsetHeight + 2 : 62, H * 0.42));
    var E = st.elevAng * D2R;
    items.forEach(function (it) {
      var ground = toCam(it.e[0], it.e[1], 0);
      var pg = ground.z > NEAR ? camToPixel(ground, cam) : null;
      var useTwin = st.elev && it.d <= st.elevMax && it.d > 0.5 && twins < 12;
      var onScreen = false, farC = ground;

      if (useTwin) {
        twins++;
        var ux = it.e[0] / it.d, uy = it.e[1] / it.d, R0 = 1000;
        var rn = applyOffset(ux * Math.cos(E) * R0, uy * Math.cos(E) * R0, st.off);
        var tw = toCamera(R, axes, [rn[0], rn[1], Math.sin(E) * R0]);
        var size = Math.max(32, Math.min(56, 26 + 3000 / (it.d + 60)));
        if (tw.z > 0) farC = tw;
        var pt = tw.z > NEAR ? camToPixel(tw, cam) : null;
        var clamped = false;
        if (pt && pt.y < yTop + size / 2) { pt.y = yTop + size / 2; clamped = true; }
        var twinVisible = !!pt && pt.x > -size && pt.x < W + size && pt.y < H + size;
        var gsize = Math.max(22, Math.min(40, 16 + 2000 / (it.d + 60)));
        var groundVisible = !!pg && pg.x > -gsize && pg.x < W + gsize && pg.y > -gsize && pg.y < H + gsize;
        var ga = Math.max(0.35, Math.min(1, 1 - (it.d - 30) / 470 * 0.65));

        // linha tracejada entre o gêmeo e o ponto real
        if (pt && pg) {
          ctx.save();
          ctx.strokeStyle = 'rgba(57,255,20,.85)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.moveTo(pt.x, pt.y + size / 2); ctx.lineTo(pg.x, pg.y - gsize / 2); ctx.stroke();
          ctx.restore();
        }
        // ponto real no chão: translúcido e borda verde fluorescente tracejada; 100% opaco quando perto
        if (groundVisible) {
          ctx.save();
          ctx.globalAlpha = ga;
          ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(ctx, pg.x - gsize / 2 - 2, pg.y - gsize / 2 - 2, gsize + 4, gsize + 4, 6); ctx.fill();
          drawIcon(ctx, it.m.type, pg.x, pg.y, gsize);
          ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
          roundRect(ctx, pg.x - gsize / 2 - 2, pg.y - gsize / 2 - 2, gsize + 4, gsize + 4, 6); ctx.stroke();
          ctx.restore();
          hits.push({ kind: 'm', id: it.m.id, x: pg.x - gsize / 2, y: pg.y - gsize / 2, w: gsize, h: gsize });
        }
        // gêmeo elevado (fundo: céu)
        if (twinVisible) {
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8;
          drawIcon(ctx, it.m.type, pt.x, pt.y, size);
          ctx.restore();
          if (clamped) { ctx.fillStyle = 'rgba(57,255,20,.9)'; ctx.beginPath(); ctx.moveTo(pt.x, pt.y - size / 2 - 7); ctx.lineTo(pt.x - 6, pt.y - size / 2 - 1); ctx.lineTo(pt.x + 6, pt.y - size / 2 - 1); ctx.closePath(); ctx.fill(); }
          drawLabel(ctx, labelRects, pt.x, pt.y + size / 2 + 3, markerName(it.m) + ' · ' + fmtDist(it.d));
          hits.push({ kind: 'm', id: it.m.id, x: pt.x - size / 2, y: pt.y - size / 2, w: size, h: size + 24 });
        }
        onScreen = twinVisible || groundVisible;
      } else {
        // estilo simples: ícone 4 m acima do ponto, com linha até o chão
        var head = toCam(it.e[0], it.e[1], 4);
        if (head.z > 0) farC = head;
        if (head.z > NEAR) {
          var ph = camToPixel(head, cam), pg2 = camToPixel(ground, cam);
          var sz = Math.max(28, Math.min(56, 22 + 3000 / (it.d + 60)));
          if (ph.x > -sz && ph.x < W + sz && ph.y > -sz && ph.y < H + sz) {
            onScreen = true;
            ctx.strokeStyle = 'rgba(242,209,104,.65)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(ph.x, ph.y + sz / 2); ctx.lineTo(pg2.x, pg2.y); ctx.stroke();
            ctx.fillStyle = 'rgba(242,209,104,.9)'; ctx.beginPath(); ctx.arc(pg2.x, pg2.y, 3, 0, 6.2832); ctx.fill();
            drawIcon(ctx, it.m.type, ph.x, ph.y, sz);
            drawLabel(ctx, labelRects, ph.x, ph.y + sz / 2 + 3, markerName(it.m) + ' · ' + fmtDist(it.d));
            hits.push({ kind: 'm', id: it.m.id, x: ph.x - sz / 2, y: ph.y - sz / 2, w: sz, h: sz + 24 });
          }
        }
      }
      if (!onScreen) offscreen.push({ it: it, c: farC });
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
      var bar = $('arCtl');
      var by = Math.min((bar ? bar.offsetTop + bar.offsetHeight : 90) + 4, H - 150), bw = Math.min(W - 16, 340);
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

  // ---------- radar 2D ----------
  var RADAR_NICE = [100, 200, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000];
  function radarRangeM(items) {
    if (st.radarRange !== 'auto') return +st.radarRange;
    var mx = 0;
    items.forEach(function (it) { if (it.d > mx) mx = it.d; });
    if (!mx) return 500;
    for (var i = 0; i < RADAR_NICE.length; i++) if (RADAR_NICE[i] >= mx * 1.08) return RADAR_NICE[i];
    return RADAR_NICE[RADAR_NICE.length - 1];
  }

  function drawRadar() {
    var cv = $('arRadarCv'); if (!cv || !st.radarOpen || st.radarMin) return;
    if (st.radarFull) {
      var win = $('arRadarWin');
      var avail = Math.min(win.clientWidth - 12, win.clientHeight - 66);
      if (avail > 80) cv.style.width = avail + 'px';
    } else cv.style.width = '';
    var s = cv.clientWidth; if (s < 40) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(s * dpr)) { cv.width = Math.round(s * dpr); cv.height = Math.round(s * dpr); }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, s, s);
    var cx = s / 2, cy = s / 2, rad = s / 2 - 13;
    var rd = st.rd;

    var bg = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
    bg.addColorStop(0, '#07351a'); bg.addColorStop(1, '#021208');
    c.fillStyle = bg; c.beginPath(); c.arc(cx, cy, rad, 0, 6.2832); c.fill();

    var range = rd ? radarRangeM(rd.items) : 500;
    var ref = rd && st.radarUp ? rd.head : 0; // rumo que aponta para cima na tela
    var k = rad / range;
    function proj(e, n) {
      var th = Math.atan2(e, n) - ref * D2R, dd = Math.hypot(e, n);
      return { x: cx + Math.sin(th) * dd * k, y: cy - Math.cos(th) * dd * k, d: dd };
    }

    // anéis de distância e eixos
    c.lineWidth = 1; c.strokeStyle = 'rgba(57,255,20,.5)';
    for (var i = 1; i <= 4; i++) { c.beginPath(); c.arc(cx, cy, rad * i / 4, 0, 6.2832); c.stroke(); }
    c.strokeStyle = 'rgba(57,255,20,.28)';
    [0, 90].forEach(function (bd) {
      var th = (bd - ref) * D2R, dx = Math.sin(th) * rad, dy = -Math.cos(th) * rad;
      c.beginPath(); c.moveTo(cx - dx, cy - dy); c.lineTo(cx + dx, cy + dy); c.stroke();
    });
    c.save(); c.beginPath(); c.arc(cx, cy, rad, 0, 6.2832); c.clip();

    // áreas (paredes) vistas de cima
    if (rd) rd.areas.forEach(function (ar) {
      var rgb = ar.rgb.join(',');
      c.beginPath();
      ar.pts.forEach(function (p, i) { var q = proj(p[0], p[1]); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); });
      if (ar.closed) { c.closePath(); c.fillStyle = 'rgba(' + rgb + ',.22)'; c.fill(); }
      c.strokeStyle = 'rgba(' + rgb + ',.95)'; c.lineWidth = 1.6; c.stroke();
    });

    // cone da frente do operador (campo de visão da câmera) e linha de varredura
    if (rd) {
      var hd = (rd.head - ref - 90) * D2R, half = (rd.hfov / 2) * D2R;
      c.fillStyle = 'rgba(57,255,20,.22)'; c.strokeStyle = 'rgba(57,255,20,.9)'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, rad, hd - half, hd + half); c.closePath(); c.fill(); c.stroke();
    }
    var sw = (performance.now() / 2600 % 1) * 6.2832;
    c.strokeStyle = 'rgba(57,255,20,.35)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(sw) * rad, cy + Math.sin(sw) * rad); c.stroke();
    c.restore();

    // alvos
    if (rd) rd.items.slice(0, 40).forEach(function (it, i) {
      var q = proj(it.e[0], it.e[1]);
      var out = q.d > range;
      var x = q.x, y = q.y;
      if (out) { var th = Math.atan2(it.e[0], it.e[1]) - ref * D2R; x = cx + Math.sin(th) * rad; y = cy - Math.cos(th) * rad; }
      c.save(); c.globalAlpha = out ? 0.5 : 1;
      c.fillStyle = '#ff5a4a'; c.strokeStyle = '#fff'; c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, 3.6, 0, 6.2832); c.fill(); c.stroke();
      c.font = '700 9px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.85)'; c.fillStyle = '#fff';
      c.strokeText(String(i + 1), x + 5, y - 4); c.fillText(String(i + 1), x + 5, y - 4);
      c.restore();
    });

    // operador no centro
    c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 3, 0, 6.2832); c.fill();

    // rótulos de distância em cada círculo e pontos cardeais
    c.font = '700 9px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    for (var j = 1; j <= 4; j++) {
      var lx = cx + Math.cos(-0.7854) * rad * j / 4 + 2, ly = cy + Math.sin(-0.7854) * rad * j / 4;
      var lt = fmtDist(range * j / 4);
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(lt, lx, ly);
      c.fillStyle = '#7dff5a'; c.fillText(lt, lx, ly);
    }
    c.textAlign = 'center';
    [['N', 0, '#ff6b5a'], ['L', 90, '#9fe8a8'], ['S', 180, '#9fe8a8'], ['O', 270, '#9fe8a8']].forEach(function (cd) {
      var th = (cd[1] - ref) * D2R;
      c.fillStyle = cd[2]; c.font = '800 10px sans-serif';
      c.fillText(cd[0], cx + Math.sin(th) * (rad + 8), cy - Math.cos(th) * (rad + 8));
    });
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    if (!rd) { c.fillStyle = '#9fe8a8'; c.font = '700 11px sans-serif'; c.textAlign = 'center'; c.fillText('Aguardando o GPS…', cx, cy + rad * 0.55); c.textAlign = 'left'; }
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
    var rows = ['<b style="color:#f2d168">' + esc(markerName(m)) + '</b> · ' + fmtDist(d) + ' · rumo ' + Math.round(b) + '° ' + cardinal(b),
      '🚶 ' + fmtTime(d / (st.walk / 3.6)) + ' · 🚗 ' + fmtTime(d / (st.car / 3.6)) + ' <span style="color:#9fb0c0">(em linha reta)</span>'];
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
    if (document.body.classList.contains('ar-full')) setFull(false);
    setRadarFull(false);
  }

  root.GeoAR = {
    start: start, stop: stop, math: ARMath, state: st,
    // gancho de teste (não usado pelo app): pose e posição simuladas
    _setPose: function (alpha, beta, gamma) { st.fakePose = true; st.hasAbs = true; st.lastAbsAt = st.lastOriAt = performance.now(); st.R = rotMatrix(alpha, beta, gamma); },
    _setPos: function (lat, lng, acc) { st.fakePos = lat == null ? null : { lat: lat, lng: lng, acc: acc || 5 }; },
    _setAngle: function (a) { st.fakeAngle = a; st.screenAngle = a; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
