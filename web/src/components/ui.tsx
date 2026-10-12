import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { IconBack, IconChart, IconDrop, IconGear, Logo } from './icons';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------- Boutons

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' };

const BUTTON_STYLE = {
  primary:
    'bg-teal-700 text-white shadow-sm hover:bg-teal-800 dark:bg-teal-400 dark:text-slate-950 dark:hover:bg-teal-300',
  secondary:
    'border-2 border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  ghost: 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800',
};

/** Gros bouton pleine largeur (zone tactile ≥ 64 px). */
export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-5 text-lg font-semibold transition',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:focus-visible:outline-teal-300',
        BUTTON_STYLE[variant],
        className,
      )}
      {...rest}
    />
  );
}

/** Choix à sélection unique (poids, salissure, durée…). */
export function Chip({
  selected,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'flex min-h-16 items-center justify-center rounded-2xl border-2 px-3 text-lg font-semibold transition',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:focus-visible:outline-teal-300',
        selected
          ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
          : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600',
        className,
      )}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------- Mise en page

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {children}
    </div>
  );
}

export const Muted = ({ className, children }: { className?: string; children: ReactNode }) => (
  <p className={cx('text-sm text-slate-600 dark:text-slate-400', className)}>{children}</p>
);

/** La promesse de l'app, rappelée en bas de chaque écran. */
export function Tagline() {
  return (
    <p className="flex items-center justify-center gap-2 py-4 text-center text-sm font-medium text-teal-800 dark:text-teal-300">
      <IconDrop width={16} height={16} />
      Moins de gaspillage, plus d'économies.
    </p>
  );
}

export function Screen({ children, withTabs }: { children: ReactNode; withTabs?: boolean }) {
  return (
    <main
      className={cx(
        'mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))]',
        withTabs ? 'pb-28' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
      )}
    >
      {children}
    </main>
  );
}

export function Header({
  title,
  subtitle,
  onBack,
  brand,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  brand?: boolean;
}) {
  return (
    <header className="mb-5 flex flex-col gap-2">
      <div className="flex min-h-12 items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="-ml-2 flex size-12 items-center justify-center rounded-full text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <IconBack />
          </button>
        )}
        {brand && (
          <>
            <Logo />
            <span className="text-lg font-bold tracking-tight text-teal-800 dark:text-teal-300">JusteDose</span>
          </>
        )}
      </div>
      <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance">{title}</h1>
      {subtitle && <Muted className="text-base">{subtitle}</Muted>}
    </header>
  );
}

// ---------------------------------------------------------------- Navigation

export type TabRoute = 'home' | 'stats' | 'settings';

const TABS: Array<{ route: TabRoute; label: string; icon: typeof IconDrop }> = [
  { route: 'home', label: 'Laver', icon: IconDrop },
  { route: 'stats', label: 'Économies', icon: IconChart },
  { route: 'settings', label: 'Réglages', icon: IconGear },
];

export function TabBar({ current, onNavigate }: { current: TabRoute; onNavigate: (r: TabRoute) => void }) {
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/90"
    >
      <div className="mx-auto grid max-w-md grid-cols-3">
        {TABS.map(({ route, label, icon: Icon }) => {
          const active = route === current;
          return (
            <button
              key={route}
              type="button"
              onClick={() => onNavigate(route)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition',
                active ? 'text-teal-700 dark:text-teal-300' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              <Icon width={26} height={26} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
