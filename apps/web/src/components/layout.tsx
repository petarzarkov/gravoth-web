import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { Link, useNavigation } from '../router.js';
import { isGuest, useSession } from '../session.js';
import { PLAY_URL } from '../links.js';

/** Boards stays lit on a board and a build card, which are its pages. */
const sectionOf = (pathname: string): string =>
  pathname === '/boards' ||
  pathname.startsWith('/boards/') ||
  pathname.startsWith('/builds/')
    ? '/boards'
    : pathname;

const NavLink = ({ to, children }: { to: string; children: ReactNode }) => {
  const { location } = useNavigation();
  const active =
    to === '/boards'
      ? sectionOf(location.pathname) === '/boards'
      : location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={active ? 'nav-link active' : 'nav-link'}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
};

export const Layout = ({ children }: { children: ReactNode }) => {
  const { session } = useSession();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api
      .meta()
      .then((meta) => setVersion(`${meta.version} · ${meta.commit}`))
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <Link to="/" className="brand" aria-label="Gravoth, home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Gravoth</span>
          <span className="brand-sub">Online</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/boards">Boards</NavLink>
          {session !== null && session !== undefined && !isGuest(session) ? (
            <NavLink to="/friends">Friends</NavLink>
          ) : null}
          {session === undefined ? null : session === null ? (
            <NavLink to="/sign-in">Sign in</NavLink>
          ) : (
            <NavLink to="/account">Account</NavLink>
          )}
        </nav>
      </header>
      <main className="main">{children}</main>
      <footer className="foot">
        <span>Gravoth is made by one independent developer</span>
        <a href={PLAY_URL}>Google Play</a>
        <a href="/privacy/">Privacy policy</a>
        <Link to="/delete-account">Delete your account</Link>
        {version === null ? null : (
          <span className="foot-version">server {version}</span>
        )}
      </footer>
    </div>
  );
};

/** The page's heading, and the browser tab's title. */
export const PageTitle = ({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
}) => {
  useEffect(() => {
    document.title =
      title === 'Gravoth Online' ? title : `${title} · Gravoth Online`;
  }, [title]);
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {sub === undefined ? null : <p className="page-sub">{sub}</p>}
      </div>
      {children}
    </div>
  );
};
