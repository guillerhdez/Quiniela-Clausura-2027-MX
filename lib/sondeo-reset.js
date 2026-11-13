'use strict';
// Lógica pura del sondeo del restablecimiento de contraseña (E3b, paso 1).
// Pregunta que responde: ¿Google acepta `accounts:sendOobCode` (PASSWORD_RESET) llamado desde un servidor con la Web API key
// restringida por sitio web (HTTP referrers), si el script manda el encabezado Referer del sitio?
// Los logs de Actions son públicos: nada de lo que se imprima puede contener el correo ni la key.

const ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';
const REFERER_SITIO = 'https://clausura-mx-2027.netlify.app/';

// Quita de un texto cualquier aparición de los valores secretos.
function censurar(texto, secretos) {
  let t = String(texto == null ? '' : texto);
  for (const s of secretos || []) {
    if (s && String(s).length >= 4) t = t.split(String(s)).join('***');
  }
  return t;
}

// Convierte la respuesta HTTP en un veredicto imprimible. `cuerpo` es el JSON ya parseado (o null).
// resultado: 'enviado' | 'bloqueado-referer' | 'bloqueado-api' | 'rechazado' | 'limite' | 'inesperado'
function clasificarRespuesta(status, cuerpo, secretos) {
  const err = cuerpo && typeof cuerpo === 'object' ? cuerpo.error : null;
  const msg = censurar(err && err.message, secretos);
  const estado = err && typeof err.status === 'string' ? err.status : '';
  const detalles = err && Array.isArray(err.details) ? err.details : [];
  const razones = detalles.map((d) => d && d.reason).filter((r) => typeof r === 'string');
  const razon = razones[0] || '';

  if (status === 200 && cuerpo && !err) {
    return { resultado: 'enviado', status, estado: '', razon: '', mensaje: 'Google aceptó la solicitud (el correo de prueba debería llegar)' };
  }
  if (razon === 'API_KEY_HTTP_REFERRER_BLOCKED' || /referer/i.test(msg)) {
    return { resultado: 'bloqueado-referer', status, estado, razon, mensaje: msg };
  }
  if (/^API_KEY_|SERVICE_BLOCKED|API_KEY_SERVICE_BLOCKED/.test(razon) || /API key|API_KEY/.test(msg)) {
    return { resultado: 'bloqueado-api', status, estado, razon, mensaje: msg };
  }
  if (/TOO_MANY_ATTEMPTS/.test(msg) || status === 429) {
    return { resultado: 'limite', status, estado, razon, mensaje: msg };
  }
  if (status >= 400) {
    return { resultado: 'rechazado', status, estado, razon, mensaje: msg };
  }
  return { resultado: 'inesperado', status, estado, razon, mensaje: msg };
}

// Qué implica cada veredicto para la decisión de E3b.
const IMPLICACION = {
  enviado: 'El servidor SÍ puede disparar el correo con ese encabezado.',
  'bloqueado-referer': 'La restricción por sitio web rechazó esta llamada (si fue la de con-referer, el encabezado no basta: usar la alternativa; si fue la de sin-referer, es lo esperado).',
  'bloqueado-api': 'La key no permite esta API o es inválida: revisar la restricción de API y el secret.',
  rechazado: 'Google rechazó la solicitud por otra razón (ver código): corregir antes de decidir.',
  limite: 'Límite de intentos de Google: esperar un rato y repetir; no concluye nada.',
  inesperado: 'Respuesta no prevista: revisar el log.',
};

module.exports = { ENDPOINT, REFERER_SITIO, censurar, clasificarRespuesta, IMPLICACION };
