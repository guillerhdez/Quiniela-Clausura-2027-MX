'use strict';
// Prueba de la fuente de resultados (API-Football). SOLO LEE: no escribe en Firebase ni imprime la key.
// Uso: API_FOOTBALL_KEY=... node scripts/probar-fuente.js [--season=AAAA] [--liga=ID]
// Consume ~4-6 solicitudes de las 100 diarias del plan gratis.
const BASE = 'https://v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY;
if (!KEY) { console.error('Falta el secret API_FOOTBALL_KEY.'); process.exit(1); }
const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : ''; };

async function get(ruta) {
  const r = await fetch(BASE + ruta, { headers: { 'x-apisports-key': KEY } });
  let j = null;
  try { j = await r.json(); } catch (e) { /* respuesta no JSON */ }
  return { http: r.status, restantes: r.headers.get('x-ratelimit-requests-remaining'), j };
}
const errores = (j) => {
  const e = j && j.errors;
  if (!e || (Array.isArray(e) && !e.length) || (typeof e === 'object' && !Object.keys(e).length)) return '';
  return JSON.stringify(e);
};

(async () => {
  // 1) Estado de la cuenta (se imprime solo plan y cuota; la respuesta trae datos personales: no se muestran)
  const st = await get('/status');
  const resp = st.j && st.j.response;
  console.log('Estado -> HTTP', st.http, '| plan:', resp && resp.subscription && resp.subscription.plan,
    '| solicitudes hoy:', resp && resp.requests && resp.requests.current, '/', resp && resp.requests && resp.requests.limit_day, errores(st.j));

  // 2) Liga MX y sus temporadas
  let ligaId = arg('liga');
  const lg = await get('/leagues?country=Mexico');
  console.log('Ligas de México -> HTTP', lg.http, errores(lg.j), '| resultados:', lg.j && lg.j.results);
  const ligas = (lg.j && lg.j.response) || [];
  ligas.forEach((x) => console.log('  liga', x.league.id, '|', x.league.name, '|', x.league.type));
  const mx = ligas.find((x) => String(x.league.id) === ligaId) || ligas.find((x) => /liga mx/i.test(x.league.name));
  if (!mx) { console.log('No se encontró Liga MX en la respuesta.'); return; }
  ligaId = String(mx.league.id);
  console.log('Liga MX -> id', ligaId, '| temporadas (últimas 4):');
  mx.seasons.slice(-4).forEach((s) => console.log('  ', s.year, s.start, '→', s.end, '| actual:', s.current, '| fixtures:', s.coverage && s.coverage.fixtures && JSON.stringify(s.coverage.fixtures)));

  // 3) Partidos terminados de la temporada vigente y de la anterior
  const anios = mx.seasons.map((s) => s.year).sort((a, b) => a - b);
  const vigente = (mx.seasons.find((s) => s.current) || mx.seasons[mx.seasons.length - 1]).year;
  const lista = arg('season') ? [Number(arg('season'))] : [vigente, vigente - 1].filter((y) => anios.includes(y));
  for (const y of lista) {
    const fx = await get('/fixtures?league=' + ligaId + '&season=' + y + '&status=FT');
    const arr = (fx.j && fx.j.response) || [];
    console.log('Temporada', y, '-> HTTP', fx.http, '| terminados:', arr.length, errores(fx.j), '| restantes hoy:', fx.restantes);
    arr.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date)).slice(0, 20).forEach((f) => {
      console.log('  ', f.fixture.date.slice(0, 16), '|', f.league.round, '|', f.teams.home.name, f.goals.home, '-', f.goals.away, f.teams.away.name, '|', f.fixture.status.short);
    });
  }
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
