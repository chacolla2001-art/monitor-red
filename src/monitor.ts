// Núcleo del monitor: verificaciones HTTP, TCP y DNS con tiempo límite, reintento y medición de latencia.
import { connect } from 'node:net'
import { lookup } from 'node:dns/promises'
import { performance } from 'node:perf_hooks'

export type Tipo = 'http' | 'tcp' | 'dns'

export interface Verificacion {
  nombre: string
  tipo: Tipo
  /** URL para http, host para tcp y dns. */
  destino: string
  puerto?: number
  /** Para http: códigos aceptados (por defecto 200–399). */
  codigos?: number[]
  /** Para http: texto que debe aparecer en la respuesta. */
  contiene?: string
  timeoutMs?: number
  /** Latencia a partir de la cual se considera «lento» (degradado). */
  umbralMs?: number
}

export type Estado = 'arriba' | 'lento' | 'caido'

export interface Resultado {
  nombre: string
  tipo: Tipo
  destino: string
  estado: Estado
  latenciaMs: number | null
  detalle: string
  intentos: number
  fecha: string
}

const TIMEOUT = 5000
const UMBRAL = 1000

export function validarConfig(datos: unknown): Verificacion[] {
  if (!Array.isArray(datos) || datos.length === 0) throw new Error('La configuración debe ser una lista con al menos una verificación.')
  return datos.map((v, i) => {
    const pos = `verificación ${i + 1}`
    if (!v || typeof v !== 'object') throw new Error(`${pos}: debe ser un objeto.`)
    const c = v as Record<string, unknown>
    if (typeof c.nombre !== 'string' || !c.nombre.trim()) throw new Error(`${pos}: falta «nombre».`)
    if (!['http', 'tcp', 'dns'].includes(String(c.tipo))) throw new Error(`${pos} (${c.nombre}): «tipo» debe ser http, tcp o dns.`)
    if (typeof c.destino !== 'string' || !c.destino) throw new Error(`${pos} (${c.nombre}): falta «destino».`)
    if (c.tipo === 'http' && !/^https?:\/\//.test(c.destino)) throw new Error(`${pos} (${c.nombre}): el destino http debe empezar con http:// o https://.`)
    if (c.tipo === 'tcp' && !(Number.isInteger(c.puerto) && (c.puerto as number) > 0 && (c.puerto as number) < 65536)) {
      throw new Error(`${pos} (${c.nombre}): tcp necesita un «puerto» válido (1–65535).`)
    }
    return c as unknown as Verificacion
  })
}

async function medir<T>(fn: () => Promise<T>): Promise<{ ms: number; valor: T }> {
  const t0 = performance.now()
  const valor = await fn()
  return { ms: Math.round(performance.now() - t0), valor }
}

async function probarHttp(v: Verificacion): Promise<string> {
  const r = await fetch(v.destino, { signal: AbortSignal.timeout(v.timeoutMs ?? TIMEOUT), redirect: 'follow' })
  const aceptados = v.codigos?.length ? v.codigos : null
  const ok = aceptados ? aceptados.includes(r.status) : r.status >= 200 && r.status < 400
  if (!ok) throw new Error(`HTTP ${r.status}`)
  if (v.contiene) {
    const texto = await r.text()
    if (!texto.includes(v.contiene)) throw new Error(`HTTP ${r.status}, pero no aparece «${v.contiene}»`)
  } else {
    await r.body?.cancel()
  }
  return `HTTP ${r.status}`
}

function probarTcp(v: Verificacion): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const socket = connect({ host: v.destino, port: v.puerto! })
    const fin = (error?: Error) => {
      socket.destroy()
      if (error) rechazar(error)
      else resolver(`puerto ${v.puerto} abierto`)
    }
    socket.setTimeout(v.timeoutMs ?? TIMEOUT, () => fin(new Error('tiempo de espera agotado')))
    socket.once('connect', () => fin())
    socket.once('error', (e) => fin(e))
  })
}

async function probarDns(v: Verificacion): Promise<string> {
  const espera = new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('tiempo de espera agotado')), v.timeoutMs ?? TIMEOUT))
  const r = await Promise.race([lookup(v.destino, { all: true }), espera])
  return `resuelve a ${r.map((d) => d.address).join(', ')}`
}

const PRUEBAS: Record<Tipo, (v: Verificacion) => Promise<string>> = { http: probarHttp, tcp: probarTcp, dns: probarDns }

/** Ejecuta una verificación; si falla, reintenta una vez antes de marcarla como caída. */
export async function verificar(v: Verificacion, reintentos = 1): Promise<Resultado> {
  let ultimoError = ''
  for (let intento = 1; intento <= reintentos + 1; intento++) {
    try {
      const { ms, valor } = await medir(() => PRUEBAS[v.tipo](v))
      return {
        nombre: v.nombre,
        tipo: v.tipo,
        destino: v.tipo === 'tcp' ? `${v.destino}:${v.puerto}` : v.destino,
        estado: ms > (v.umbralMs ?? UMBRAL) ? 'lento' : 'arriba',
        latenciaMs: ms,
        detalle: valor,
        intentos: intento,
        fecha: new Date().toISOString(),
      }
    } catch (e) {
      const err = e as Error & { code?: string; cause?: { code?: string } }
      ultimoError = err.name === 'TimeoutError' ? 'tiempo de espera agotado' : err.cause?.code || err.code || err.message
    }
  }
  return {
    nombre: v.nombre,
    tipo: v.tipo,
    destino: v.tipo === 'tcp' ? `${v.destino}:${v.puerto}` : v.destino,
    estado: 'caido',
    latenciaMs: null,
    detalle: ultimoError,
    intentos: reintentos + 1,
    fecha: new Date().toISOString(),
  }
}

/** Corre todas las verificaciones en paralelo (con un máximo de simultáneas). */
export async function verificarTodas(lista: Verificacion[], simultaneas = 8, reintentos = 1): Promise<Resultado[]> {
  const resultados: Resultado[] = new Array(lista.length)
  let siguiente = 0
  async function trabajador() {
    while (siguiente < lista.length) {
      const i = siguiente++
      resultados[i] = await verificar(lista[i], reintentos)
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneas, lista.length) }, trabajador))
  return resultados
}

/** Disponibilidad y latencia promedio por verificación a partir del historial (una línea JSON por ejecución). */
export function estadisticas(historial: Resultado[][]) {
  const porNombre = new Map<string, Resultado[]>()
  for (const corrida of historial) for (const r of corrida) porNombre.set(r.nombre, [...(porNombre.get(r.nombre) ?? []), r])
  return [...porNombre.entries()].map(([nombre, rs]) => {
    const arriba = rs.filter((r) => r.estado !== 'caido')
    const latencias = arriba.map((r) => r.latenciaMs!).filter((n) => n != null)
    return {
      nombre,
      muestras: rs.length,
      disponibilidad: Math.round((arriba.length / rs.length) * 1000) / 10,
      latenciaPromedioMs: latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null,
    }
  })
}
