import type { CloudSaveView } from '@gravoth/contracts';
import { Alert, Button, Group, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { ApiError, api } from '../api.js';
import {
  formatBytes,
  formatPlayTime,
  formatRelative,
  messageFor,
} from '../format.js';
import { Empty, Loaded, Panel } from './bits.js';
import { useLoad } from './use-load.js';

/** The copy the game keeps (decision 225): what it is, never the save itself (`?data=false`). */
const CloudSaveFacts = ({ save }: { save: CloudSaveView }) => (
  <>
    <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
      {save.description === '' ? 'Your save' : save.description}
    </Text>
    {save.updatedAt === null ? null : (
      <Text
        size="sm"
        c="dimmed"
        title={new Date(save.updatedAt).toLocaleString('en-GB')}
      >
        Updated {formatRelative(save.updatedAt)}
      </Text>
    )}
    <Table verticalSpacing="xs" mt="sm">
      <Table.Tbody>
        <Table.Tr>
          <Table.Td c="dimmed">Play time</Table.Td>
          <Table.Td ta="right">{formatPlayTime(save.playSeconds)}</Table.Td>
        </Table.Tr>
        <Table.Tr>
          <Table.Td c="dimmed">Size</Table.Td>
          <Table.Td ta="right">{formatBytes(save.size)}</Table.Td>
        </Table.Tr>
        <Table.Tr>
          <Table.Td c="dimmed">Game version</Table.Td>
          <Table.Td ta="right">{save.gameVersion ?? 'Not given'}</Table.Td>
        </Table.Tr>
      </Table.Tbody>
    </Table>
  </>
);

/**
 * The game's cloud save: one copy per account, written by the game while it is signed in with Google, Discord or
 * email, so the heroes outlive a lost phone. Shown and deleted here; never a guest's (the site has no guests).
 */
export const CloudSavePanel = ({ userId }: { userId: string }) => {
  const [load, reload] = useLoad(`cloud-save:${userId}`, () => api.cloudSave());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteCloudSave();
      setConfirming(false);
      reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? messageFor(caught.code)
          : "Can't reach the server.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Cloud save" className="cloud-save-panel">
      <Loaded load={load} retry={reload}>
        {(save) =>
          save.exists ? (
            <>
              <CloudSaveFacts save={save} />
              {confirming ? (
                <Stack gap="sm" mt="md">
                  <Text size="sm">
                    Delete the cloud copy? The save on your phone stays. While
                    CLOUD SAVE is on in the game, it uploads a new copy at its
                    next sync.
                  </Text>
                  <Group gap="sm">
                    <Button
                      color="red"
                      loading={busy}
                      onClick={() => void remove()}
                    >
                      Yes, delete it
                    </Button>
                    <Button
                      variant="default"
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                    >
                      Keep it
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Button
                  color="red"
                  variant="outline"
                  mt="md"
                  onClick={() => setConfirming(true)}
                >
                  Delete cloud save
                </Button>
              )}
            </>
          ) : (
            <Empty>
              No cloud save yet. The game keeps a copy of your save here once
              you sign in in the game with Google, Discord or email, so your
              heroes survive a lost phone. It is on by default; CLOUD SAVE on
              the game's GRAVOTH ONLINE page turns it off.
            </Empty>
          )
        }
      </Loaded>
      {error === null ? null : (
        <Alert color="red" variant="light" mt="md" role="alert">
          {error}
        </Alert>
      )}
    </Panel>
  );
};
