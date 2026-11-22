import type { HeroClass, ShownVerdict } from '@gravoth/contracts';
import type { ReactNode } from 'react';
import type { ApiError } from '../api.js';
import { CLASS_NAMES, messageFor } from '../format.js';
import type { Load } from './use-load.js';

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="spinner" role="status" aria-live="polite">
    <span className="spinner-mark" aria-hidden="true" />
    {label}
  </div>
);

export const ErrorNote = ({ error, retry }: { error: ApiError; retry?: () => void }) => (
  <div className="note note-error" role="alert">
    <span>
      {error.status === 0
        ? "Can't reach the server. Check your connection."
        : messageFor(error.code)}
    </span>
    {retry === undefined ? null : (
      <button type="button" className="button button-quiet" onClick={retry}>
        Try again
      </button>
    )}
  </div>
);

/** The three states of a load, with the ready one rendered by `children`. */
export const Loaded = <T,>({
  load,
  retry,
  children,
}: {
  load: Load<T>;
  retry?: () => void;
  children: (value: T) => ReactNode;
}) => {
  if (load.state === 'loading') return <Spinner />;
  if (load.state === 'error') return <ErrorNote error={load.error} {...(retry === undefined ? {} : { retry })} />;
  return <>{children(load.value)}</>;
};

export const ClassBadge = ({ heroClass }: { heroClass: HeroClass }) => (
  <span className={`class-badge class-${heroClass}`}>{CLASS_NAMES[heroClass]}</span>
);

export const HardcoreBadge = () => (
  <span className="badge badge-hardcore" title="Hardcore: one life">
    HC
  </span>
);

export const VerdictBadge = ({ verdict }: { verdict: ShownVerdict }) =>
  verdict === 'verified' ? (
    <span className="badge badge-verified" title="Checked against the save by the rules checker">
      Verified
    </span>
  ) : (
    <span className="badge badge-pending" title="Not checked against a save yet">
      Pending
    </span>
  );

export const Panel = ({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`panel${className === undefined ? '' : ` ${className}`}`}>
    {title === undefined && actions === undefined ? null : (
      <header className="panel-head">
        {title === undefined ? <span /> : <h2>{title}</h2>}
        {actions}
      </header>
    )}
    {children}
  </section>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;
