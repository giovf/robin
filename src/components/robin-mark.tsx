/** The Robin wordmark: a small red-breasted bird and the product name. */
export function RobinMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`text-ink inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-6 shrink-0"
        fill="none"
      >
        <path
          d="M4 13.5C4 8.8 7.8 5 12.5 5c2 0 3.6.6 4.9 1.7L21 6l-1.6 3.1c.4 1 .6 2 .6 3.1 0 4.3-3.5 7.8-7.8 7.8H9.5C6.5 20 4 17.2 4 13.5Z"
          className="fill-ink"
        />
        <path
          d="M8 14.2c0-2.6 2.1-4.7 4.7-4.7 1.3 0 2.5.5 3.3 1.4-.2 3.9-2.6 6.6-5.6 6.6C9 17.5 8 16.1 8 14.2Z"
          className="fill-accent"
        />
        <circle cx="15.6" cy="8.6" r="0.9" className="fill-surface" />
      </svg>
      Robin
    </span>
  );
}
