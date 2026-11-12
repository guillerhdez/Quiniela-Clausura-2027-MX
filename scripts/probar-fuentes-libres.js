'use strict';
// Prueba de fuentes gratuitas de resultados de Liga MX: ESPN (endpoint no documentado) y TheSportsDB (clave pública 123).
// SOLO LEE; no usa secrets ni escribe en Firebase. Los datos son marcadores públicos.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const ID_LIGA_TSDB = '4350';

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-prueba/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) { /* no JSON */ }
    return { http: r.status, j, bytes: txt.length, inicio: j ? '' : txt.slice(0, 120).replace(/\s+/g, ' ') };
  } catch (e) { return { http: 0, j: null, bytes: 0, inicio: 'error: ' + e.message }; }
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  // ---- ESPN: ventana de los últimos 14 días ----
  const hasta = new Date(), desde = new Date(Date.now() - 14 * 864e5);
  const e = await get(ESPN + '?dates=' + ymd(desde) + '-' + ymd(hasta));
  const evs = (e.j && e.j.events) || [];
  console.log('ESPN -> HTTP', e.http, '| bytes', e.bytes, '| eventos:', evs.length, e.inicio);
  if (e.j && e.j.leagues && e.j.leagues[0]) console.log('  liga:', e.j.leagues[0].name, '| temporada:', e.j.leagues[0].season && e.j.leagues[0].season.year);
  evs.slice(-20).forEach((v) => {
    const c = (v.competitions && v.competitions[0] && v.competitions[0].competitors) || [];
    const loc = c.find((x) => x.homeAway === 'home'), vis = c.find((x) => x.homeAway === 'away');
    const st = v.status && v.status.type;
    console.log('  ', (v.date || '').slice(0, 16), '|', loc && loc.team && loc.team.displayName, loc && loc.score, '-', vis && vis.score, vis && vis.team && vis.team.displayName, '|', st && st.description, '| terminado:', st && st.completed);
  });

  // ---- TheSportsDB: últimos 15 partidos de la liga y temporada 2026-2027 ----
  const p = await get(TSDB + '/eventspastleague.php?id=' + ID_LIGA_TSDB);
  const pe = (p.j && p.j.events) || [];
  console.log('TheSportsDB pasados -> HTTP', p.http, '| eventos:', pe.length, p.inicio);
  pe.slice(-15).forEach((v) => console.log('  ', v.dateEvent, v.strTime || '', '| ronda', v.intRound, '|', v.strHomeTeam, v.intHomeScore, '-', v.intAwayScore, v.strAwayTeam, '|', v.strStatus, '| temp', v.strSeason));

  const s = await get(TSDB + '/eventsseason.php?id=' + ID_LIGA_TSDB + '&s=2026-2027');
  const se = (s.j && s.j.events) || [];
  const conMarcador = se.filter((v) => v.intHomeScore !== null && v.intHomeScore !== undefined && v.intHomeScore !== '');
  const rondas = [...new Set(se.map((v) => v.intRound))].sort((a, b) => a - b);
  console.log('TheSportsDB temporada 2026-2027 -> HTTP', s.http, '| partidos:', se.length, '| con marcador:', conMarcador.length, '| rondas:', rondas.join(','), s.inicio);
})().catch((x) => { console.error('Error:', x.message); process.exit(1); });
