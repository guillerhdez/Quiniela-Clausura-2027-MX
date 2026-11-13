'use strict';
// SONDEO (disparo manual, E3b paso 1): ¿puede un servidor mandar el correo de restablecimiento con la Web API key
// restringida por sitio web? Llama a accounts:sendOobCode (PASSWORD_RESET) con y/o sin el encabezado Referer.
// Uso: node scripts/probar-reset.js [con-referer|sin-referer|ambos]     (por defecto: ambos)
// Entorno: FIREBASE_WEB_API_KEY y CORREO_PRUEBA (ambos secrets del repo). Usar SOLO una cuenta de prueba.
// Los logs son públicos: no se imprime el correo ni la key (y cualquier texto de Google pasa por `censurar`).
// Envía como máximo 2 correos de restablecimiento a la cuenta de prueba. No escribe en ninguna base.
const { ENDPOINT, REFERER_SITIO, clasificarRespuesta, IMPLICACION } = require('../lib/sondeo-reset');

async function intento(nombre, key, correo, conReferer) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'quiniela-clausura-sondeo/1.0' };
  if (conReferer) headers.Referer = REFERER_SITIO;
  let status = 0, cuerpo = null;
  try {
    const r = await fetch(ENDPOINT + '?key=' + encodeURIComponent(key), {
      method: 'POST', headers,
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: correo }),
      signal: AbortSignal.timeout(20000),
    });
    status = r.status;
    try { cuerpo = await r.json(); } catch (e) { cuerpo = null; }
  } catch (e) {
    console.log('[' + nombre + '] Error de red: ' + (e && e.name ? e.name : 'desconocido'));
    return { resultado: 'inesperado' };
  }
  const v = clasificarRespuesta(status, cuerpo, [key, correo]);
  console.log('[' + nombre + '] HTTP ' + v.status + ' | resultado: ' + v.resultado + (v.estado ? ' | estado: ' + v.estado : '') + (v.razon ? ' | razón: ' + v.razon : ''));
  if (v.mensaje) console.log('[' + nombre + '] Mensaje de Google: ' + v.mensaje);
  console.log('[' + nombre + '] ' + IMPLICACION[v.resultado]);
  return v;
}

async function main() {
  const modo = process.argv[2] || 'ambos';
  if (!['con-referer', 'sin-referer', 'ambos'].includes(modo)) throw new Error('Modo inválido: usa con-referer, sin-referer o ambos');
  const key = process.env.FIREBASE_WEB_API_KEY;
  const correo = process.env.CORREO_PRUEBA;
  if (!key) throw new Error('Falta el secret FIREBASE_WEB_API_KEY');
  if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('Falta el secret CORREO_PRUEBA o no parece un correo');

  console.log('Sondeo del restablecimiento de contraseña | modo: ' + modo + ' | Referer del sitio: ' + REFERER_SITIO);
  const res = {};
  // Primero la pregunta clave (con Referer); la contraprueba (sin Referer) confirma que la restricción está activa.
  if (modo !== 'sin-referer') res.con = await intento('con-referer', key, correo, true);
  if (modo === 'ambos') await new Promise((ok) => setTimeout(ok, 3000));
  if (modo !== 'con-referer') res.sin = await intento('sin-referer', key, correo, false);

  console.log('--- Resumen ---');
  if (res.con) console.log('Con Referer: ' + res.con.resultado);
  if (res.sin) console.log('Sin Referer: ' + res.sin.resultado);
  if (res.con && res.sin) {
    if (res.con.resultado === 'enviado' && res.sin.resultado === 'bloqueado-referer') console.log('Conclusión: la restricción está activa y el encabezado Referer la satisface. El script de servidor puede enviar el correo.');
    else if (res.con.resultado === 'enviado' && res.sin.resultado === 'enviado') console.log('Conclusión: Google aceptó ambas llamadas; esta API no exige el referer desde servidor (o la restricción no aplica). Funciona, pero conviene confirmar la restricción en Cloud Console.');
    else if (res.con.resultado === 'bloqueado-referer') console.log('Conclusión: el encabezado Referer NO basta. Hay que usar la alternativa.');
    else console.log('Conclusión: no concluyente (ver resultados arriba).');
  }
  // Rojo solo si el hallazgo clave (con Referer) no fue un envío: así GitHub avisa por correo.
  if (res.con && res.con.resultado !== 'enviado') process.exitCode = 1;
}

main().catch((e) => { console.error('Error: ' + (e && e.message ? e.message : e)); process.exit(1); });
