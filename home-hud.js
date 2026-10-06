/* HUD orbital da aba Início (SOMENTE na versão web; o app nativo segue com a lista de cartões de sempre).
   Os módulos que o operador tem liberados giram em órbita ao redor do logo; tocar num nome abre a aba.
   Canvas 2D puro, sem bibliotecas. Só desenha enquanto a aba Início está na tela (fora dela, zero custo),
   pausa com a aba do navegador escondida e respeita "reduzir movimento".
   Integração: renderHome() chama GeoHomeHud.update(cartões, { open, info, native }). */
(function () {
  var TAU = Math.PI * 2;
  var FONTE_HUD = '"Chakra Petch", "Segoe UI", system-ui, sans-serif', FONTE_DADOS = '"Share Tech Mono", ui-monospace, Consolas, monospace';
  var GOLD = '#f2c96a', ICE = '#b5e4fb';
  var cv = null, ctx = null, wrap = null, logo = null;
  var reduzir = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cartoes = [], N = 0, abrir = null, infoFn = null;
  var W = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  var giro = -Math.PI / 2, vBase = reduzir ? 0 : 0.0016, v = vBase, arrasto = false, ultimoX = 0, moveu = 0;
  var hover = -1, visivel = false, rodando = false, tempo = reduzir ? 3 : 0, ultimoT = 0, links = [], ativoHud = false;
  var info = [], infoT = -99;
  var SP = null;

  function sprite(cor) {
    var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d');
    var g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, cor.replace('A', '1')); g.addColorStop(0.25, cor.replace('A', '0.55')); g.addColorStop(1, cor.replace('A', '0'));
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return c;
  }
  function brilho(sp, x, y, tam, a) { ctx.globalAlpha = Math.max(0, Math.min(1, a)); ctx.drawImage(sp, x - tam / 2, y - tam / 2, tam, tam); }

  function medir() {
    if (!cv) return;
    var w = Math.round(cv.getBoundingClientRect().width);
    if (w < 50) { W = 0; return; }       // aba escondida
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(220, w);
    cv.width = W * dpr; cv.height = W * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = W / 2; R = W * (W < 360 ? 0.29 : 0.31);
  }
  function no(k) { var a = giro + k * TAU / N; return { a: a, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }; }

  function montarLinks() {
    links = [];
    for (var k = 0; k < N; k++) {
      var l = { k: k, p: [] };
      for (var i = 0; i < 4; i++) l.p.push({ t: Math.random(), v: 0.08 + Math.random() * 0.13, s: 0.5 + Math.random() * 0.9, fase: Math.random() * 9, f: 2 + Math.random() * 5 });
      links.push(l);
    }
  }
  var RAIOS = []; for (var r = 0; r < 64; r++) RAIOS.push({ a: r * TAU / 64 + Math.random() * 0.03, len: 0.04 + Math.random() * 0.18, f: Math.random() * 9, g: 0.6 + Math.random() * 1.4 });

  function camadaRadar() {
    var i;
    if (ctx.createConicGradient) {
      var ang = tempo * 0.9, g = ctx.createConicGradient(ang, cx, cy);
      g.addColorStop(0, 'rgba(190,232,255,0.22)'); g.addColorStop(0.10, 'rgba(190,232,255,0.0)'); g.addColorStop(1, 'rgba(190,232,255,0.0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.28, 0, TAU); ctx.fill();
    }
    var rot = -giro * 0.3; ctx.lineWidth = 1;
    for (i = 0; i < RAIOS.length; i++) {
      var q = RAIOS[i], al = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(q.f + tempo * q.g)), a = q.a + rot, r0 = R * 1.40, r1 = r0 + R * q.len;
      ctx.strokeStyle = (i % 4 === 0 ? 'rgba(242,201,106,' : 'rgba(181,228,251,') + al + ')';
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(181,228,251,0.10)';
    for (i = 0; i < 8; i++) { var b = i * TAU / 8 + rot * 0.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(b) * R * 0.5, cy + Math.sin(b) * R * 0.5); ctx.lineTo(cx + Math.cos(b) * R * 1.30, cy + Math.sin(b) * R * 1.30); ctx.stroke(); }
  }

  // painéis de dados REAIS (operador, unidade, GPS, rede): nada inventado
  var POS = [[0.02, 0.02], [0.79, 0.02], [0.02, 0.895], [0.79, 0.895]];
  function camadaPaineis() {
    if (tempo - infoT > 1) { infoT = tempo; try { info = infoFn ? infoFn() : []; } catch (e) { info = []; } }
    var pw = W * 0.19, ph = W * 0.085, fs = Math.max(6, Math.round(W * 0.0225)), texto = W >= 330;
    ctx.textBaseline = 'middle';
    info.slice(0, 4).forEach(function (p, idx) {
      var al = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(idx * 1.6 + tempo * 0.55)), x = POS[idx][0] * W, y = POS[idx][1] * W;
      var ex = x + (x < cx ? pw : 0), ey = y + (y < cy ? ph : 0), ang = Math.atan2(ey - cy, ex - cx), rx = cx + Math.cos(ang) * R * 1.31, ry = cy + Math.sin(ang) * R * 1.31;
      ctx.strokeStyle = 'rgba(181,228,251,' + al * 0.7 + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.fillStyle = 'rgba(242,201,106,' + al + ')'; ctx.beginPath(); ctx.arc(rx, ry, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(10,14,18,' + al * 0.9 + ')'; ctx.fillRect(x, y, pw, ph);
      ctx.strokeStyle = 'rgba(181,228,251,' + al + ')'; ctx.strokeRect(x + 0.5, y + 0.5, pw, ph);
      ctx.fillStyle = 'rgba(242,201,106,' + Math.min(1, al + 0.3) + ')'; ctx.fillRect(x, y, 3, ph);
      if (texto) {
        ctx.font = '700 ' + fs + 'px ' + FONTE_HUD; ctx.fillStyle = 'rgba(242,201,106,' + Math.min(1, al + 0.35) + ')'; ctx.fillText(p.tit, x + 8, y + ph * 0.22);
        ctx.font = '400 ' + fs + 'px ' + FONTE_DADOS; ctx.fillStyle = 'rgba(190,232,255,' + Math.min(1, al + 0.35) + ')';
        for (var i = 0; i < p.ln.length && i < 2; i++) {
          var s = String(p.ln[i] || '-').toUpperCase(); while (s.length > 3 && ctx.measureText(s).width > pw - 12) s = s.slice(0, -2) + '…';
          ctx.fillText(s, x + 8, y + ph * (0.5 + i * 0.24));
        }
      } else {
        ctx.fillStyle = 'rgba(190,232,255,' + al + ')';
        for (var b = 0; b < 3; b++) ctx.fillRect(x + 7, y + 6 + b * (ph - 12) / 3, pw * (0.35 + 0.4 * Math.abs(Math.sin(idx + b + tempo * 0.4))), 2);
      }
    });
  }

  function arco(r, a0, a1) { ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke(); }
  function suave(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  function desenhar() {
    if (W <= 0 || !N) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, W);
    var i, a;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    g.addColorStop(0, 'rgba(242,201,106,0.18)'); g.addColorStop(1, 'rgba(18,19,13,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
    camadaRadar();

    var contra = -giro * 0.55;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(236,233,211,0.22)'; arco(R * 1.30, 0, TAU);
    ctx.strokeStyle = 'rgba(236,233,211,0.34)';
    for (i = 0; i < 90; i++) { a = contra + i * TAU / 90; var l = i % 5 === 0 ? 9 : 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 1.30, cy + Math.sin(a) * R * 1.30); ctx.lineTo(cx + Math.cos(a) * (R * 1.30 + l), cy + Math.sin(a) * (R * 1.30 + l)); ctx.stroke(); }
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(242,201,106,0.75)';
    for (i = 0; i < 4; i++) arco(R * 1.30 - 6, contra * 1.3 + i * TAU / 4, contra * 1.3 + i * TAU / 4 + 0.42);
    ctx.lineWidth = 1; ctx.setLineDash([2, 7]); ctx.strokeStyle = 'rgba(181,228,251,0.4)'; arco(R * 0.87, giro * 1.8, giro * 1.8 + TAU); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(242,201,106,0.38)'; arco(R, 0, TAU);
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(181,228,251,0.55)'; arco(R * 0.87 - 6, -giro * 2.2, -giro * 2.2 + 0.9); arco(R * 0.87 - 6, -giro * 2.2 + 3.4, -giro * 2.2 + 4.3);

    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(242,201,106,0.30)';
    if (N > 1) for (i = 0; i < N; i++) arco(R, giro + i * TAU / N, giro + (i + 1) * TAU / N);

    ctx.globalCompositeOperation = 'lighter';
    links.forEach(function (lk) {
      lk.p.forEach(function (p) {
        var aa = giro + lk.k * TAU / N + p.t * TAU / N, tw = 0.55 + 0.45 * Math.sin(p.fase + tempo * p.f), borda = Math.sin(p.t * Math.PI);
        brilho(SP.ouro, cx + Math.cos(aa) * R, cy + Math.sin(aa) * R, (5 + p.s * 5) * (W / 460 + 0.5), tw * borda * 0.9);
      });
    });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    camadaPaineis();

    // logo: só flutua (não gira) e fica por cima de tudo
    var ls = R * 1.456, fx = reduzir ? 0 : Math.sin(tempo * 0.7) * R * 0.012, fy = reduzir ? 0 : Math.sin(tempo * 1.1) * R * 0.035;
    ctx.globalCompositeOperation = 'lighter'; brilho(SP.ouro, cx + fx, cy + fy, ls * 1.9, 0.55); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (logo && logo.complete && logo.naturalWidth) ctx.drawImage(logo, cx + fx - ls / 2, cy + fy - ls / 2, ls, ls);

    // nomes dos módulos (posição contínua ao longo da órbita)
    ctx.textBaseline = 'middle';
    var fs = Math.max(11, Math.round(W * 0.034));
    for (i = 0; i < N; i++) {
      var n = no(i), sel = i === hover, ca = Math.cos(n.a), sa = Math.sin(n.a), nome = cartoes[i].title;
      ctx.lineWidth = 1.6; ctx.strokeStyle = sel ? '#fff' : 'rgba(181,228,251,0.85)';
      ctx.beginPath(); ctx.arc(n.x, n.y, sel ? 9 : 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = sel ? '#fff' : GOLD; ctx.beginPath(); ctx.arc(n.x, n.y, sel ? 4.6 : 3.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(242,201,106,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.x + ca * 10, n.y + sa * 10); ctx.lineTo(n.x + ca * 17, n.y + sa * 17); ctx.stroke();
      ctx.font = (sel ? '700 ' : '600 ') + fs + 'px ' + FONTE_HUD;
      var tw = ctx.measureText(nome).width;
      var alin = suave((0.55 - ca) / 1.1), meio = 1 - suave(Math.abs(ca) / 0.55);
      var tx = n.x + ca * 19 - tw * alin, ty = n.y + sa * 19 + sa * fs * 0.4 * meio;
      tx = Math.max(3, Math.min(W - tw - 3, tx));
      ctx.fillStyle = 'rgba(18,19,13,0.72)'; ctx.fillRect(tx - 4, ty - fs * 0.7, tw + 8, fs * 1.4);
      ctx.fillStyle = sel ? '#fff' : ICE; ctx.fillText(nome, tx, ty);
    }
  }

  function atualizar(dt) {
    tempo += dt;
    if (!arrasto) { giro += v; v += (vBase - v) * 0.03; }
    links.forEach(function (l) { l.p.forEach(function (p) { p.t += p.v * dt; if (p.t > 1) p.t -= 1; }); });
  }
  function quadro(t) {
    rodando = false;
    if (!ativoHud || !visivel || document.hidden) { ultimoT = 0; return; }
    if (!W) medir();
    var dt = ultimoT ? Math.min(0.05, (t - ultimoT) / 1000) : 0.016; ultimoT = t;
    var anima = !reduzir || arrasto || Math.abs(v) > 0.0004;
    if (anima) atualizar(dt);
    desenhar();
    if (anima) agendar();
  }
  function agendar() { if (!rodando && ativoHud) { rodando = true; requestAnimationFrame(quadro); } }

  function noMaisPerto(ev) {
    var b = cv.getBoundingClientRect(), x = (ev.clientX - b.left) * (W / b.width), y = (ev.clientY - b.top) * (W / b.height), melhor = -1, d = 32;
    for (var i = 0; i < N; i++) { var n = no(i), dd = Math.hypot(n.x + Math.cos(n.a) * 12 - x, n.y + Math.sin(n.a) * 12 - y); if (dd < d) { d = dd; melhor = i; } }
    return melhor;
  }

  function iniciar() {
    cv = document.getElementById('homeHudCanvas'); wrap = document.getElementById('homeHud');
    if (!cv || !cv.getContext) return false;
    ctx = cv.getContext('2d');
    SP = { ouro: sprite('rgba(255,226,140,A)') };
    var img = document.querySelector('.home-hero-logo');
    logo = new Image(); logo.onload = agendar; if (img && img.src) logo.src = img.src;
    cv.addEventListener('pointerdown', function (e) { arrasto = true; moveu = 0; ultimoX = e.clientX; try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    cv.addEventListener('pointermove', function (e) {
      if (arrasto) { var dx = e.clientX - ultimoX; ultimoX = e.clientX; moveu += Math.abs(dx); giro += dx * 0.006; v = dx * 0.0006; }
      else { var h = noMaisPerto(e); if (h !== hover) { hover = h; cv.style.cursor = h >= 0 ? 'pointer' : 'grab'; } }
      agendar();
    });
    cv.addEventListener('pointerup', function (e) { arrasto = false; if (moveu < 6) { var k = noMaisPerto(e); if (k >= 0 && abrir) abrir(cartoes[k].tab); } agendar(); });
    cv.addEventListener('pointerleave', function () { hover = -1; });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { visivel = en[0].isIntersecting; if (visivel) { medir(); agendar(); } }, { threshold: 0.05 }).observe(cv);
    else visivel = true;
    document.addEventListener('visibilitychange', agendar);
    window.addEventListener('resize', function () { medir(); agendar(); });
    if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('600 14px "Chakra Petch"'), document.fonts.load('700 14px "Chakra Petch"'), document.fonts.load('400 10px "Share Tech Mono"')]).then(agendar, agendar);
    cv.style.cursor = 'grab';
    return true;
  }

  // ---- integração com a aba Início ----
  var pronto = false;
  function preferencia() { try { return localStorage.getItem('geosniper_home_view') === 'lista' ? 'lista' : 'hud'; } catch (e) { return 'hud'; } }
  function aplicar() {
    var aba = document.getElementById('tabInicio'), tog = document.getElementById('homeViewToggle');
    if (!aba) return;
    var suportado = pronto && N > 0;
    var ligado = suportado && preferencia() === 'hud';
    aba.classList.toggle('home-hud-on', ligado);
    if (tog) {
      tog.style.display = suportado ? 'flex' : 'none';
      [].forEach.call(tog.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', (b.getAttribute('data-view') === (ligado ? 'hud' : 'lista')) ? 'true' : 'false'); });
    }
    ativoHud = ligado;
    if (ligado) { medir(); agendar(); }
  }

  window.GeoHomeHud = {
    update: function (lista, opc) {
      opc = opc || {};
      // app nativo: nada muda (segue a lista de cartões de sempre)
      if (opc.native) { N = 0; pronto = false; aplicar(); return; }
      if (!cv && !iniciar()) return;
      pronto = true; cartoes = lista || []; N = cartoes.length; abrir = opc.open || null; infoFn = opc.info || null;
      montarLinks(); aplicar();
    },
    setView: function (modo) { try { localStorage.setItem('geosniper_home_view', modo === 'lista' ? 'lista' : 'hud'); } catch (e) {} aplicar(); }
  };
})();
