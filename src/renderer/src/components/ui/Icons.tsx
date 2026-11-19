import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
  color?: string
}

function Svg({
  size,
  color = 'currentColor',
  strokeWidth = 2,
  round = true,
  children
}: IconProps & { strokeWidth?: number; round?: boolean; children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin={round ? 'round' : undefined}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function TerminalIcon({ size = 22, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </Svg>
  )
}

export function BranchIcon({ size = 14, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color} round={false}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 4-6 3-11 6" />
    </Svg>
  )
}

export function WarningIcon({ size = 16, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <path d="M12 3l10 18H2z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17.5" x2="12" y2="17.6" />
    </Svg>
  )
}

export function ChevronDownIcon({ size = 12, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  )
}

export function ChevronLeftIcon({ size = 16, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <polyline points="15 18 9 12 15 6" />
    </Svg>
  )
}

export function FolderIcon({ size = 18, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  )
}

export function RefreshIcon({ size = 14, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </Svg>
  )
}

export function LockIcon({ size = 14, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  )
}

export function CheckIcon({ size = 12, color }: IconProps): JSX.Element {
  return (
    <Svg size={size} color={color} strokeWidth={3}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  )
}
