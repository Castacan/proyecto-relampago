import { Link } from 'react-router-dom'
import logoHorizontal from '../../assets/logo-horizontal.png'

// /competencia/reglamento — "¿Cómo se califica?": sistema de puntuación explicado fácil (pedido del dueño, 2026-11-06),
// para ser transparentes con los competidores. Debe coincidir con docs/competencia-reglas.md y con
// competition_route_results / competition_ranking (src/supabase/competencia_bloques.sql).
// NO revela el orden de dificultad de los bloques (eso solo lo sabe el staff).

const card = 'rounded-2xl bg-superficie border border-zinc-800 p-5'
const h2 = 'text-texto-principal font-black text-xl mb-3'
const p = 'text-zinc-300 text-[15px] leading-relaxed'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-primario text-texto-en-acento font-black text-sm flex items-center justify-center">{n}</span>
      <div className={`${p} pt-0.5`}>{children}</div>
    </li>
  )
}

function Example({ title, rows, total }: { title: string; rows: [string, string][]; total?: string }) {
  return (
    <div className="rounded-xl bg-fondo/60 border border-zinc-800 p-4">
      <p className="text-texto-principal font-bold text-sm mb-2">{title}</p>
      <div className="space-y-1">
        {rows.map(([a, b]) => (
          <div key={a} className="flex justify-between gap-3 text-sm">
            <span className="text-zinc-400">{a}</span>
            <span className="text-zinc-200 font-semibold tabular-nums shrink-0">{b}</span>
          </div>
        ))}
      </div>
      {total && (
        <div className="flex justify-between gap-3 mt-2 pt-2 border-t border-zinc-800 text-sm">
          <span className="text-zinc-300 font-bold">Total</span>
          <span className="text-primario font-black tabular-nums">{total}</span>
        </div>
      )}
    </div>
  )
}

