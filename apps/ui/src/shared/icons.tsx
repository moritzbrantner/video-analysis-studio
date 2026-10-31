import { classNames } from "./utils";

export function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6.5 4.9v10.2c0 .6.7 1 1.2.6l7.4-5.1c.4-.3.4-.9 0-1.2L7.7 4.3c-.5-.4-1.2 0-1.2.6Z" />
    </svg>
  );
}

export function WorkflowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <circle cx="5" cy="5.5" r="2" />
      <circle cx="15" cy="5.5" r="2" />
      <circle cx="10" cy="14.5" r="2" />
      <path d="M7 5.5h6" strokeLinecap="round" />
      <path d="m6.3 7.2 2.6 5.1" strokeLinecap="round" />
      <path d="m13.7 7.2-2.6 5.1" strokeLinecap="round" />
    </svg>
  );
}

export function ComponentsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="5.5" height="5.5" rx="1.2" />
      <rect x="11" y="4" width="5.5" height="5.5" rx="1.2" />
      <rect x="7.25" y="10.5" width="5.5" height="5.5" rx="1.2" />
      <path d="M9 6.75h2" strokeLinecap="round" />
      <path d="m10 9.5.25 1" strokeLinecap="round" />
      <path d="m11 10.5 1.75-1" strokeLinecap="round" />
    </svg>
  );
}

export function RunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M5 4.5v11l9-5.5-9-5.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 5v10" strokeLinecap="round" />
    </svg>
  );
}

export function DataSourceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <ellipse cx="10" cy="5" rx="5.8" ry="2.5" />
      <path d="M4.2 5v9.2c0 1.4 2.6 2.5 5.8 2.5s5.8-1.1 5.8-2.5V5" />
      <path d="M4.2 9.2c0 1.4 2.6 2.5 5.8 2.5s5.8-1.1 5.8-2.5" />
    </svg>
  );
}

export function TypeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M4 5h12" strokeLinecap="round" />
      <path d="M7 5v10" strokeLinecap="round" />
      <path d="M13 5v10" strokeLinecap="round" />
      <path d="M5 15h4" strokeLinecap="round" />
      <path d="M11 15h4" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 7.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />
      <path
        d="M15.6 11.4c.1-.5.1-.9 0-1.4l1.5-1.1-1.5-2.6-1.8.7a6 6 0 0 0-1.2-.7L12.4 4H7.6l-.3 2.3c-.4.2-.8.4-1.2.7l-1.8-.7-1.5 2.6L4.4 10a5.6 5.6 0 0 0 0 1.4l-1.5 1.1 1.5 2.6 1.8-.7c.4.3.8.5 1.2.7l.3 2.3h4.8l.3-2.3c.4-.2.8-.4 1.2-.7l1.8.7 1.5-2.6-1.7-1.1Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M16 6v4h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.1 10A5.5 5.5 0 1 1 13.7 6.3L16 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 3v9" strokeLinecap="round" />
      <path d="m6.5 8.5 3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15.5h12" strokeLinecap="round" />
    </svg>
  );
}

export function OpenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M7.5 4.5H4.8c-.7 0-1.3.6-1.3 1.3v9.4c0 .7.6 1.3 1.3 1.3h9.4c.7 0 1.3-.6 1.3-1.3v-2.7" strokeLinecap="round" />
      <path d="M11 3.5h5.5V9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9 11 7-7" strokeLinecap="round" />
    </svg>
  );
}

export function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 17V8" strokeLinecap="round" />
      <path d="m6.5 11.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4.5h12" strokeLinecap="round" />
    </svg>
  );
}

export function ArrangeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="5" height="4" rx="1" />
      <rect x="11.5" y="3.5" width="5" height="4" rx="1" />
      <rect x="7.5" y="12" width="5" height="4" rx="1" />
      <path d="M8.5 6h3" strokeLinecap="round" />
      <path d="m10 8v4" strokeLinecap="round" />
      <path d="m13.5 7.5-2 4.5" strokeLinecap="round" />
    </svg>
  );
}

export function SaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M5 3.5h8l2 2v11H5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 3.5v4h5v-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13.5h5" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 4.5v11" strokeLinecap="round" />
      <path d="M4.5 10h11" strokeLinecap="round" />
    </svg>
  );
}

export function CloneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="7" y="6.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M4.5 12.5V5.8c0-.7.6-1.3 1.3-1.3h6.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GroupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="10.5" width="5" height="5" rx="1" />
      <path d="M8.5 7h3" strokeLinecap="round" />
      <path d="M8.5 12.5h3" strokeLinecap="round" />
    </svg>
  );
}

export function UngroupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="10.5" width="5" height="5" rx="1" />
      <path d="M9.5 7h2" strokeLinecap="round" />
      <path d="M8.5 12.5h2" strokeLinecap="round" />
      <path d="M10.5 5.5 13 3" strokeLinecap="round" />
      <path d="m10.5 14.5 2.5 2.5" strokeLinecap="round" />
    </svg>
  );
}

export function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="12" height="10" rx="1.5" />
      <path d="M7 10h6" strokeLinecap="round" />
    </svg>
  );
}

export function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="12" height="10" rx="1.5" />
      <path d="M7 8h6" strokeLinecap="round" />
      <path d="M7 12h6" strokeLinecap="round" />
    </svg>
  );
}

export function PanelCollapseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M8 4v12" strokeLinecap="round" />
      <path d="m13 7-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PanelExpandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M8 4v12" strokeLinecap="round" />
      <path d="m10.5 7 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="m5.5 12 4.5-4 4.5 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="m5.5 8 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="m5 5 10 10" strokeLinecap="round" />
      <path d="m15 5-10 10" strokeLinecap="round" />
    </svg>
  );
}

export function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={classNames("animate-spin", className)}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
