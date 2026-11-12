'use strict';
// Calcula tabla, tablaJornada/{j}, tablaJornada/liguilla, tablaJornada/final y tablaMeta y los escribe en Firebase con la cuenta de servicio.
// Uso: node scripts/calcular-tabla.js [--dry] [--forzar]
//   --dry     calcula y muestra un resumen, sin escribir
//   --forzar  recalcula aunque la huella de resultados no haya cambiado
// Los logs son públicos: solo se imprimen conteos (nunca uids, correos, nicks ni la clave).
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { calcularTablas, huellaEntradas, planActualizacion } = require('../lib/tabla');

const DB_URL = process.env.FIREBASE_DB_URL || 'https://quiniela-clausura-2027-default-rtdb.firebaseio.com';
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORZAR = args.includes('--forzar');
// Override opcional (solo para pruebas con --dry): JORNADAS_REGULARES=N
const OPCIONES = {};
if (process.env.JORNADAS_REGULARES && Number.isInteger(Number(process.env.JORNADAS_REGULARES)) && Number(process.env.JORNADAS_REGULARES) > 0) {
  OPCIONES.jornadasRegulares = Number(process.env.JORNADAS_REGULARES);
}

async function leer(db, ruta) { return (await db.ref(ruta).get()).val(); }
const n = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);

async function main() {
  const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!crudo) throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT');
  let cuenta;
  try { cuenta = JSON.parse(crudo); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido'); }
  const app = initializeApp({ credential: cert(cuenta), databaseURL: DB_URL });
  try {
    const db = getDatabase(app);
    // 1) Comprobación barata: solo partidos, resultados y tablaMeta (pocos KB).
    const [partidos, resultados, meta] = await Promise.all([leer(db, 'partidos'), leer(db, 'resultados'), leer(db, 'tablaMeta')]);
    const huella = huellaEntradas(partidos, resultados);
    if (!FORZAR && meta && meta.huella === huella) { console.log('Sin cambios en resultados: no se recalcula.'); return; }

    // 2) Lectura pesada (solo si hubo cambios).
    const [usuarios, predicciones, referidos] = await Promise.all([leer(db, 'usuarios'), leer(db, 'predicciones'), leer(db, 'referidos')]);
    const calculo = calcularTablas({ usuarios, partidos, resultados, predicciones, referidos }, OPCIONES);
    const cambios = planActualizacion(calculo, meta, huella);
    console.log('Usuarios: ' + n(usuarios) + ' | partidos: ' + n(partidos) + ' | resultados: ' + n(resultados) + ' | referidos: ' + n(referidos));
    console.log('Jornadas completas: ' + (calculo.jornadasCompletas.join(',') || 'ninguna') + ' | filas en tabla: ' + n(calculo.tabla));
    console.log('Fases -> regular: ' + calculo.fases.regular + ' | Liguilla: ' + calculo.fases.liguilla + ' | campeón: ' + calculo.fases.campeon
      + ' | filas Liguilla: ' + n(calculo.tablaLiguilla) + ' | filas Campeón de Campeones: ' + n(calculo.tablaFinal));
    if (DRY) { console.log('--dry: no se escribió nada. Rutas que se actualizarían: ' + Object.keys(cambios).length); return; }

    // 3) Una sola actualización multi-ruta: el cliente nunca ve una tabla a medias.
    await db.ref().update(cambios);
    console.log('Tabla publicada. Versión ' + cambios.tablaMeta.version + ', Jornada ' + cambios.tablaMeta.jornada + '.');
  } finally {
    await deleteApp(app);
  }
}

main().catch((e) => {
  // Solo el código/mensaje: nunca el objeto completo del error.
  console.error('Error: ' + (e && e.code ? e.code + ' - ' : '') + (e && e.message ? String(e.message).slice(0, 200) : 'desconocido'));
  process.exit(1);
});
