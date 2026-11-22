import type { HeroClass, ShownVerdict } from '@gravoth/contracts';
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

export const ClassBadge = ({ heroClass }: { heroClass: HeroClass }) => (
  <Badge className="class-badge" color={CLASS_COLOURS[heroClass]}>
    {CLASS_NAMES[heroClass]}
  </Badge>
);

export const HardcoreBadge = () => (
  <Badge color="red" title="Hardcore: one life">
    HC
  </Badge>
);

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
