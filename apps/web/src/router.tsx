import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/**
 * A small history router: the site has six pages, so a pattern table and
 * `pushState` are the whole of it. Patterns are `/boards/:key`; a param is one
 * path segment.
 */
export interface Route {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
}

export const matchPath = (
  pattern: string,
  path: string,
): Record<string, string> | null => {
  const want = pattern.split('/').filter((part) => part !== '');
  const have = path.split('/').filter((part) => part !== '');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i] ?? '';
    const value = have[i] ?? '';
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (part !== value) return null;
  }
  return params;
};

interface Navigation {
  readonly location: { readonly pathname: string; readonly search: string };
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

const current = () => ({
  pathname: window.location.pathname,
  search: window.location.search,
});

export const Router = ({ children }: { children: ReactNode }) => {
  const [location, setLocation] = useState(current);

  useEffect(() => {
    const onPop = () => setLocation(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (to: string, options: { replace?: boolean } = {}) => {
      if (options.replace === true) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
      setLocation(current());
      window.scrollTo({ top: 0 });
    },
    [],
  );

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): Navigation => {
  const value = useContext(NavigationContext);
  if (value === null) throw new Error('useNavigation outside <Router>');
  return value;
};

export const useQuery = (): URLSearchParams => {
  const { location } = useNavigation();
  return useMemo(() => new URLSearchParams(location.search), [location.search]);
};

export interface RouteDefinition {
  readonly pattern: string;
  readonly render: (params: Readonly<Record<string, string>>) => ReactNode;
}

export const Routes = ({
  routes,
  fallback,
}: {
  routes: readonly RouteDefinition[];
  fallback: ReactNode;
}) => {
  const { location } = useNavigation();
  for (const route of routes) {
    const params = matchPath(route.pattern, location.pathname);
    if (params !== null) return <>{route.render(params)}</>;
  }
  return <>{fallback}</>;
};

/** An `<a>` that navigates in place; a modified click (new tab) is the browser's. */
export const Link = ({
  to,
  children,
  ...rest
}: { to: string; children: ReactNode } & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) => {
  const { navigate } = useNavigation();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === '_blank'
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return (
    <a {...rest} href={to} onClick={onClick}>
      {children}
    </a>
  );
};
