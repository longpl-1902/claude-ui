import type { ButtonHTMLAttributes } from 'react'
import './ui.css'

export type ButtonVariant =
  | 'secondary'
  | 'primary'
  | 'accent2'
  | 'warn'
  | 'danger'
  | 'ghost'
  | 'dashed'
  | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps): JSX.Element {
  const cls = ['ac-btn', `ac-btn--${variant}`, `ac-btn--${size}`, className].filter(Boolean).join(' ')
  return <button type={type} className={cls} {...rest} />
}
