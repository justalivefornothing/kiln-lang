import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  }
}

export function FlameMark({ size = 22, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden {...rest}>
      <rect width="32" height="32" rx="7" fill="#1c1916" />
      <path
        d="M16 5c1.4 3.3 5.6 5.4 5.6 10.4 0 2-.9 3.4-2 4.3.2-2.4-1.2-4-3.6-5.4-.2 2.3-1.8 3.3-2.4 5.2-.5 1.6.1 3 1 3.9-3.3-.7-5.6-3.4-5.6-7.1C9 10.7 14.3 9 16 5z"
        fill="#ff7a1a"
      />
      <rect x="7" y="25" width="18" height="2.5" rx="1.25" fill="#9a8f83" />
    </svg>
  )
}

export function PlayIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StopIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function CheckIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

export function XIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function DashIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 12h12" />
    </svg>
  )
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function DownloadIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
    </svg>
  )
}

export function LinkIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </svg>
  )
}

export function TrashIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  )
}

export function BookIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19a2 2 0 0 1 2-2h13" />
    </svg>
  )
}

export function GithubIcon(p: IconProps) {
  return (
    <svg {...base(p)} strokeWidth={1.6}>
      <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
    </svg>
  )
}
