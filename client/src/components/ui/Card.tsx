import React from 'react';

/**
 * The card and its header.
 *
 * Every panel in the app is this shape: a hairline box, a header that names it
 * in one short line, an optional single action on the right. The previous
 * dashboard invented a different header for each panel — bold, semibold,
 * different sizes, some with subtitles, some without — which is most of why it
 * read as a template rather than a product.
 */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Removes the default padding, for cards whose content runs edge to edge. */
  flush?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, flush, className = '', ...rest }) => (
  <section className={`surface ${flush ? '' : 'p-5'} ${className}`} {...rest}>
    {children}
  </section>
);

interface CardHeaderProps {
  title: string;
  /** One clause of context. If it needs two, the panel is doing too much. */
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, hint, action, className = '' }) => (
  <header className={`flex items-start justify-between gap-4 ${className}`}>
    <div className="min-w-0">
      <h2 className="text-title font-semibold text-ink-900">{title}</h2>
      {hint && <p className="text-caption text-ink-400 mt-0.5">{hint}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </header>
);

/**
 * The hairline that separates rows inside a card. A border on the row itself
 * leaves a stray line at the end of the list; this never does.
 */
export const Rows: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <ul className={`divide-y divide-paper-300 ${className}`}>{children}</ul>;

/**
 * What a panel says when it has nothing to show. Never a spinner left running,
 * and never a blank rectangle — an empty collection list is *good news* on this
 * dashboard, and it should read that way.
 */
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}> = ({ icon, title, body, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-10 px-6">
    {icon && <div className="text-ink-400 mb-3">{icon}</div>}
    <p className="text-body font-medium text-ink-700">{title}</p>
    {body && <p className="text-caption text-ink-400 mt-1 max-w-xs">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Placeholder block used while a panel's data is still in flight. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-paper-200 ${className}`} />
);
