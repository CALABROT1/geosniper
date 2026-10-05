/* GeoSniper — motor balístico (ponto de massa, 3D).
 *
 * O MESMO arquivo roda no servidor (Node) e no navegador/app. Gerado por build.py a partir de engine.src.js + drag-tables.json.
 *
 * Física incluída:
 *  - arrasto por função padrão (G1, G2, G5, G6, G7, G8, GI, GS, RA4) ou tabela própria [[mach, cd], ...], com BC referido à atmosfera padrão ICAO;
 *  - atmosfera real: densidade do ar e velocidade do som a partir de temperatura, pressão (de estação) e umidade;
 *  - vento vetorial: velocidade + direção RELATIVA à linha de tiro (relógio: 12h = de frente, 3h = da direita);
 *  - gravidade, inclinação do tiro (ângulo de sítio) e altura da luneta;
 *  - Coriolis (latitude + azimute), com o efeito vertical (Eötvös) incluído;
 *  - deriva giroscópica (Litz), com estabilidade de Miller quando calibre e comprimento são informados;
 *  - zeragem: o ângulo do cano é resolvido para a distância de zeragem informada.
 * Integração: Runge-Kutta de 4ª ordem, passo fixo de 1 ms.
 * Convenções: ENU (x = leste, y = norte, z = cima); dn = altura acima da linha de visada; dr = desvio lateral (+ direita).
 * Correções devolvidas: + = subir / + = para a direita (o que o atirador gira na torre).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GeoBallistics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DRAG_TABLES = {"G1":[[0.0,0.2629],[0.05,0.2558],[0.1,0.2487],[0.15,0.2413],[0.2,0.2344],[0.25,0.2278],[0.3,0.2214],[0.35,0.2155],[0.4,0.2104],[0.45,0.2061],[0.5,0.2032],[0.55,0.202],[0.6,0.2034],[0.7,0.2165],[0.725,0.223],[0.75,0.2313],[0.775,0.2417],[0.8,0.2546],[0.825,0.2706],[0.85,0.2901],[0.875,0.3136],[0.9,0.3415],[0.925,0.3734],[0.95,0.4084],[0.975,0.4448],[1.0,0.4805],[1.025,0.5136],[1.05,0.5427],[1.075,0.5677],[1.1,0.5883],[1.125,0.6053],[1.15,0.6191],[1.2,0.6393],[1.25,0.6518],[1.3,0.6589],[1.35,0.6621],[1.4,0.6625],[1.45,0.6607],[1.5,0.6573],[1.55,0.6528],[1.6,0.6474],[1.65,0.6413],[1.7,0.6347],[1.75,0.628],[1.8,0.621],[1.85,0.6141],[1.9,0.6072],[1.95,0.6003],[2.0,0.5934],[2.05,0.5867],[2.1,0.5804],[2.15,0.5743],[2.2,0.5685],[2.25,0.563],[2.3,0.5577],[2.35,0.5527],[2.4,0.5481],[2.45,0.5438],[2.5,0.5397],[2.6,0.5325],[2.7,0.5264],[2.8,0.5211],[2.9,0.5168],[3.0,0.5133],[3.1,0.5105],[3.2,0.5084],[3.3,0.5067],[3.4,0.5054],[3.5,0.504],[3.6,0.503],[3.7,0.5022],[3.8,0.5016],[3.9,0.501],[4.0,0.5006],[4.2,0.4998],[4.4,0.4995],[4.6,0.4992],[4.8,0.499],[5.0,0.4988]],"G2":[[0.0,0.2303],[0.05,0.2298],[0.1,0.2287],[0.15,0.2271],[0.2,0.2251],[0.25,0.2227],[0.3,0.2196],[0.35,0.2156],[0.4,0.2107],[0.45,0.2048],[0.5,0.198],[0.55,0.1905],[0.6,0.1828],[0.65,0.1758],[0.7,0.1702],[0.75,0.1669],[0.775,0.1664],[0.8,0.1667],[0.825,0.1682],[0.85,0.1711],[0.875,0.1761],[0.9,0.1831],[0.925,0.2004],[0.95,0.2589],[0.975,0.3492],[1.0,0.3983],[1.025,0.4075],[1.05,0.4103],[1.075,0.4114],[1.1,0.4106],[1.125,0.4089],[1.15,0.4068],[1.175,0.4046],[1.2,0.4021],[1.25,0.3966],[1.3,0.3904],[1.35,0.3835],[1.4,0.3759],[1.45,0.3678],[1.5,0.3594],[1.55,0.3512],[1.6,0.3432],[1.65,0.3356],[1.7,0.3282],[1.75,0.3213],[1.8,0.3149],[1.85,0.3089],[1.9,0.3033],[1.95,0.2982],[2.0,0.2933],[2.05,0.2889],[2.1,0.2846],[2.15,0.2806],[2.2,0.2768],[2.25,0.2731],[2.3,0.2696],[2.35,0.2663],[2.4,0.2632],[2.45,0.2602],[2.5,0.2572],[2.55,0.2543],[2.6,0.2515],[2.65,0.2487],[2.7,0.246],[2.75,0.2433],[2.8,0.2408],[2.85,0.2382],[2.9,0.2357],[2.95,0.2333],[3.0,0.2309],[3.1,0.2262],[3.2,0.2217],[3.3,0.2173],[3.4,0.2132],[3.5,0.2091],[3.6,0.2052],[3.7,0.2014],[3.8,0.1978],[3.9,0.1944],[4.0,0.1912],[4.2,0.1851],[4.4,0.1794],[4.6,0.1741],[4.8,0.1693],[5.0,0.1648]],"G5":[[0.0,0.171],[0.05,0.1719],[0.1,0.1727],[0.15,0.1732],[0.2,0.1734],[0.25,0.173],[0.3,0.1718],[0.35,0.1696],[0.4,0.1668],[0.45,0.1637],[0.5,0.1603],[0.55,0.1566],[0.6,0.1529],[0.65,0.1497],[0.7,0.1473],[0.75,0.1463],[0.8,0.1489],[0.85,0.1583],[0.875,0.1672],[0.9,0.1815],[0.925,0.2051],[0.95,0.2413],[0.975,0.2884],[1.0,0.3379],[1.025,0.3785],[1.05,0.4032],[1.075,0.4147],[1.1,0.4201],[1.15,0.4278],[1.2,0.4338],[1.25,0.4373],[1.3,0.4392],[1.35,0.4403],[1.4,0.4406],[1.45,0.4401],[1.5,0.4386],[1.55,0.4362],[1.6,0.4328],[1.65,0.4286],[1.7,0.4237],[1.75,0.4182],[1.8,0.4121],[1.85,0.4057],[1.9,0.3991],[1.95,0.3926],[2.0,0.3861],[2.05,0.38],[2.1,0.3741],[2.15,0.3684],[2.2,0.363],[2.25,0.3578],[2.3,0.3529],[2.35,0.3481],[2.4,0.3435],[2.45,0.3391],[2.5,0.3349],[2.6,0.3269],[2.7,0.3194],[2.8,0.3125],[2.9,0.306],[3.0,0.2999],[3.1,0.2942],[3.2,0.2889],[3.3,0.2838],[3.4,0.279],[3.5,0.2745],[3.6,0.2703],[3.7,0.2662],[3.8,0.2624],[3.9,0.2588],[4.0,0.2553],[4.2,0.2488],[4.4,0.2429],[4.6,0.2376],[4.8,0.2326],[5.0,0.228]],"G6":[[0.0,0.2617],[0.05,0.2553],[0.1,0.2491],[0.15,0.2432],[0.2,0.2376],[0.25,0.2324],[0.3,0.2278],[0.35,0.2238],[0.4,0.2205],[0.45,0.2177],[0.5,0.2155],[0.55,0.2138],[0.6,0.2126],[0.65,0.2121],[0.7,0.2122],[0.75,0.2132],[0.8,0.2154],[0.85,0.2194],[0.875,0.2229],[0.9,0.2297],[0.925,0.2449],[0.95,0.2732],[0.975,0.3141],[1.0,0.3597],[1.025,0.3994],[1.05,0.4261],[1.075,0.4402],[1.1,0.4465],[1.125,0.449],[1.15,0.4497],[1.175,0.4494],[1.2,0.4482],[1.225,0.4464],[1.25,0.4441],[1.3,0.439],[1.35,0.4336],[1.4,0.4279],[1.45,0.4221],[1.5,0.4162],[1.55,0.4102],[1.6,0.4042],[1.65,0.3981],[1.7,0.3919],[1.75,0.3855],[1.8,0.3788],[1.85,0.3721],[1.9,0.3652],[1.95,0.3583],[2.0,0.3515],[2.05,0.3447],[2.1,0.3381],[2.15,0.3314],[2.2,0.3249],[2.25,0.3185],[2.3,0.3122],[2.35,0.306],[2.4,0.3],[2.45,0.2941],[2.5,0.2883],[2.6,0.2772],[2.7,0.2668],[2.8,0.2574],[2.9,0.2487],[3.0,0.2407],[3.1,0.2333],[3.2,0.2265],[3.3,0.2202],[3.4,0.2144],[3.5,0.2089],[3.6,0.2039],[3.7,0.1991],[3.8,0.1947],[3.9,0.1905],[4.0,0.1866],[4.2,0.1794],[4.4,0.173],[4.6,0.1673],[4.8,0.1621],[5.0,0.1574]],"G7":[[0.0,0.1198],[0.05,0.1197],[0.1,0.1196],[0.15,0.1194],[0.2,0.1193],[0.25,0.1194],[0.3,0.1194],[0.35,0.1194],[0.4,0.1193],[0.45,0.1193],[0.5,0.1194],[0.55,0.1193],[0.6,0.1194],[0.65,0.1197],[0.7,0.1202],[0.725,0.1207],[0.75,0.1215],[0.775,0.1226],[0.8,0.1242],[0.825,0.1266],[0.85,0.1306],[0.875,0.1368],[0.9,0.1464],[0.925,0.166],[0.95,0.2054],[0.975,0.2993],[1.0,0.3803],[1.025,0.4015],[1.05,0.4043],[1.075,0.4034],[1.1,0.4014],[1.125,0.3987],[1.15,0.3955],[1.2,0.3884],[1.25,0.381],[1.3,0.3732],[1.35,0.3657],[1.4,0.358],[1.5,0.344],[1.55,0.3376],[1.6,0.3315],[1.65,0.326],[1.7,0.3209],[1.75,0.316],[1.8,0.3117],[1.85,0.3078],[1.9,0.3042],[1.95,0.301],[2.0,0.298],[2.05,0.2951],[2.1,0.2922],[2.15,0.2892],[2.2,0.2864],[2.25,0.2835],[2.3,0.2807],[2.35,0.2779],[2.4,0.2752],[2.45,0.2725],[2.5,0.2697],[2.55,0.267],[2.6,0.2643],[2.65,0.2615],[2.7,0.2588],[2.75,0.2561],[2.8,0.2533],[2.85,0.2506],[2.9,0.2479],[2.95,0.2451],[3.0,0.2424],[3.1,0.2368],[3.2,0.2313],[3.3,0.2258],[3.4,0.2205],[3.5,0.2154],[3.6,0.2106],[3.7,0.206],[3.8,0.2017],[3.9,0.1975],[4.0,0.1935],[4.2,0.1861],[4.4,0.1793],[4.6,0.173],[4.8,0.1672],[5.0,0.1618]],"G8":[[0.0,0.2105],[0.05,0.2105],[0.1,0.2104],[0.15,0.2104],[0.2,0.2103],[0.25,0.2103],[0.3,0.2103],[0.35,0.2103],[0.4,0.2103],[0.45,0.2102],[0.5,0.2102],[0.55,0.2102],[0.6,0.2102],[0.65,0.2102],[0.7,0.2103],[0.75,0.2103],[0.8,0.2104],[0.825,0.2104],[0.85,0.2105],[0.875,0.2106],[0.9,0.2109],[0.925,0.2183],[0.95,0.2571],[0.975,0.3358],[1.0,0.4068],[1.025,0.4378],[1.05,0.4476],[1.075,0.4493],[1.1,0.4477],[1.125,0.445],[1.15,0.4419],[1.2,0.4353],[1.25,0.4283],[1.3,0.4208],[1.35,0.4133],[1.4,0.4059],[1.45,0.3986],[1.5,0.3915],[1.55,0.3845],[1.6,0.3777],[1.65,0.371],[1.7,0.3645],[1.75,0.3581],[1.8,0.3519],[1.85,0.3458],[1.9,0.34],[1.95,0.3343],[2.0,0.3288],[2.05,0.3234],[2.1,0.3182],[2.15,0.3131],[2.2,0.3081],[2.25,0.3032],[2.3,0.2983],[2.35,0.2937],[2.4,0.2891],[2.45,0.2845],[2.5,0.2802],[2.6,0.272],[2.7,0.2642],[2.8,0.2569],[2.9,0.2499],[3.0,0.2432],[3.1,0.2368],[3.2,0.2308],[3.3,0.2251],[3.4,0.2197],[3.5,0.2147],[3.6,0.2101],[3.7,0.2058],[3.8,0.2019],[3.9,0.1983],[4.0,0.195],[4.2,0.189],[4.4,0.1837],[4.6,0.1791],[4.8,0.175],[5.0,0.1713]],"GI":[[0.0,0.2282],[0.05,0.2282],[0.1,0.2282],[0.15,0.2282],[0.2,0.2282],[0.25,0.2282],[0.3,0.2282],[0.35,0.2282],[0.4,0.2282],[0.45,0.2282],[0.5,0.2282],[0.55,0.2282],[0.6,0.2282],[0.65,0.2282],[0.7,0.2282],[0.725,0.2353],[0.75,0.2434],[0.775,0.2515],[0.8,0.2596],[0.825,0.2677],[0.85,0.2759],[0.875,0.2913],[0.9,0.317],[0.925,0.3442],[0.95,0.3728],[1.0,0.4349],[1.05,0.5034],[1.075,0.5402],[1.1,0.5756],[1.125,0.5887],[1.15,0.6018],[1.175,0.6149],[1.2,0.6279],[1.225,0.6418],[1.25,0.6423],[1.3,0.6423],[1.35,0.6423],[1.4,0.6423],[1.45,0.6423],[1.5,0.6423],[1.55,0.6423],[1.6,0.6423],[1.625,0.6407],[1.65,0.6378],[1.7,0.6321],[1.75,0.6266],[1.8,0.6213],[1.85,0.6163],[1.9,0.6113],[1.95,0.6066],[2.0,0.602],[2.05,0.5976],[2.1,0.5933],[2.15,0.5891],[2.2,0.585],[2.25,0.5811],[2.3,0.5773],[2.35,0.5733],[2.4,0.5679],[2.45,0.5626],[2.5,0.5576],[2.6,0.5478],[2.7,0.5386],[2.8,0.5298],[2.9,0.5215],[3.0,0.5136],[3.1,0.5061],[3.2,0.4989],[3.3,0.4921],[3.4,0.4855],[3.5,0.4792],[3.6,0.4732],[3.7,0.4674],[3.8,0.4618],[3.9,0.4564],[4.0,0.4513],[4.2,0.4415],[4.4,0.4323],[4.6,0.4238],[4.8,0.4157],[5.0,0.4082]],"GS":[[0.0,0.4662],[0.05,0.4689],[0.1,0.4717],[0.15,0.4745],[0.2,0.4772],[0.25,0.48],[0.3,0.4827],[0.35,0.4852],[0.4,0.4882],[0.45,0.492],[0.5,0.497],[0.55,0.508],[0.6,0.526],[0.65,0.559],[0.7,0.592],[0.75,0.6258],[0.8,0.661],[0.85,0.6985],[0.9,0.737],[0.95,0.7757],[1.0,0.814],[1.05,0.8512],[1.1,0.887],[1.15,0.921],[1.2,0.951],[1.25,0.974],[1.3,0.991],[1.35,0.999],[1.4,1.003],[1.45,1.006],[1.5,1.008],[1.55,1.009],[1.6,1.009],[1.65,1.009],[1.7,1.009],[1.75,1.008],[1.8,1.007],[1.85,1.006],[1.9,1.004],[1.95,1.0025],[2.0,1.001],[2.05,0.999],[2.1,0.997],[2.15,0.9956],[2.2,0.994],[2.25,0.9916],[2.3,0.989],[2.35,0.9869],[2.4,0.985],[2.45,0.983],[2.5,0.981],[2.55,0.979],[2.6,0.977],[2.65,0.975],[2.7,0.973],[2.75,0.971],[2.8,0.969],[2.85,0.967],[2.9,0.965],[2.95,0.963],[3.0,0.961],[3.05,0.9589],[3.1,0.957],[3.15,0.9555],[3.2,0.954],[3.25,0.952],[3.3,0.95],[3.35,0.9485],[3.4,0.947],[3.45,0.945],[3.5,0.943],[3.55,0.9414],[3.6,0.94],[3.65,0.9385],[3.7,0.937],[3.75,0.9355],[3.8,0.934],[3.85,0.9325],[3.9,0.931],[3.95,0.9295],[4.0,0.928]],"RA4":[[0.0,0.2283],[0.05,0.2283],[0.1,0.2282],[0.15,0.2281],[0.2,0.2281],[0.25,0.2281],[0.3,0.2281],[0.35,0.2281],[0.4,0.2281],[0.45,0.2281],[0.5,0.2281],[0.55,0.2281],[0.6,0.2281],[0.65,0.2281],[0.7,0.2288],[0.725,0.2296],[0.75,0.2307],[0.775,0.232],[0.8,0.2334],[0.825,0.2359],[0.85,0.2389],[0.875,0.248],[0.9,0.2604],[0.925,0.2819],[0.95,0.3111],[0.975,0.3496],[1.0,0.3975],[1.025,0.453],[1.05,0.501],[1.075,0.5476],[1.1,0.5719],[1.125,0.5895],[1.15,0.5943],[1.175,0.5933],[1.2,0.5881],[1.225,0.581],[1.25,0.5736],[1.275,0.569],[1.3,0.5651],[1.325,0.5629],[1.35,0.5609],[1.375,0.5591],[1.4,0.5575],[1.425,0.5558],[1.45,0.5543],[1.475,0.5527],[1.5,0.5513],[1.525,0.5499],[1.55,0.5485],[1.575,0.5472],[1.6,0.546],[1.625,0.5449],[1.65,0.5438],[1.675,0.5428],[1.7,0.5419],[1.725,0.541],[1.75,0.5401],[1.775,0.5393],[1.8,0.5385],[1.825,0.5377],[1.85,0.5369],[1.875,0.5361],[1.9,0.5354],[1.925,0.5346],[1.95,0.5338],[2.0,0.5323],[2.1,0.5294],[2.2,0.5267],[2.3,0.524],[2.4,0.5216],[2.5,0.5193],[2.6,0.517],[2.65,0.516],[2.7,0.5149],[2.8,0.5129],[2.9,0.5109],[3.0,0.5091],[3.1,0.5074],[3.2,0.5058],[3.3,0.5043],[3.4,0.5029],[3.5,0.5017],[3.6,0.5006],[3.7,0.4995],[3.8,0.4986],[3.9,0.4977],[4.0,0.4969]]};

  const G = 9.80665;                    // m/s²
  const FT = 0.3048;                    // m por pé
  const GR_TO_KG = 6.479891e-5;
  const LB_IN2_TO_KG_M2 = 703.0696;     // 1 lb/in² em kg/m²
  const OMEGA_EARTH = 7.2921159e-5;     // rad/s
  const RHO_STD = 1.225;                // kg/m³ (ICAO: 15 °C, 1013,25 hPa, ar seco) — atmosfera em que o BC é definido
  const MOA = Math.PI / (180 * 60);     // rad
  const MRAD = 0.001;                   // rad
  const MODELS = Object.keys(DRAG_TABLES);

  const TURRETS = {
    '1/4_MOA': { unit: 'MOA', v: 0.25 }, '1/8_MOA': { unit: 'MOA', v: 0.125 }, '1/2_MOA': { unit: 'MOA', v: 0.5 },
    '1/3_MOA': { unit: 'MOA', v: 1 / 3 }, '0.1_MRAD': { unit: 'MRAD', v: 0.1 }, '0.05_MRAD': { unit: 'MRAD', v: 0.05 }
  };

  // ---------- atmosfera ----------
  function atmosphere(tempC, pressureHpa, humidityPct) {
    const T = tempC + 273.15, p = pressureHpa * 100;
    const es = 611.21 * Math.exp((18.678 - tempC / 234.5) * (tempC / (257.14 + tempC)));   // pressão de saturação (Pa), Buck
    const pv = Math.min(Math.max(humidityPct, 0), 100) / 100 * es;
    const pd = p - pv;
    const rho = pd / (287.058 * T) + pv / (461.495 * T);
    const xv = pv / p;
    const mMix = (1 - xv) * 28.9647 + xv * 18.0153;        // g/mol
    const gamma = (1 - xv) * 1.4 + xv * 1.33;
    const c = Math.sqrt(gamma * 8.314462 * T / (mMix / 1000));
    return { rho, c, T, p };
  }

  function makeCd(table) {
    const n = table.length;
    return function (m) {
      if (m <= table[0][0]) return table[0][1];
      if (m >= table[n - 1][0]) return table[n - 1][1];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid][0] <= m) lo = mid; else hi = mid; }
      const t = (m - table[lo][0]) / (table[hi][0] - table[lo][0]);
      return table[lo][1] + t * (table[hi][1] - table[lo][1]);
    };
  }

  // ---------- contexto ----------
  function num(v, d) { const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return (typeof x === 'number' && isFinite(x)) ? x : d; }

  function buildContext(inp) {
    const model = (inp.dragModel || 'G1').toString().toUpperCase();
    const table = Array.isArray(inp.customTable) && inp.customTable.length > 3 ? inp.customTable : DRAG_TABLES[model];
    if (!table) throw new Error('Modelo de arrasto desconhecido: ' + model);
    const bc = num(inp.bc, 0.447);
    if (!(bc > 0)) throw new Error('BC inválido');
    const v0 = num(inp.vFps, 2680) * FT;
    const az = num(inp.azimuthDeg, 90) * Math.PI / 180;
    const alpha = num(inp.inclinationDeg, 0) * Math.PI / 180;
    const lat = num(inp.latitudeDeg, 0) * Math.PI / 180;
    const atm = atmosphere(num(inp.tempC, 15), num(inp.pressureHpa, 1013.25), num(inp.humidityPct, 50));
    // vetores-base (leste, norte, cima)
    const h = [Math.sin(az), Math.cos(az), 0];                       // direção horizontal do tiro
    const r = [Math.cos(az), -Math.sin(az), 0];                      // direita do atirador (horizontal)
    const z = [0, 0, 1];
    const los = [Math.cos(alpha) * h[0], Math.cos(alpha) * h[1], Math.sin(alpha)];
    const nrm = [-Math.sin(alpha) * h[0], -Math.sin(alpha) * h[1], Math.cos(alpha)];   // "cima" perpendicular à linha de visada
    // vento: sopra DE um azimute relativo (relógio * 30°), horário a partir da direção do tiro
    const windMs = Math.max(0, num(inp.windKmh, 0)) / 3.6;
    const clock = num(inp.windClock, 12);
    const beta = (((clock % 12) + 12) % 12) * 30 * Math.PI / 180;
    const from = [Math.cos(beta) * h[0] + Math.sin(beta) * r[0], Math.cos(beta) * h[1] + Math.sin(beta) * r[1], 0];
    const wind = [-windMs * from[0], -windMs * from[1], 0];
    const omega = [0, OMEGA_EARTH * Math.cos(lat), OMEGA_EARTH * Math.sin(lat)];
    return {
      model, cd: makeCd(table), bcSi: bc * LB_IN2_TO_KG_M2, bc, v0, atm,
      h, r, z, los, nrm, alpha, wind, omega, windMs,
      scopeH: Math.max(0, num(inp.scopeHeightCm, 3.8)) / 100,
      zeroDist: Math.max(10, num(inp.zeroDistM, 100)),
      twistIn: num(inp.twistIn, 0), twistDir: (inp.twistDir || 'RIGHT').toString().toUpperCase().indexOf('L') === 0 ? -1 : 1,
      weightGr: num(inp.weightGr, 0), calIn: num(inp.caliberIn, 0), lenIn: num(inp.bulletLengthIn, 0),
      tempC: num(inp.tempC, 15), pressureHpa: num(inp.pressureHpa, 1013.25),
      useWind: true, useCor: true
    };
  }

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // aceleração em função da velocidade (no referencial do solo)
  function accel(ctx, v, useWind, useCor) {
    const vr0 = v[0] - (useWind ? ctx.wind[0] : 0), vr1 = v[1] - (useWind ? ctx.wind[1] : 0), vr2 = v[2];
    const sp = Math.sqrt(vr0 * vr0 + vr1 * vr1 + vr2 * vr2);
    const m = sp / ctx.atm.c;
    const k = (Math.PI / 8) * ctx.atm.rho * ctx.cd(m) * sp / ctx.bcSi;   // 1/s
    let ax = -k * vr0, ay = -k * vr1, az = -k * vr2 - G;
    if (useCor) {   // a = -2 Ω × v
      const w = ctx.omega;
      ax += -2 * (w[1] * v[2] - w[2] * v[1]);
      ay += -2 * (w[2] * v[0] - w[0] * v[2]);
      az += -2 * (w[0] * v[1] - w[1] * v[0]);
    }
    return [ax, ay, az];
  }

  // um voo: ângulo do cano acima da linha de visada (theta) e giro para a direita (phi); devolve o estado em range (distância ao longo da visada)
  function fly(ctx, theta, phi, range, useWind, useCor) {
    const a = ctx.alpha + theta;
    const hx = ctx.h[0] * Math.cos(phi) + ctx.h[1] * Math.sin(phi);          // gira h para a direita em phi (horário visto de cima)
    const hy = -ctx.h[0] * Math.sin(phi) + ctx.h[1] * Math.cos(phi);
    const ca = Math.cos(a), sa = Math.sin(a);
    let v = [ctx.v0 * ca * hx, ctx.v0 * ca * hy, ctx.v0 * sa];
    let p = [-ctx.scopeH * ctx.nrm[0], -ctx.scopeH * ctx.nrm[1], -ctx.scopeH * ctx.nrm[2]];
    let t = 0, s = 0;
    const dt = 0.001;
    for (let i = 0; i < 40000; i++) {
      const k1v = accel(ctx, v, useWind, useCor);
      const v2 = [v[0] + 0.5 * dt * k1v[0], v[1] + 0.5 * dt * k1v[1], v[2] + 0.5 * dt * k1v[2]];
      const k2v = accel(ctx, v2, useWind, useCor);
      const v3 = [v[0] + 0.5 * dt * k2v[0], v[1] + 0.5 * dt * k2v[1], v[2] + 0.5 * dt * k2v[2]];
      const k3v = accel(ctx, v3, useWind, useCor);
      const v4 = [v[0] + dt * k3v[0], v[1] + dt * k3v[1], v[2] + dt * k3v[2]];
      const k4v = accel(ctx, v4, useWind, useCor);
      const nv = [
        v[0] + dt / 6 * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]),
        v[1] + dt / 6 * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]),
        v[2] + dt / 6 * (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2])];
      const np = [
        p[0] + dt / 6 * (v[0] + 2 * v2[0] + 2 * v3[0] + v4[0]),
        p[1] + dt / 6 * (v[1] + 2 * v2[1] + 2 * v3[1] + v4[1]),
        p[2] + dt / 6 * (v[2] + 2 * v2[2] + 2 * v3[2] + v4[2])];
      const ns = dot(np, ctx.los);
      if (ns >= range) {
        const f = (range - s) / (ns - s);
        const pp = [p[0] + f * (np[0] - p[0]), p[1] + f * (np[1] - p[1]), p[2] + f * (np[2] - p[2])];
        const vv = [v[0] + f * (nv[0] - v[0]), v[1] + f * (nv[1] - v[1]), v[2] + f * (nv[2] - v[2])];
        return { ok: true, t: t + f * dt, dn: dot(pp, ctx.nrm), dr: dot(pp, ctx.r), v: vv, speed: Math.hypot(vv[0], vv[1], vv[2]) };
      }
      p = np; v = nv; t += dt; s = ns;
      if (Math.hypot(v[0], v[1], v[2]) < 25) break;       // parou de ser uma trajetória útil
    }
    return { ok: false };
  }

  // Voo amostrado numa grade de alcances (0, step, 2*step, ...) numa única integração: serve aos gráficos e tabelas.
  function trace(ctx, theta, phi, maxR, step, useWind, useCor) {
    const n = Math.floor(maxR / step) + 1;
    const dn = new Float64Array(n).fill(NaN), dr = new Float64Array(n).fill(NaN), tt = new Float64Array(n).fill(NaN), sp = new Float64Array(n).fill(NaN);
    const a = ctx.alpha + theta;
    const hx = ctx.h[0] * Math.cos(phi) + ctx.h[1] * Math.sin(phi), hy = -ctx.h[0] * Math.sin(phi) + ctx.h[1] * Math.cos(phi);
    const ca = Math.cos(a), sa = Math.sin(a);
    let v = [ctx.v0 * ca * hx, ctx.v0 * ca * hy, ctx.v0 * sa];
    let p = [-ctx.scopeH * ctx.nrm[0], -ctx.scopeH * ctx.nrm[1], -ctx.scopeH * ctx.nrm[2]];
    let t = 0, s = 0, k = 1;
    dn[0] = dot(p, ctx.nrm); dr[0] = dot(p, ctx.r); tt[0] = 0; sp[0] = ctx.v0;
    const dt = 0.001;
    for (let i = 0; i < 60000 && k < n; i++) {
      const k1v = accel(ctx, v, useWind, useCor);
      const v2 = [v[0] + 0.5 * dt * k1v[0], v[1] + 0.5 * dt * k1v[1], v[2] + 0.5 * dt * k1v[2]];
      const k2v = accel(ctx, v2, useWind, useCor);
      const v3 = [v[0] + 0.5 * dt * k2v[0], v[1] + 0.5 * dt * k2v[1], v[2] + 0.5 * dt * k2v[2]];
      const k3v = accel(ctx, v3, useWind, useCor);
      const v4 = [v[0] + dt * k3v[0], v[1] + dt * k3v[1], v[2] + dt * k3v[2]];
      const k4v = accel(ctx, v4, useWind, useCor);
      const nv = [v[0] + dt / 6 * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]), v[1] + dt / 6 * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]), v[2] + dt / 6 * (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2])];
      const np = [p[0] + dt / 6 * (v[0] + 2 * v2[0] + 2 * v3[0] + v4[0]), p[1] + dt / 6 * (v[1] + 2 * v2[1] + 2 * v3[1] + v4[1]), p[2] + dt / 6 * (v[2] + 2 * v2[2] + 2 * v3[2] + v4[2])];
      const ns = dot(np, ctx.los);
      while (k < n && k * step <= ns) {
        const f = ns === s ? 0 : (k * step - s) / (ns - s);
        const pp = [p[0] + f * (np[0] - p[0]), p[1] + f * (np[1] - p[1]), p[2] + f * (np[2] - p[2])];
        const vv = [v[0] + f * (nv[0] - v[0]), v[1] + f * (nv[1] - v[1]), v[2] + f * (nv[2] - v[2])];
        dn[k] = dot(pp, ctx.nrm); dr[k] = dot(pp, ctx.r); tt[k] = t + f * dt; sp[k] = Math.hypot(vv[0], vv[1], vv[2]); k++;
      }
      p = np; v = nv; t += dt; s = ns;
      if (Math.hypot(v[0], v[1], v[2]) < 25) break;
    }
    return { step, n, dn, dr, t: tt, speed: sp };
  }

  // Perfil denso para os gráficos: queda/altura em relação à visada, tempo e velocidade a cada `step` m (sem vento nem Coriolis),
  // e a deriva lateral só do vento (se houver). `aimDeltaRad` soma um ângulo à zeragem (torre "dialada").
  function profile(inp, opts) {
    opts = opts || {};
    const ctx = buildContext(inp);
    const theta0 = zeroTheta(ctx);
    const aim = theta0 + (opts.aimDeltaRad || 0);
    const maxR = Math.max(50, opts.maxRange || 1500), step = opts.step || 1;
    const base = trace(ctx, aim, 0, maxR, step, false, false);
    let windDr = null;
    if (ctx.windMs > 0) {
      const w = trace(ctx, aim, 0, maxR, step, true, false);
      windDr = new Float64Array(base.n);
      for (let i = 0; i < base.n; i++) windDr[i] = w.dr[i] - base.dr[i];
    }
    return { step, n: base.n, maxRange: maxR, theta0, dn: base.dn, t: base.t, speed: base.speed, windDr };
  }

  // ângulo do cano (acima da visada) que faz o projétil cruzar a linha de visada em range.
  // Secante (a altura é quase linear no ângulo: converge em 3-5 voos); se algo sair do esperado, cai na bisseção.
  function solveTheta(ctx, range, phi, useWind, useCor, guess) {
    const f = (th) => { const r = fly(ctx, th, phi, range, useWind, useCor); return r.ok ? r.dn : NaN; };
    let t0 = typeof guess === 'number' ? guess : 0.002, t1 = t0 + 0.001;
    let f0 = f(t0), f1 = f(t1);
    for (let i = 0; i < 12 && isFinite(f0) && isFinite(f1); i++) {
      if (Math.abs(f1) < 1e-6) return t1;
      const d = f1 - f0;
      if (Math.abs(d) < 1e-12) break;
      const t2 = t1 - f1 * (t1 - t0) / d;
      if (!isFinite(t2) || t2 < -0.5 || t2 > 0.8) break;
      t0 = t1; f0 = f1; t1 = t2; f1 = f(t1);
    }
    if (isFinite(f1) && Math.abs(f1) < 1e-5) return t1;
    let lo = -0.35, hi = 0.65;      // plano B: bisseção
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, v = f(mid);
      if (!isFinite(v)) { hi = mid; continue; }
      if (v < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------- deriva giroscópica ----------
  function millerSg(ctx, vFps) {
    if (!(ctx.twistIn > 0 && ctx.calIn > 0 && ctx.lenIn > 0 && ctx.weightGr > 0)) return null;
    const tCal = ctx.twistIn / ctx.calIn, lCal = ctx.lenIn / ctx.calIn;
    let sg = 30 * ctx.weightGr / (tCal * tCal * Math.pow(ctx.calIn, 3) * lCal * (1 + lCal * lCal));
    sg *= Math.pow(vFps / 2800, 1 / 3);
    const tF = ctx.tempC * 9 / 5 + 32, pIn = ctx.pressureHpa / 33.8639;
    sg *= ((tF + 460) / 519) * (29.92 / pIn);
    return sg;
  }
  function spinDriftM(sg, t, dir) { return dir * 0.0254 * 1.25 * (sg + 1.2) * Math.pow(t, 1.83); }

  // ---------- zeragem (uma vez por conjunto de condições) ----------
  function zeroTheta(ctx) {
    const flat = Object.assign({}, ctx, { alpha: 0 });
    flat.los = [ctx.h[0], ctx.h[1], 0];
    flat.nrm = [0, 0, 1];
    return solveTheta(flat, ctx.zeroDist, 0, false, false);
  }

  // ---------- API ----------
  function solveWith(ctx, theta0, rangeM, inp) {
    const R = Math.max(1, rangeM);
    const turret = TURRETS[inp.turret] || TURRETS['1/4_MOA'];
    // 1) elevação necessária com tudo ligado (vento, Coriolis) e giro lateral resolvido junto
    const COR = inp.coriolis !== false;
    let phi = 0, thetaR = theta0, last = null, sgInfo = null;
    const spinOf = (t, v) => {
      let sg = millerSg(ctx, v / FT), est = false;
      if (sg === null) { sg = 1.5; est = true; }
      sgInfo = { sg, est };
      return ctx.twistIn > 0 || true ? spinDriftM(sg, t, ctx.twistDir) : 0;
    };
    for (let it = 0; it < 4; it++) {
      thetaR = solveTheta(ctx, R, phi, true, COR, thetaR);
      last = fly(ctx, thetaR, phi, R, true, COR);
      if (!last.ok) return { success: false, error: 'O projétil não alcança essa distância (velocidade final muito baixa).' };
      const dr = last.dr + (inp.spinDrift === false ? 0 : spinOf(last.t, last.speed));
      phi += -dr / R;
      if (Math.abs(dr) < 1e-4) break;
    }
    thetaR = solveTheta(ctx, R, phi, true, COR, thetaR);
    last = fly(ctx, thetaR, phi, R, true, COR);
    // 2) queda com o cano na zeragem (o que o projétil faria sem correção)
    const zeroShot = fly(ctx, theta0, 0, R, false, false);
    // 3) componentes da deriva, com o cano na elevação final
    const aimed = (w, c) => fly(ctx, thetaR, 0, R, w, c);
    const windOnly = aimed(true, false), corOnly = COR ? aimed(false, true) : null, none = aimed(false, false);
    const windZero = fly(ctx, theta0, 0, R, true, false), noneZero = fly(ctx, theta0, 0, R, false, false);
    const sgv = millerSg(ctx, ctx.v0 / FT);
    const spinM = inp.spinDrift === false ? 0 : spinDriftM(sgv === null ? 1.5 : sgv, last.t, ctx.twistDir);
    const windDriftM = windOnly.ok && none.ok ? windOnly.dr - none.dr : 0;
    const corM = corOnly && corOnly.ok && none.ok ? corOnly.dr - none.dr : 0;
    const windZeroM = windZero.ok && noneZero.ok ? windZero.dr - noneZero.dr : 0;
    const elevRad = thetaR - theta0;                       // + = subir
    const windRad = phi;                                   // + = para a direita
    const toUnit = (rad) => (turret.unit === 'MOA' ? rad / MOA : rad / MRAD);
    const clicksE = Math.round(toUnit(elevRad) / turret.v);
    const clicksW = Math.round(toUnit(windRad) / turret.v);
    const v_target_fps = last.speed / FT;
    const m = last.speed / ctx.atm.c;
    const energyJ = ctx.weightGr > 0 ? 0.5 * ctx.weightGr * GR_TO_KG * last.speed * last.speed : null;
    const r2 = (x) => parseFloat(x.toFixed(2));
    return {
      success: true,
      engine: 'geosniper-3d',
      dragModel: ctx.model,
      clicksElev: clicksE,
      clicksWind: clicksW,
      moaElev: r2(elevRad / MOA), mradElev: r2(elevRad / MRAD),
      moaWind: r2(windRad / MOA), mradWind: r2(windRad / MRAD),
      netDropCm: zeroShot.ok ? r2(-zeroShot.dn * 100) : null,
      v_target_fps: Math.round(v_target_fps),
      t_flight: last.t.toFixed(2),
      mach: parseFloat(m.toFixed(2)),
      energyJ: energyJ === null ? null : Math.round(energyJ),
      windDriftCm: r2(windDriftM * 100),
      windDriftZeroAimCm: r2(windZeroM * 100),
      spinDriftCm: r2(spinM * 100),
      coriolisCm: r2(corM * 100),
      spinSg: sgInfo ? parseFloat(sgInfo.sg.toFixed(2)) : null,
      spinEstimated: sgInfo ? sgInfo.est : null,
      airDensity: parseFloat(ctx.atm.rho.toFixed(4)),
      speedOfSound: Math.round(ctx.atm.c),
      turretUnit: turret.unit, turretValue: turret.v,
      recommendedZoom: Math.min(24, Math.max(4, Math.round(R / 40)))
    };
  }

  function solve(inp) {
    const ctx = buildContext(inp);
    const theta0 = zeroTheta(ctx);
    return solveWith(ctx, theta0, num(inp.distM, 100), inp);
  }

  // só a queda (cm abaixo da visada, com o cano na zeragem) — usada pela calibração de BC
  function dropCm(inp) {
    const ctx = buildContext(inp);
    const th0 = zeroTheta(ctx);
    const f = fly(ctx, th0, 0, num(inp.distM, 100), true, inp.coriolis !== false);
    return f.ok ? -f.dn * 100 : null;
  }

  // vários alcances de uma vez (reaproveita a zeragem)
  function table(inp, distances) {
    const ctx = buildContext(inp);
    const theta0 = zeroTheta(ctx);
    return distances.map(d => Object.assign({ distM: d }, solveWith(ctx, theta0, d, inp)));
  }

  return { solve, table, dropCm, profile, atmosphere, models: MODELS, TURRETS, constants: { G, RHO_STD, MOA, MRAD }, _internal: { buildContext, zeroTheta, fly, solveTheta } };
});
