import React from 'react';

interface EmptyStateProps {
  className?: string;
}

/** Map pin/cursor illustration for "no neighborhood selected" */
export const MapPinIllustration: React.FC<EmptyStateProps> = ({ className = '' }) => (
  <svg
    className={className}
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Map pin */}
    <path
      d="M32 8C23.16 8 16 15.16 16 24c0 12 16 32 16 32s16-20 16-32c0-8.84-7.16-16-16-16z"
      className="fill-primary-200 dark:fill-primary-800/50"
    />
    <circle cx="32" cy="24" r="6" className="fill-primary-400 dark:fill-primary-500" />
    {/* Cursor arrow */}
    <path
      d="M44 38l4-1.5 8 8-3.5 3.5-8-8 1.5-4z"
      className="fill-surface-400 dark:fill-surface-500"
    />
    <path
      d="M38 32l12 4-4 1.5-4 4-1.5-4L38 32z"
      className="fill-surface-300 dark:fill-surface-600"
    />
  </svg>
);

/** Side-by-side comparison illustration */
export const CompareIllustration: React.FC<EmptyStateProps> = ({ className = '' }) => (
  <svg
    className={className}
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Left card */}
    <rect x="6" y="14" width="22" height="36" rx="3" className="fill-primary-100 dark:fill-primary-900/40 stroke-primary-300 dark:stroke-primary-700" strokeWidth="1.5" />
    <rect x="10" y="20" width="14" height="3" rx="1.5" className="fill-primary-300 dark:fill-primary-600" />
    <rect x="10" y="26" width="10" height="2" rx="1" className="fill-surface-200 dark:fill-surface-700" />
    <rect x="10" y="31" width="12" height="2" rx="1" className="fill-surface-200 dark:fill-surface-700" />
    <rect x="10" y="36" width="8" height="2" rx="1" className="fill-surface-200 dark:fill-surface-700" />
    {/* Right card */}
    <rect x="36" y="14" width="22" height="36" rx="3" className="fill-primary-100 dark:fill-primary-900/40 stroke-primary-300 dark:stroke-primary-700" strokeWidth="1.5" />
    <rect x="40" y="20" width="14" height="3" rx="1.5" className="fill-primary-300 dark:fill-primary-600" />
    <rect x="40" y="26" width="10" height="2" rx="1" className="fill-surface-200 dark:fill-surface-700" />
    <rect x="40" y="31" width="12" height="2" rx="1" className="fill-surface-200 dark:fill-surface-700" />
    <rect x="40" y="36" width="8" height="2" rx="1" className="fill-surface-200 dark:fill-surface-700" />
    {/* Arrows between cards */}
    <path d="M30 28h4M30 34h4" className="stroke-surface-300 dark:stroke-surface-600" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** Funnel/filter illustration for "no filter results" */
export const FilterEmptyIllustration: React.FC<EmptyStateProps> = ({ className = '' }) => (
  <svg
    className={className}
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Funnel */}
    <path
      d="M12 16h40l-14 18v12l-8 4V34L12 16z"
      className="fill-surface-100 dark:fill-surface-800 stroke-surface-300 dark:stroke-surface-600"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* X mark */}
    <circle cx="48" cy="48" r="10" className="fill-amber-100 dark:fill-amber-900/40" />
    <path
      d="M44 44l8 8M52 44l-8 8"
      className="stroke-amber-500 dark:stroke-amber-400"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/** Star/bookmark illustration for "no favorites" */
export const FavoritesEmptyIllustration: React.FC<EmptyStateProps> = ({ className = '' }) => (
  <svg
    className={className}
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Star outline */}
    <path
      d="M32 10l6.18 12.52L52 24.48l-10 9.74 2.36 13.78L32 41.26 19.64 48l2.36-13.78-10-9.74 13.82-1.96L32 10z"
      className="fill-amber-100 dark:fill-amber-900/30 stroke-amber-300 dark:stroke-amber-600"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* Dashed circle around it */}
    <circle
      cx="32"
      cy="32"
      r="28"
      className="stroke-surface-200 dark:stroke-surface-700"
      strokeWidth="1.5"
      strokeDasharray="4 4"
      fill="none"
    />
  </svg>
);
