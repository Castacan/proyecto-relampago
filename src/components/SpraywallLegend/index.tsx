import { HOLD_ROLES, type HoldRole } from '../../lib/spraywall'

interface Props {
  interactive?: boolean
  activeRole?: HoldRole
  onSelectRole?: (role: HoldRole) => void
}

export default function SpraywallLegend({ interactive = false, activeRole, onSelectRole }: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      {HOLD_ROLES.map(r => {
        const isActive = activeRole === r.key
        const content = (
          <>
            <div
              className={`w-7 h-7 rounded-full border-[3px] transition-all duration-150 ${
                interactive && isActive ? 'scale-110 shadow-lg' : ''
              } ${interactive && !isActive ? 'group-hover:scale-105' : ''}`}
              style={{ borderColor: r.hex, backgroundColor: 'transparent' }}
            />
            <span className={`text-xs font-medium ${interactive && isActive ? 'text-white' : 'text-zinc-400'}`}>
              {r.label}
            </span>
          </>
        )
        return interactive ? (
          <button
            key={r.key}
            onClick={() => onSelectRole?.(r.key)}
            className="flex items-center gap-2 group cursor-pointer"
          >
            {content}
          </button>
        ) : (
          <div key={r.key} className="flex items-center gap-2">
            {content}
          </div>
        )
      })}
    </div>
  )
}