export default function CompetitionRulesPage() {
  return (
    <div className="min-h-screen bg-fondo">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
        <img src={logoHorizontal} alt="Jaibamuro" className="h-5 w-auto" />
        <Link to="/competencia" className="text-primario text-xs font-bold hover:text-primario-hover transition-colors">
          Competencia
        </Link>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <div>
          <p className="text-primario font-black text-xs tracking-widest">JAM · JAIBAS AL MURO 2026</p>
          <h1 className="text-texto-principal font-black text-3xl leading-tight mt-1">¿Cómo se califica?</h1>
        </div>

        <section className={card}>
          <h2 className={h2}>Lo básico</h2>
          <ol className="space-y-3">
            <Step n={1}>Hay <b className="text-texto-principal">24 bloques numerados</b>. Intentas los que quieras durante tu horario.</Step>
            <Step n={2}>Cada bloque vale según su dificultad: <b className="text-texto-principal">el más fácil vale 1 y el más difícil vale 24</b>. Los números de los bloques están revueltos: el bloque #3 no vale 3.</Step>
            <Step n={3}><b className="text-texto-principal">Top</b> = el valor completo del bloque. <b className="text-texto-principal">Zona</b> = la mitad.</Step>
            <Step n={4}>Cada intento extra resta <b className="text-texto-principal">0.01</b>.</Step>
            <Step n={5}>Al final cuentan <b className="text-texto-principal">tus 5 bloques que más puntos te den</b>.</Step>
          </ol>
        </section>

        <section className={card}>
          <h2 className={h2}>Top y zona</h2>
          <div className="space-y-3">
            <p className={p}><b className="text-texto-principal">Top:</b> llegas a la presa final y la controlas con las dos manos durante 3 segundos. Te llevas el valor del bloque.</p>
            <p className={p}><b className="text-texto-principal">Zona:</b> llegas a la presa de zona marcada en el bloque, la controlas y progresas desde ella. Te llevas la mitad del valor (zona en un bloque que vale 9 = 4.5).</p>
            <p className={p}>Zona y top no se suman: en cada bloque te quedas con tu mejor resultado. Si hiciste zona y después top, te llevas el top.</p>
            <p className={p}>Cuando haces top en un bloque, <b className="text-texto-principal">ese bloque se cierra</b> para ti: ya no lo puedes volver a intentar.</p>
          </div>
        </section>

        <section className={card}>
          <h2 className={h2}>Los intentos</h2>
          <div className="space-y-3">
            <p className={p}>Cada vez que te subes al bloque y no haces top, es un intento que <b className="text-texto-principal">resta 0.01</b>. Así, quien lo saca en menos intentos queda arriba.</p>
            <ul className="space-y-2 text-[15px] text-zinc-300 list-disc pl-5">
              <li><b className="text-texto-principal">Flash</b> (top al primer intento): no resta nada.</li>
              <li><b className="text-texto-principal">Tu primera zona no resta</b> si el bloque se te queda en zona. Si vuelves a hacer zona o te caes antes, eso sí resta.</li>
              <li>Si en un intento haces zona y en otro haces top, te llevas el valor completo del top menos 0.01 por aquel intento de zona. Ejemplo en un bloque que vale 10: zona y luego top = 9.99; flash = 10.</li>
              <li>Solo restan los intentos de tus 5 bloques que cuentan. <b className="text-texto-principal">Probar bloques difíciles no te quita puntos</b> si no los sacas.</li>
            </ul>
          </div>
        </section>

        <section className={card}>
          <h2 className={h2}>Ejemplos</h2>
          <div className="space-y-3">
            <Example title="Un bloque que vale 10" rows={[
              ['Flash', '10.00'],
              ['Te caes 2 veces y luego top', '9.98'],
              ['Zona al primer intento (y ahí se queda)', '5.00'],
              ['Te caes, luego zona', '4.99'],
              ['Zona y luego top', '9.99'],
            ]} />
            <Example title="Tu total con tus 5 mejores bloques" rows={[
              ['Top en uno que vale 18 (2 intentos)', '17.99'],
              ['Flash en uno que vale 14', '14.00'],
              ['Zona en uno que vale 22', '11.00'],
              ['Top en uno que vale 9 (3 intentos)', '8.98'],
              ['Flash en uno que vale 7', '7.00'],
              ['6º bloque: flash en uno que vale 5', 'no suma'],
            ]} total="58.97" />
          </div>
        </section>

        <section className={card}>
          <h2 className={h2}>Tu categoría final</h2>
          <div className="space-y-3">
            <p className={p}>La categoría en la que te inscribiste es solo una referencia. Al final te acomodamos según <b className="text-texto-principal">el bloque más difícil en el que hiciste top</b>:</p>
            <ul className="space-y-2 text-[15px] text-zinc-300 list-disc pl-5">
              <li>Top en algún bloque <b className="text-texto-principal">avanzado</b> → compites en Avanzado.</li>
              <li>Top en algún bloque <b className="text-texto-principal">intermedio</b> → Intermedio.</li>
              <li>Solo tops en bloques básicos, o solo zonas → Básico.</li>
            </ul>
            <p className={p}>Puedes subir o bajar de categoría. Femenil y varonil van por separado. Cuáles bloques son de cada nivel lo sabe solo el staff.</p>
          </div>
        </section>

        <section className={card}>
          <h2 className={h2}>Si hay empate</h2>
          <p className={`${p} mb-3`}>Dentro de cada categoría, se revisa en este orden hasta que alguien quede arriba:</p>
          <ol className="space-y-3">
            <Step n={1}>Más <b className="text-texto-principal">puntos</b>, con decimales.</Step>
            <Step n={2}>El <b className="text-texto-principal">bloque más difícil</b> en el que hiciste top.</Step>
            <Step n={3}>Más <b className="text-texto-principal">flashes</b> en tus 5 bloques que cuentan.</Step>
            <Step n={4}>Tu <b className="text-texto-principal">6º mejor bloque</b>, luego el 7º, y así.</Step>
          </ol>
        </section>

        <section className={card}>
          <h2 className={h2}>Los jueces</h2>
          <div className="space-y-3">
            <p className={p}>Antes de cada intento dile tu <b className="text-texto-principal">número de participante</b> al juez. Él anota top, zona o caída al momento.</p>
            <p className={p}>Los resultados se dan a conocer en la premiación. Si tienes una duda sobre un intento, acláralo en ese momento con el juez o en recepción. La decisión de los jueces es final.</p>
          </div>
        </section>

        <section className={card}>
          <h2 className={h2}>La rifa</h2>
          <p className={p}>Cada bloque en el que hagas <b className="text-texto-principal">zona o top</b> te da <b className="text-texto-principal">1 boleto</b>, en cualquier bloque y de cualquier nivel. Mientras más bloques saques, más chances tienes. La rifa es al final, frente a todos.</p>
        </section>

        <p className="text-zinc-500 text-xs text-center pb-6">¿Dudas? Pregunta en recepción. ¡Mucha suerte!</p>
      </main>
    </div>
  )
}
