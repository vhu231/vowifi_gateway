import React from 'react'

const PATHS = {
  dashboard: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
  phone: 'M6.6 10.8c1.4 2.7 3.9 5.2 6.6 6.6l2.2-2.2a1 1 0 011-.24c1.1.37 2.3.57 3.5.57a1 1 0 011 1V20a1 1 0 01-1 1C11.4 21 3 12.6 3 2a1 1 0 011-1h3.5a1 1 0 011 1c0 1.2.2 2.4.57 3.5a1 1 0 01-.24 1L6.6 10.8z',
  mail: 'M3 6.5A2.5 2.5 0 015.5 4h13A2.5 2.5 0 0121 6.5v11A2.5 2.5 0 0118.5 20h-13A2.5 2.5 0 013 17.5v-11zm2 .3l7 4.7 7-4.7V6.5L12 11 5 6.5v.3z',
  sim: 'M7 3h7l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zm2 8h6v2H9v-2zm0 4h6v2H9v-2z',
  chip: 'M9 3v3H7a2 2 0 00-2 2v2H3v2h2v2H3v2h2v2a2 2 0 002 2h2v3h2v-3h2v3h2v-3h2a2 2 0 002-2v-2h2v-2h-2v-2h2V10h-2V8a2 2 0 00-2-2h-2V3h-2v3h-2V3H9zm0 7h6v4H9v-4z',
  settings: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM4.5 13l-1.2-.7.8-2 1.4.2a7.5 7.5 0 011.1-1.1L6.4 7l2-.8.7 1.2c.36-.1.74-.18 1.13-.22L10.5 5h3l.3 2.18c.39.04.77.12 1.13.22L15.6 6.2l2 .8-.2 1.4c.42.34.8.72 1.1 1.1l1.4-.2.8 2-1.2.7c.05.4.07.8.07 1.2s-.02.8-.07 1.2l1.2.7-.8 2-1.4-.2a7.5 7.5 0 01-1.1 1.1l.2 1.4-2 .8-.7-1.2c-.36.1-.74.18-1.13.22L13.5 21h-3l-.3-2.18a7.6 7.6 0 01-1.13-.22L8.4 19.8l-2-.8.2-1.4a7.5 7.5 0 01-1.1-1.1l-1.4.2-.8-2 1.2-.7A7.7 7.7 0 014.5 13z',
  logs: 'M5 4h14v2H5V4zm0 5h14v2H5V9zm0 5h10v2H5v-2z',
  menu: 'M4 7h16v2H4V7zm0 5h16v2H4v-2zm0 5h16v2H4v-2z',
  close: 'M6.7 5.3L12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4L10.6 12 5.3 6.7l1.4-1.4z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z',
  sun: 'M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6L4.2 4.2m15.6 15.6l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M20 14.5A7.5 7.5 0 119.5 4 6.5 6.5 0 0020 14.5z',
  /* Half-disk theme: circle outline + vertical diameter */
  auto: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 3v18',
  back: 'M14 6l-6 6 6 6',
  check: 'M5 12l4 4L19 6',
  alert: 'M12 8v5m0 3h.01M10.3 4.2l-7.5 13A2 2 0 004.5 20h15a2 2 0 001.7-2.8l-7.5-13a2 2 0 00-3.4 0z',
  call: 'M12 5c-2 0-4 2.2-4 5v2l-1.5 2.5h11L16 12v-2c0-2.8-2-5-4-5zm-2 12a2 2 0 004 0',
  answer: 'M6.6 10.8c1.4 2.7 3.9 5.2 6.6 6.6l2.2-2.2a1 1 0 011-.24c1.1.37 2.3.57 3.5.57a1 1 0 011 1V20a1 1 0 01-1 1C11.4 21 3 12.6 3 2a1 1 0 011-1h3.5a1 1 0 011 1c0 1.2.2 2.4.57 3.5a1 1 0 01-.24 1L6.6 10.8z',
  decline: 'M6 6l12 12M18 6L6 18',
  mute: 'M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3zM7 11a5 5 0 0010 0M12 18v3M5 5l14 14',
  mic: 'M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3zM7 11a5 5 0 0010 0M12 18v3',
  keypad: 'M7 6h2v2H7V6zm4 0h2v2h-2V6zm4 0h2v2h-2V6zM7 10h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zM7 14h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z',
  record: 'M12 7a5 5 0 100 10 5 5 0 000-10z',
  chevronLeft: 'M14 6l-6 6 6 6',
}

export default function Icon({ name, size = 18, label, className = '', ...rest }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      {...rest}
    >
      <path d={d} />
    </svg>
  )
}
