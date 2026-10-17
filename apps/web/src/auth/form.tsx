import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export function TextField({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-xs text-ink-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PrimaryButton({
  children,
  ...button
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
      {...button}
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
      {message}
    </p>
  );
}

export function Card({
  title,
  subtitle,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <section
        className={`flex w-full ${wide ? 'max-w-xl' : 'max-w-sm'} flex-col gap-5 rounded-xl border border-line bg-surface p-6 shadow-sm`}
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </header>
        {children}
      </section>
    </main>
  );
}
