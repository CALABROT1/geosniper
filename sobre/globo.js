/* HUD orbital v2 — logo ao centro (só flutua), 9 módulos em órbita, poeira de energia ligando os módulos
   e camadas gráficas extras: (2) painéis de dados flutuantes,
   (3) radar + raios radiais. Canvas 2D puro, sem bibliotecas. Nada luminoso passa por cima do logo.
   Pausa fora da tela/aba escondida e respeita "reduzir movimento". */
(function () {
  var cv = document.getElementById('globo');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var wrap = cv.parentNode;
  var css = getComputedStyle(document.documentElement);
  var GOLD = (css.getPropertyValue('--accent') || '#f2c96a').trim();
  var ICE = (css.getPropertyValue('--accent-2') || '#b5e4fb').trim();
  var reduzir = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FONTE_HUD = '"Chakra Petch", "Segoe UI", system-ui, sans-serif', FONTE_DADOS = '"Share Tech Mono", ui-monospace, Consolas, monospace';
  var NOMES = ['Balística', 'Equipamento', 'Medir', 'Raios', 'Simulação', 'Perfis', 'Marker', 'Pontos', 'Estratégia'];
  var N = NOMES.length, TAU = Math.PI * 2;
  var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  var giro = -Math.PI / 2, vBase = reduzir ? 0 : 0.0016, v = vBase, arrasto = false, ultimoX = 0, moveu = 0;
  var ativo = -1, hover = -1, visivel = true, rodando = false, tempo = reduzir ? 3 : 0;
  var logo = new Image(); logo.src = 'img/logo-512.png'; logo.onload = function () { agendar(); };

  // brilho pré-renderizado (barato de desenhar milhares de vezes)
  function sprite(cor) {
    var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d');
    var g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, cor.replace('A', '1')); g.addColorStop(0.25, cor.replace('A', '0.55')); g.addColorStop(1, cor.replace('A', '0'));
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return c;
  }
  var SP_OURO = sprite('rgba(255,226,140,A)'), SP_GELO = sprite('rgba(190,232,255,A)'), SP_BRANCO = sprite('rgba(255,255,255,A)');
  function brilho(sp, x, y, tam, a) { ctx.globalAlpha = Math.max(0, Math.min(1, a)); ctx.drawImage(sp, x - tam / 2, y - tam / 2, tam, tam); }

  function medir() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(220, Math.round(cv.getBoundingClientRect().width)); H = W;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2; R = W * (W < 360 ? 0.29 : 0.31);
  }
  function no(k) { var a = giro + k * TAU / N; return { a: a, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }; }

  // ---- poeira de energia ao longo das ligações ----
  // tipo 0: arco da órbita, no sentido da rotação (k -> k+1); tipo 1: corda curva em sentido contrário (k+2 -> k)
  function ponto(l, t) {
    if (l.tipo === 0) { var a = giro + l.k * TAU / N + t * TAU / N; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; }
    var A = no(l.k + 2), B = no(l.k), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    var qx = mx + (cx - mx) * 0.55, qy = my + (cy - my) * 0.55, u = 1 - t;
    return [u * u * A.x + 2 * u * t * qx + t * t * B.x, u * u * A.y + 2 * u * t * qy + t * t * B.y];
  }
  var links = [];
  for (var k = 0; k < N; k++) links.push({ tipo: 0, k: k });   // só os arcos da órbita (sentido da rotação)
  links.forEach(function (l) {
    l.p = []; var n = l.tipo === 0 ? 4 : 3;
    for (var i = 0; i < n; i++) l.p.push({ t: Math.random(), v: (0.10 + Math.random() * 0.16) * (l.tipo ? 1 : 0.8), s: 0.5 + Math.random() * 0.9, fase: Math.random() * 9, f: 2 + Math.random() * 5 });
  });

  // ---- camada 2: painéis de dados flutuantes ----
  var PAINEIS = [
    { x: 0.02, y: 0.02, tit: 'SISTEMA', ln: ['MÓDULOS 09/09', 'ÓRBITA ATIVA'], ph: 0.0 },
    { x: 0.79, y: 0.02, tit: 'ALCANCE', ln: ['DIST 412 m', 'VENTO 3 h'], ph: 1.6, vivo: [['DIST ', 412, 3, ' m'], ['VENTO ', 3, 0.2, ' h']] },
    { x: 0.02, y: 0.895, tit: 'GEO', ln: ['LAT -23.5874', 'LNG -46.6576'], ph: 3.1 },
    { x: 0.79, y: 0.895, tit: 'PRECISÃO', ln: ['CLIQUES +2.4', 'ERRO < 0.3 MOA'], ph: 4.5 }
  ];
  function camadaPaineis() {
    var pw = W * 0.19, ph = W * 0.085, fs = Math.max(6, Math.round(W * 0.0225)), texto = W >= 330;
    ctx.textBaseline = 'middle';
    PAINEIS.forEach(function (p) {
      var al = 0.38 + 0.32 * (0.5 + 0.5 * Math.sin(p.ph + tempo * 0.55)), x = p.x * W, y = p.y * H;
      // linha-guia até o anel externo
      var ex = x + (x < cx ? pw : 0), ey = y + (y < cy ? ph : 0), ang = Math.atan2(ey - cy, ex - cx), rx = cx + Math.cos(ang) * R * 1.31, ry = cy + Math.sin(ang) * R * 1.31;
      ctx.strokeStyle = 'rgba(181,228,251,' + al * 0.7 + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.fillStyle = 'rgba(242,201,106,' + al + ')'; ctx.beginPath(); ctx.arc(rx, ry, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(10,14,18,' + al * 0.9 + ')'; ctx.fillRect(x, y, pw, ph);
      ctx.strokeStyle = 'rgba(181,228,251,' + al + ')'; ctx.strokeRect(x + 0.5, y + 0.5, pw, ph);
      ctx.fillStyle = 'rgba(242,201,106,' + Math.min(1, al + 0.3) + ')'; ctx.fillRect(x, y, 3, ph);
      if (texto) {
        ctx.font = '700 ' + fs + 'px ' + FONTE_HUD; ctx.fillStyle = 'rgba(242,201,106,' + Math.min(1, al + 0.35) + ')'; ctx.fillText(p.tit, x + 8, y + ph * 0.22);
        ctx.font = '400 ' + fs + 'px ' + FONTE_DADOS; ctx.fillStyle = 'rgba(190,232,255,' + Math.min(1, al + 0.35) + ')';
        for (var i = 0; i < p.ln.length; i++) {
          var s = p.ln[i];
          if (p.vivo && p.vivo[i]) { var q = p.vivo[i], val = q[1] + Math.sin(tempo * 0.8 + i) * q[2] * 2; s = q[0] + (q[2] < 1 ? val.toFixed(1) : Math.round(val)) + q[3]; }
          ctx.fillText(s, x + 8, y + ph * (0.5 + i * 0.24));
        }
      } else {   // celular: só as barrinhas de dados
        ctx.fillStyle = 'rgba(190,232,255,' + al + ')';
        for (var b = 0; b < 3; b++) ctx.fillRect(x + 7, y + 6 + b * (ph - 12) / 3, pw * (0.35 + 0.4 * Math.abs(Math.sin(p.ph + b + tempo * 0.4))), 2);
      }
    });
  }

  // ---- camada 3: radar + raios radiais ----
  var RAIOS = []; for (var r = 0; r < 64; r++) RAIOS.push({ a: r * TAU / 64 + Math.random() * 0.03, len: 0.04 + Math.random() * 0.18, f: Math.random() * 9, g: 0.6 + Math.random() * 1.4 });
  function camadaRadar() {
    var i;
    // varredura do radar (cone que gira)
    if (ctx.createConicGradient) {
      var ang = tempo * 0.9, g = ctx.createConicGradient(ang, cx, cy);
      g.addColorStop(0, 'rgba(190,232,255,0.26)'); g.addColorStop(0.10, 'rgba(190,232,255,0.0)'); g.addColorStop(1, 'rgba(190,232,255,0.0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.28, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(210,240,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R * 1.28, cy + Math.sin(ang) * R * 1.28); ctx.stroke();
    }
    // raios radiais curtos além da moldura (giram devagar ao contrário da órbita)
    var rot = -giro * 0.3; ctx.lineWidth = 1;
    for (i = 0; i < RAIOS.length; i++) {
      var q = RAIOS[i], al = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(q.f + tempo * q.g)), a = q.a + rot, r0 = R * 1.40, r1 = r0 + R * q.len;
      ctx.strokeStyle = (i % 4 === 0 ? 'rgba(242,201,106,' : 'rgba(181,228,251,') + al + ')';
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    // 8 linhas longas e finas do centro até a moldura
    ctx.strokeStyle = 'rgba(181,228,251,0.10)';
    for (i = 0; i < 8; i++) { var b = i * TAU / 8 + rot * 0.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(b) * R * 0.5, cy + Math.sin(b) * R * 0.5); ctx.lineTo(cx + Math.cos(b) * R * 1.30, cy + Math.sin(b) * R * 1.30); ctx.stroke(); }
  }

  function atualizar(dt) {
    tempo += dt;
    if (!arrasto) { giro += v; v += (vBase - v) * 0.03; }
    links.forEach(function (l) { l.p.forEach(function (p) { p.t += p.v * dt; if (p.t > 1) p.t -= 1; }); });
  }

  function arco(r, a0, a1) { ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke(); }

  function desenhar() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    var i, a;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    g.addColorStop(0, 'rgba(242,201,106,0.18)'); g.addColorStop(1, 'rgba(18,19,13,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    camadaRadar();      // camada 3

    // ---- moldura HUD (gira ao contrário da órbita) ----
    var contra = -giro * 0.55;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(236,233,211,0.22)'; arco(R * 1.30, 0, TAU);
    ctx.strokeStyle = 'rgba(236,233,211,0.34)';
    for (i = 0; i < 90; i++) { a = contra + i * TAU / 90; var l = i % 5 === 0 ? 9 : 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 1.30, cy + Math.sin(a) * R * 1.30); ctx.lineTo(cx + Math.cos(a) * (R * 1.30 + l), cy + Math.sin(a) * (R * 1.30 + l)); ctx.stroke(); }
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(242,201,106,0.75)';
    for (i = 0; i < 4; i++) arco(R * 1.30 - 6, contra * 1.3 + i * TAU / 4, contra * 1.3 + i * TAU / 4 + 0.42);
    ctx.lineWidth = 1; ctx.setLineDash([2, 7]); ctx.strokeStyle = 'rgba(181,228,251,0.4)'; arco(R * 0.87, giro * 1.8, giro * 1.8 + TAU); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(242,201,106,0.38)'; arco(R, 0, TAU);
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(181,228,251,0.55)'; arco(R * 0.87 - 6, -giro * 2.2, -giro * 2.2 + 0.9); arco(R * 0.87 - 6, -giro * 2.2 + 3.4, -giro * 2.2 + 4.3);

    // ---- ligações (linhas finas) ----
    ctx.lineWidth = 1;
    for (i = 0; i < N; i++) {
      ctx.strokeStyle = 'rgba(242,201,106,0.30)'; arco(R, giro + i * TAU / N, giro + (i + 1) * TAU / N);
    }

    // ---- poeira de energia (desenhada ANTES do logo: nada passa por cima dele) ----
    ctx.globalCompositeOperation = 'lighter';
    links.forEach(function (l) {
      l.p.forEach(function (p) {
        var q = ponto(l, p.t), tw = 0.55 + 0.45 * Math.sin(p.fase + tempo * p.f), borda = Math.sin(p.t * Math.PI);
        brilho(l.tipo ? SP_GELO : SP_OURO, q[0], q[1], (5 + p.s * 5) * (W / 460 + 0.5), tw * borda * 0.9);
      });
    });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    camadaPaineis();    // camada 2

    // ---- logo: só flutua (sobe/desce e balança), não gira; fica por cima de tudo ----
    var ls = R * 1.456;   // logo: +40% e depois +30% (raio 0,73 R, dentro do círculo dos nomes)
    var fx = reduzir ? 0 : Math.sin(tempo * 0.7) * R * 0.012, fy = reduzir ? 0 : Math.sin(tempo * 1.1) * R * 0.035;
    ctx.globalCompositeOperation = 'lighter'; brilho(SP_OURO, cx + fx, cy + fy, ls * 1.9, 0.55); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, cx + fx - ls / 2, cy + fy - ls / 2, ls, ls);

    // ---- módulos ----
    ctx.textBaseline = 'middle';
    var fs = Math.max(11, Math.round(W * 0.034));
    for (i = 0; i < N; i++) {
      var n = no(i), sel = i === ativo || i === hover, ca = Math.cos(n.a), sa = Math.sin(n.a);
      ctx.lineWidth = 1.6; ctx.strokeStyle = sel ? '#fff' : 'rgba(181,228,251,0.85)';
      ctx.beginPath(); ctx.arc(n.x, n.y, sel ? 9 : 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = sel ? '#fff' : GOLD; ctx.beginPath(); ctx.arc(n.x, n.y, sel ? 4.6 : 3.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(242,201,106,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.x + ca * 10, n.y + sa * 10); ctx.lineTo(n.x + ca * 17, n.y + sa * 17); ctx.stroke();
      ctx.font = (sel ? '700 ' : '600 ') + fs + 'px ' + FONTE_HUD;
      // posição do rótulo CONTÍNUA ao longo da órbita (sem trocar de regra de repente nas posições 12h e 6h):
      // o alinhamento desliza de "texto à direita do ponto" (lado direito) até "texto à esquerda" (lado esquerdo),
      // passando pelo centralizado em cima/embaixo.
      var tw = ctx.measureText(NOMES[i]).width;
      var suave = function (x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      var alin = suave((0.55 - ca) / 1.1);                  // 0 = começa no ponto (direita) ... 1 = termina no ponto (esquerda)
      var meio = 1 - suave(Math.abs(ca) / 0.55);            // 1 = em cima/embaixo
      var tx = n.x + ca * 19 - tw * alin, ty = n.y + sa * 19 + sa * fs * 0.4 * meio;
      tx = Math.max(3, Math.min(W - tw - 3, tx));
      ctx.fillStyle = 'rgba(18,19,13,0.72)'; ctx.fillRect(tx - 4, ty - fs * 0.7, tw + 8, fs * 1.4);
      ctx.fillStyle = sel ? '#fff' : ICE; ctx.fillText(NOMES[i], tx, ty);
    }
  }

  var ultimoT = 0;
  function quadro(t) {
    rodando = false;
    if (!visivel || document.hidden) { ultimoT = 0; return; }
    var dt = ultimoT ? Math.min(0.05, (t - ultimoT) / 1000) : 0.016; ultimoT = t;
    var anima = !reduzir || arrasto || Math.abs(v) > 0.0004;
    if (anima) atualizar(dt);
    desenhar();
    if (anima) agendar();
  }
  function agendar() { if (!rodando) { rodando = true; requestAnimationFrame(quadro); } }

  function noMaisPerto(ev) {
    var b = cv.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top, melhor = -1, d = 30;
    for (var i = 0; i < N; i++) { var n = no(i), dd = Math.hypot(n.x + Math.cos(n.a) * 12 - x, n.y + Math.sin(n.a) * 12 - y); if (dd < d) { d = dd; melhor = i; } }
    return melhor;
  }
  cv.addEventListener('pointerdown', function (e) { arrasto = true; moveu = 0; ultimoX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', function (e) {
    if (arrasto) { var dx = e.clientX - ultimoX; ultimoX = e.clientX; moveu += Math.abs(dx); giro += dx * 0.006; v = dx * 0.0006; }
    else { var h = noMaisPerto(e); if (h !== hover) { hover = h; cv.style.cursor = h >= 0 ? 'pointer' : 'grab'; } }
    agendar();
  });
  cv.addEventListener('pointerup', function (e) { arrasto = false; if (moveu < 6) { var k = noMaisPerto(e); if (k >= 0) abrir(k); } agendar(); });
  cv.addEventListener('pointerleave', function () { hover = -1; });

  function abrir(k) {
    ativo = k; marcarChips(k);
    var alvo = null;
    document.querySelectorAll('#modulos .card h3').forEach(function (h) { if (h.textContent.trim() === NOMES[k]) alvo = h.closest('.card'); });
    if (!alvo) return;
    alvo.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'center' });
    alvo.classList.add('card-destaque'); setTimeout(function () { alvo.classList.remove('card-destaque'); }, 2200);
  }
  var chips = document.getElementById('globoChips');
  function marcarChips(k) { if (chips) [].forEach.call(chips.children, function (c, i) { c.setAttribute('aria-pressed', i === k ? 'true' : 'false'); }); }
  if (chips) NOMES.forEach(function (nome, k) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = nome; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { abrir(k); });
    b.addEventListener('mouseenter', function () { hover = k; agendar(); });
    b.addEventListener('mouseleave', function () { hover = -1; agendar(); });
    chips.appendChild(b);
  });

  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { visivel = en[0].isIntersecting; if (visivel) agendar(); }, { threshold: 0.05 }).observe(cv);
  document.addEventListener('visibilitychange', agendar);
  window.addEventListener('resize', function () { medir(); agendar(); });
  if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('600 14px "Chakra Petch"'), document.fonts.load('700 14px "Chakra Petch"'), document.fonts.load('400 10px "Share Tech Mono"')]).then(agendar, agendar);
  wrap.classList.add('ativo'); medir(); cv.style.cursor = 'grab'; agendar();
})();
