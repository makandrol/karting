/**
 * Standard loading / error / empty state components.
 *
 * Replaces 15+ inline `<div className="card text-center py-12 text-dark-500">Завантаження...</div>`
 * patterns scattered across pages.
 */

import type { ReactNode } from 'react';

interface LoadingProps {
  /** Custom text. Default: "Завантаження..." */
  text?: string;
  /** Vertical padding scale. Default: 'lg'. */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to wrap in a card. Default: true. */
  card?: boolean;
}

const PAD = { sm: 'py-3', md: 'py-6', lg: 'py-12' } as const;

export function LoadingState({ text = 'Завантаження...', size = 'lg', card = true }: LoadingProps) {
  const inner = <div className={`text-center ${PAD[size]} text-dark-500 ${size === 'sm' ? 'text-[10px]' : 'text-sm'}`}>{text}</div>;
  return card ? <div className={`card text-center ${PAD[size]} text-dark-500`}>{text}</div> : inner;
}

interface ErrorProps {
  /** Error message. */
  text: string;
  /** Optional retry callback. */
  onRetry?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function ErrorState({ text, onRetry, size = 'lg' }: ErrorProps) {
  return (
    <div className={`card text-center ${PAD[size]} space-y-3`}>
      <div className="text-red-400 text-sm">{text}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-primary-400 hover:text-primary-300 text-xs px-3 py-1.5 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 transition-colors"
        >
          Спробувати ще
        </button>
      )}
    </div>
  );
}

interface EmptyProps {
  /** Heading. */
  title: string;
  /** Optional details. */
  description?: string;
  /** Optional emoji at top. */
  emoji?: string;
  /** Optional CTA element. */
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function EmptyState({ title, description, emoji, children, size = 'lg' }: EmptyProps) {
  return (
    <div className={`card text-center ${PAD[size]} space-y-3`}>
      {emoji && <div className="text-4xl">{emoji}</div>}
      <h3 className="text-white font-semibold">{title}</h3>
      {description && <p className="text-dark-400 text-sm max-w-md mx-auto">{description}</p>}
      {children}
    </div>
  );
}
