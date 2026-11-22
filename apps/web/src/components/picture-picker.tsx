import type {
  AvatarChoice,
  ProfileView,
  SignInMethod,
} from '@gravoth/contracts';
import { AVATAR_PORTRAITS } from '@gravoth/contracts/constants';
import {
  Alert,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useState } from 'react';
import { ApiError, api } from '../api.js';
import { messageFor, titleOf } from '../format.js';
import { PlayerAvatar, portraitSrc } from './avatar.js';
import { Panel } from './bits.js';

const problem = (caught: unknown): string =>
  caught instanceof ApiError
    ? messageFor(caught.code)
    : "Can't reach the server.";

/** "Google", "Discord", or "Google or Discord": which photo `provider` is, as far as the linked sign-ins tell. */
const photoSource = (signIn: readonly SignInMethod[] | undefined): string => {
  const providers = [
    ...(signIn?.includes('google') === true ? ['Google'] : []),
    ...(signIn?.includes('discord') === true ? ['Discord'] : []),
  ];
  return providers.length === 0 ? 'Google or Discord' : providers.join(' or ');
};

/** The picture: the current one large, the sign-in's photo when there is one, and the 42 portraits to pick from. */
export const PicturePicker = ({
  profile,
  signIn,
  onSaved,
}: {
  profile: ProfileView;
  signIn: readonly SignInMethod[] | undefined;
  onSaved: (profile: ProfileView) => void;
}) => {
  const [busy, setBusy] = useState<AvatarChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { avatar } = profile;
  const source = photoSource(signIn);

  const pick = async (choice: AvatarChoice) => {
    setBusy(choice);
    setError(null);
    try {
      onSaved(await api.updateProfile({ avatar: choice }));
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Your picture" className="picture-panel">
      <Group gap="lg" wrap="nowrap" mb="lg" align="center">
        <PlayerAvatar
          avatar={avatar}
          size={96}
          label={`Your picture: ${avatar.kind === 'provider' ? `your ${source} photo` : titleOf(avatar.portrait)}`}
        />
        <Stack gap={6} style={{ minWidth: 0 }}>
          <Text fw={600} className="current-picture">
            {avatar.kind === 'provider'
              ? `Your ${source} photo`
              : titleOf(avatar.portrait)}
          </Text>
          <Text size="sm" c="dimmed">
            Shown beside your name on the boards and to your friends, here and
            in the game.
          </Text>
          {profile.hasProviderPhoto && avatar.kind !== 'provider' ? (
            <Button
              variant="default"
              size="xs"
              w="fit-content"
              loading={busy === 'provider'}
              disabled={busy !== null}
              onClick={() => void pick('provider')}
            >
              Use my {source} photo
            </Button>
          ) : null}
        </Stack>
      </Group>
      <Text size="xs" c="dimmed" tt="uppercase" lts="0.12em" mb="xs">
        Or a portrait
      </Text>
      <SimpleGrid
        cols={{ base: 6, xs: 7 }}
        spacing={6}
        verticalSpacing={6}
        role="group"
        aria-label="Portraits"
        className="portrait-grid"
      >
        {AVATAR_PORTRAITS.map((id) => {
          const chosen = avatar.kind === 'portrait' && avatar.portrait === id;
          return (
            <UnstyledButton
              key={id}
              className="portrait-choice"
              data-portrait={id}
              aria-pressed={chosen}
              aria-label={titleOf(id)}
              title={titleOf(id)}
              disabled={busy !== null}
              onClick={() => {
                if (!chosen) void pick(id);
              }}
            >
              <img src={portraitSrc(id)} alt="" loading="lazy" />
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
      {error === null ? null : (
        <Alert color="red" variant="light" mt="md" role="alert">
          {error}
        </Alert>
      )}
    </Panel>
  );
};
