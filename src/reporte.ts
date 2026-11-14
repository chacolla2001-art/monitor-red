// Formatos de salida: tabla de consola, Markdown y página HTML de estado.
import type { Resultado } from './monitor.ts'
import type { estadisticas } from './monitor.ts'

type Estadistica = ReturnType<typeof estadisticas>[number]

const ICONO = { arriba: '🟢', lento: '🟡', caido: '🔴' } as const
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function tabla(rs: Resultado[]): string {
  const filas = rs.map((r) => [`${ICONO[r.estado]} ${r.estado}`, r.nombre, r.tipo, r.destino, r.latenciaMs == null ? '—' : `${r.latenciaMs} ms`, r.detalle])
  const titulos = ['Estado', 'Nombre', 'Tipo', 'Destino', 'Latencia', 'Detalle']
  const anchos = titulos.map((t, i) => Math.max(t.length, ...filas.map((f) => f[i].length)))
  const linea = (f: string[]) => f.map((c, i) => c.padEnd(anchos[i])).join('  ')
  return [linea(titulos), anchos.map((a) => '-'.repeat(a)).join('  '), ...filas.map(linea)].join('\n')
}

export function resumen(rs: Resultado[]): string {
  const n = (e: Resultado['estado']) => rs.filter((r) => r.estado === e).length
  return `${rs.length} verificaciones: ${n('arriba')} arriba, ${n('lento')} lentas, ${n('caido')} caídas.`
}

export function markdown(rs: Resultado[], stats: Estadistica[] = []): string {
  const disp = new Map(stats.map((s) => [s.nombre, s]))
  const filas = rs.map((r) => {
    const s = disp.get(r.nombre)
    return `| ${ICONO[r.estado]} | ${r.nombre} | ${r.tipo} | \`${r.destino}\` | ${r.latenciaMs ?? '—'} | ${s ? `${s.disponibilidad}%` : '—'} | ${r.detalle} |`
  })
  return [
    `# Estado de servicios`,
    ``,
    `${resumen(rs)} Última revisión: ${new Date().toISOString()}`,
    ``,
    `| | Nombre | Tipo | Destino | Latencia (ms) | Disponibilidad | Detalle |`,
    `|---|---|---|---|---|---|---|`,
    ...filas,
  ].join('\n')
}

export function html(rs: Resultado[], stats: Estadistica[] = []): string {
  const disp = new Map(stats.map((s) => [s.nombre, s]))
  const tarjetas = rs
    .map((r) => {
      const s = disp.get(r.nombre)
      return `<article class="${r.estado}"><h2>${ICONO[r.estado]} ${esc(r.nombre)}</h2><p><code>${esc(r.destino)}</code> · ${r.tipo}</p>
<p><b>${r.latenciaMs == null ? 'sin respuesta' : `${r.latenciaMs} ms`}</b> · ${esc(r.detalle)}</p>${s ? `<p>Disponibilidad: <b>${s.disponibilidad}%</b> en ${s.muestras} revisiones</p>` : ''}</article>`
    })
    .join('\n')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Estado de servicios</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f4f6fb;color:#1d2333}main{max-width:900px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}article{background:#fff;border-radius:12px;padding:14px;border-left:6px solid #1d7a46}
article.lento{border-color:#b26a00}article.caido{border-color:#c62828}h2{font-size:1rem;margin:0 0 6px}p{margin:4px 0}code{font-size:.85em}</style></head>
<body><main><h1>Estado de servicios</h1><p>${esc(resumen(rs))} Revisado: ${new Date().toLocaleString('es')}</p><div class="grid">${tarjetas}</div></main></body></html>`
}
