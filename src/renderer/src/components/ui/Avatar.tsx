import './ui.css'

export interface AvatarProps {
  initials: string
  color: string
  size?: 30 | 40
  shape?: 'rounded' | 'circle'
  label?: string
}

export function Avatar({ initials, color, size = 30, shape = 'rounded', label }: AvatarProps): JSX.Element {
  const radius = shape === 'circle' ? '50%' : size === 40 ? 10 : 8
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <span
      className="ac-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color,
        fontSize: size === 40 ? 14 : 12
      }}
      {...a11y}
    >
      {initials}
    </span>
  )
}
