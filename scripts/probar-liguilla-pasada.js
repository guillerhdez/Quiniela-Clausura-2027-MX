'use strict';
// E2c-0. Sondeo de SOLO LECTURA: ¿cómo identifican TheSportsDB y ESPN los partidos de Liguilla?
// Se consulta una temporada ya terminada (por defecto 2025-2026) para ver numeración, nombres de ronda y estado.
// Sin secrets ni escritura. Los números de ronda candidatos son hipótesis a comprobar, no supuestos.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const TEMP = process.env.TEMP_SDB || '2025-2026';
const RONDAS = (process.env.RONDAS || '17,18,19,20,21,22,23,24,25,26,27,28,29,30,125,150,175,200')
  .split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
const DESDE = process.env.ESPN_DESDE || '20260425', HASTA = process.env.ESPN_HASTA || '20260531';
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-prueba/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await espera(8000 * (i + 1)); continue; }
      let j = null; try { j = JSON.parse(await r.text()); } catch (e) { /* no JSON */ }
      return { http: r.status, j };
    } catch (e) { await espera(2000); }
  }
  return { http: 0, j: null };
}
const sumaDias = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n)).toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  console.log('== TheSportsDB, temporada ' + TEMP + ', rondas: ' + RONDAS.join(','));
  const vistos = {};
  for (const r of RONDAS) {
    const x = await get(TSDB + '/eventsround.php?id=4350&r=' + r + '&s=' + encodeURIComponent(TEMP));
    const ev = (x.j && x.j.events) || [];
    console.log('Ronda ' + r + ' -> HTTP ' + x.http + ' | eventos: ' + ev.length);
    if (ev.length) {
      console.log('  strRound/strStage/strGroup distintos: ' + [...new Set(ev.map((e) => [e.strRound, e.strStage, e.strGroup].map((v) => v || '').join('/')))].join(' | '));
      for (const e of ev.slice(0, 10)) {
        vistos[e.idEvent] = true;
        console.log('  r' + e.intRound + ' ' + (e.strTimestamp || e.dateEvent) + ' ' + e.strHomeTeam + ' ' + e.intHomeScore + '-' + e.intAwayScore + ' ' + e.strAwayTeam + ' [status=' + (e.strStatus || '') + ' post=' + (e.strPostponed || '') + ']');
      }
    }
    await espera(3500);
  }

  console.log('== ESPN día por día ' + DESDE + ' a ' + HASTA + ' (solo días con eventos)');
  let campos = false;
  for (let d = DESDE; d <= HASTA; d = sumaDias(d, 1)) {
    const r = await get(ESPN + '?dates=' + d);
    if (r.http !== 200) { console.log('  ' + d + ' -> HTTP ' + r.http); await espera(250); continue; }
    const ev = (r.j && r.j.events) || [];
    for (const v of ev) {
      const c = (v.competitions && v.competitions[0]) || {};
      const cs = c.competitors || [];
      const l = cs.find((x) => x.homeAway === 'home'), a = cs.find((x) => x.homeAway === 'away');
      if (!campos) { console.log('  Campos del evento: ' + Object.keys(v).join(', ') + ' | competición: ' + Object.keys(c).join(', ')); campos = true; }
      const notas = (c.notes || v.notes || []).map((n) => n.headline || n.text || '').join(' / ');
      console.log('  ' + d + ' ' + v.date + ' ' + (l && l.team.displayName) + ' ' + (l && l.score) + '-' + (a && a.score) + ' ' + (a && a.team.displayName)
        + ' [estado=' + (v.status && v.status.type && v.status.type.name) + ' season=' + (v.season && (v.season.slug || v.season.type)) + ' tipo=' + (c.type && (c.type.abbreviation || c.type.text)) + (notas ? ' notas=' + notas : '') + ']');
    }
    await espera(250);
  }
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
