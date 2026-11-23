import type { HeroClass, HeroPath, ShownVerdict } from '@gravoth/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Text,
  Title,
} from '@mantine/core';
import type { ReactNode } from 'react';
import type { ApiError } from '../api.js';
import { CLASS_NAMES, messageFor } from '../format.js';
import type { Load } from './use-load.js';

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <Group className="spinner" gap="sm" py="lg" role="status" aria-live="polite">
    <Loader size="sm" type="dots" />
    <Text c="dimmed">{label}</Text>
  </Group>
);

export const ErrorNote = ({
  error,
  retry,
}: {
  error: ApiError;
  retry?: () => void;
}) => (
  <Alert color="red" variant="light" role="alert">
    <Group justify="space-between" gap="sm">
      <Text size="sm">
        {error.status === 0
          ? "Can't reach the server. Check your connection."
          : messageFor(error.code)}
      </Text>
      {retry === undefined ? null : (
        <Button size="xs" variant="default" onClick={retry}>
          Try again
        </Button>
      )}
    </Group>
  </Alert>
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
  if (load.state === 'error')
    return (
      <ErrorNote
        error={load.error}
        {...(retry === undefined ? {} : { retry })}
      />
    );
  return <>{children(load.value)}</>;
};

/** Each class's colour, as the game tints its class badges. */
export const CLASS_COLOURS: Record<HeroClass, string> = {
  barbarian: '#ff8c6b',
  ranger: '#8fe07a',
  sorcerer: '#7fb2ff',
  templar: '#f2d27a',
};

export const ClassBadge = ({
  heroClass,
  size,
}: {
  heroClass: HeroClass;
  size?: 'xs' | 'sm';
}) => (
  <Badge
    className="class-badge"
    color={CLASS_COLOURS[heroClass]}
    {...(size === undefined ? {} : { size })}
  >
    {CLASS_NAMES[heroClass]}
  </Badge>
);

/** Decision 230: each talent path's colour (Might red, Cunning green, Sorcery blue, Void violet, Minion bone). */
export const PATH_COLOURS: Record<HeroPath, string> = {
  might: '#ff8c6b',
  cunning: '#8fe07a',
  sorcery: '#7fb2ff',
  void: '#c49bff',
  minion: '#d9d2b8',
};

/**
 * Decision 230: what a hero is, as the game says it: its talent title (Warrior, Skirmisher, an ascendancy's name) in its
 * path's colour, else (a hero the server has no title for yet) the old class.
 */
export const TitleBadge = ({
  hero,
  size,
}: {
  hero: {
    readonly class: HeroClass;
    readonly title?: string | null;
    readonly path?: HeroPath | null;
  };
  size?: 'xs' | 'sm';
}) =>
  hero.title === null || hero.title === undefined ? (
    <ClassBadge
      heroClass={hero.class}
      {...(size === undefined ? {} : { size })}
    />
  ) : (
    <Badge
      className="class-badge"
      color={
        hero.path === null || hero.path === undefined
          ? 'gray'
          : PATH_COLOURS[hero.path]
      }
      {...(size === undefined ? {} : { size })}
    >
      {hero.title}
    </Badge>
  );

/** A hardcore hero or board: red and filled, beside the class badge (which is outlined). */
export const HardcoreBadge = ({ size }: { size?: 'xs' | 'sm' }) => (
  <Badge
    className="hardcore-badge"
    color="red"
    variant="filled"
    title="Hardcore: one life"
    {...(size === undefined ? {} : { size })}
  >
    Hardcore
  </Badge>
);

/** A hero's title (decision 230; its class without one) and, when it is hardcore, the hardcore badge beside it (under it where a phone's row is too narrow). */
export const HeroBadges = ({
  hero,
  size,
  mt,
}: {
  hero: {
    readonly class: HeroClass;
    readonly title?: string | null;
    readonly path?: HeroPath | null;
    readonly hardcore: boolean;
  };
  size?: 'xs' | 'sm';
  mt?: number;
}) => {
  const sized = size === undefined ? {} : { size };
  return (
    <Group
      gap={6}
      style={{ rowGap: 4 }}
      className="hero-badges"
      {...(mt === undefined ? {} : { mt })}
    >
      <TitleBadge hero={hero} {...sized} />
      {hero.hardcore ? <HardcoreBadge {...sized} /> : null}
    </Group>
  );
};

export const VerdictBadge = ({ verdict }: { verdict: ShownVerdict }) =>
  verdict === 'verified' ? (
    <Badge color="green" title="Checked against the save by the rules checker">
      Verified
    </Badge>
  ) : (
    <Badge color="gray" title="Not checked against a save yet">
      Pending
    </Badge>
  );

/** A card with an optional small-caps title and actions on its right. */
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
  <Card
    className={`panel${className === undefined ? '' : ` ${className}`}`}
    mb="lg"
  >
    {title === undefined && actions === undefined ? null : (
      <Group justify="space-between" mb="md">
        {title === undefined ? (
          <span />
        ) : (
          <Title order={2} size="h5" className="panel-title">
            {title}
          </Title>
        )}
        {actions}
      </Group>
    )}
    {children}
  </Card>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <Text c="dimmed" py="xs">
    {children}
  </Text>
);
