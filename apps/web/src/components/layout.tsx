import {
  Anchor,
  AppShell,
  Button,
  Container,
  Group,
  Text,
  Title,
} from '@mantine/core';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { DISCORD_URL, PLAY_URL } from '../links.js';
import { Link, useNavigation } from '../router.js';
import { isGuest, useSession } from '../session.js';
import { PlayerAvatar } from './avatar.js';

/** Boards stays lit on a board and a build card, which are its pages. */
const sectionOf = (pathname: string): string =>
  pathname === '/boards' ||
  pathname.startsWith('/boards/') ||
  pathname.startsWith('/builds/')
    ? '/boards'
    : pathname;

const NavLink = ({
  to,
  children,
  label,
}: {
  to: string;
  children: ReactNode;
  label?: string;
}) => {
  const { location } = useNavigation();
  const active =
    to === '/boards'
      ? sectionOf(location.pathname) === '/boards'
      : location.pathname.startsWith(to);
  return (
    <Button
      component={Link}
      to={to}
      size="compact-md"
      radius="xl"
      variant={active ? 'filled' : 'subtle'}
      color={active ? 'gold' : 'gray'}
      className={active ? 'nav-link active' : 'nav-link'}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
    >
      {children}
    </Button>
  );
};

/** The signed-in player in the bar: their picture, and their name from `sm` up. */
const AccountLink = () => {
  const { profile } = useSession();
  if (profile === null) return <NavLink to="/account">Account</NavLink>;
  return (
    <NavLink to="/account" label={`Account: ${profile.displayName}`}>
      <Group gap={8} wrap="nowrap" className="account-link">
        <PlayerAvatar avatar={profile.avatar} size={24} />
        <Text span inherit visibleFrom="sm" maw={140} truncate>
          {profile.displayName}
        </Text>
      </Group>
    </NavLink>
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
    <AppShell header={{ height: 60 }} padding={0}>
      <AppShell.Header
        style={{
          background: 'rgba(12, 10, 13, 0.86)',
          backdropFilter: 'blur(8px)',
          borderColor: 'var(--edge)',
        }}
      >
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Link to="/" className="brand" aria-label="Gravoth, home">
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-name">Gravoth</span>
            </Link>
            <Group gap={4} wrap="nowrap" component="nav" aria-label="Main">
              <NavLink to="/boards">Boards</NavLink>
              {session !== null &&
              session !== undefined &&
              !isGuest(session) ? (
                <NavLink to="/friends">Friends</NavLink>
              ) : null}
              {session === undefined ? null : session === null ? (
                <NavLink to="/sign-in">Sign in</NavLink>
              ) : (
                <AccountLink />
              )}
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg" py="xl" component="main">
          {children}
        </Container>
        <Container size="lg" pb="xl" component="footer">
          <Group
            gap="md"
            justify="center"
            pt="lg"
            style={{ borderTop: '1px solid var(--edge)' }}
          >
            <Text size="sm" c="dimmed">
              Gravoth is made by one independent developer
            </Text>
            <Anchor size="sm" c="dimmed" href={PLAY_URL}>
              Google Play
            </Anchor>
            <Anchor size="sm" c="dimmed" href={DISCORD_URL}>
              Discord
            </Anchor>
            <Anchor size="sm" c="dimmed" href="/privacy/">
              Privacy policy
            </Anchor>
            <Anchor size="sm" c="dimmed" href="/terms/">
              Terms of service
            </Anchor>
            <Anchor size="sm" c="dimmed" component={Link} to="/delete-account">
              Delete your account
            </Anchor>
            {version === null ? null : (
              <Text size="xs" c="dimmed">
                server {version}
              </Text>
            )}
          </Group>
        </Container>
      </AppShell.Main>
    </AppShell>
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
    document.title = title === 'Gravoth' ? title : `${title} · Gravoth`;
  }, [title]);
  return (
    <Group justify="space-between" align="flex-end" mb="lg" gap="md">
      <div>
        <Title order={1}>{title}</Title>
        {sub === undefined ? null : (
          <Text
            c="dimmed"
            mt={6}
            maw="62ch"
            component="div"
            className="page-sub"
          >
            {sub}
          </Text>
        )}
      </div>
      {children}
    </Group>
  );
};
