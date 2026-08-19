// Extraído del botón-checkbox inline de MyAccountPage.tsx ("Aparecer en el
// leaderboard") — primera extracción de este patrón a componente compartido,
// reusado en SponsorForm y SlideForm (is_active).
interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}

export default function Toggle({ checked, onChange, label, description }: Props) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-superficie-alta border border-zinc-700/50 text-left hover:bg-superficie-alta-hover transition-all"
    >
      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked ? 'bg-primario border-primario' : 'border-zinc-600'}`}>
        {checked && <span className="text-texto-en-acento text-xs font-black">✓</span>}
      </div>
      <div>
        <p className="text-texto-principal text-sm font-semibold">{label}</p>
        {description && <p className="text-zinc-500 text-xs">{description}</p>}
      </div>
    </button>
  )
}
