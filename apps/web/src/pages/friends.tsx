import { DISPLAY_NAME_PATTERN } from '@gravoth/contracts/constants';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api.js';
import { Empty, Loaded, Panel } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatDate, messageFor } from '../format.js';
import { useNavigation } from '../router.js';
import { isGuest, useSession } from '../session.js';

const problem = (caught: unknown): string => (caught instanceof ApiError ? messageFor(caught.code) : "Can't reach the server.");

/** A name box with one action: ask to be friends, or block. */
const ByName = ({ label, action, danger, onDone }: { label: string; action: (name: string) => Promise<string>; danger?: boolean; onDone: () => void }) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!DISPLAY_NAME_PATTERN.test(trimmed)) {
      setMessage({ error: true, text: messageFor('PLAYER_NOT_FOUND') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ error: false, text: await action(trimmed) });
      setName('');
      onDone();
    } catch (caught) {
      setMessage({ error: true, text: problem(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="form form-inline" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={20} autoComplete="off" />
        </label>
        <button type="submit" className={danger === true ? 'button button-danger-quiet' : 'button button-primary'} disabled={busy || name.trim() === ''}>
          {label}
        </button>
      </form>
      {message === null ? null : (
        <p className={message.error ? 'note note-error' : 'note'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </>
  );
};

export const FriendsPage = () => {
  const { session } = useSession();
  const { navigate } = useNavigation();
  const [round, setRound] = useState(0);
  const key = `${session?.user.id}:${round}`;
  const [friends] = useLoad(`friends:${key}`, () => api.friends());
  const [incoming] = useLoad(`incoming:${key}`, () => api.incoming());
  const [outgoing] = useLoad(`outgoing:${key}`, () => api.outgoing());
  const [blocks] = useLoad(`blocks:${key}`, () => api.blocks());
  const [error, setError] = useState<string | null>(null);
  const refresh = () => setRound((value) => value + 1);

  useEffect(() => {
    if (session === null) navigate('/sign-in?next=/friends', { replace: true });
  }, [session, navigate]);

  if (session === null || session === undefined) return null;
  if (isGuest(session)) {
    return (
      <>
        <PageTitle title="Friends" />
        <Empty>Guest accounts have no friends list. Create an account in the game or on this site first.</Empty>
      </>
    );
  }

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      refresh();
    } catch (caught) {
      setError(problem(caught));
    }
  };

  return (
    <>
      <PageTitle title="Friends" sub="Friends see each other on the friends view of every board." />
      {error === null ? null : (
        <p className="note note-error" role="alert">
          {error}
        </p>
      )}
      <div className="two-col">
        <div>
          <Panel title="Add a friend">
            <ByName
              label="Send request"
              onDone={refresh}
              action={async (name) => {
                const outcome = await api.askFriend(name);
                return outcome.status === 'accepted' ? `${outcome.friend.displayName} had asked you too: you're friends now.` : `Request sent to ${outcome.request.displayName}.`;
              }}
            />
          </Panel>
          <Panel title="Waiting for you">
            <Loaded load={incoming}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>No requests.</Empty>
                ) : (
                  <ul className="people">
                    {page.data.map((item) => (
                      <li key={item.id}>
                        <span className="person">{item.displayName}</span>
                        <span className="muted small">{formatDate(item.createdAt)}</span>
                        <span className="row-buttons">
                          <button type="button" className="button button-primary button-small" onClick={() => void act(() => api.accept(item.id))}>
                            Accept
                          </button>
                          <button type="button" className="button button-quiet button-small" onClick={() => void act(() => api.decline(item.id))}>
                            Decline
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>
          <Panel title="You asked">
            <Loaded load={outgoing}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>Nothing pending.</Empty>
                ) : (
                  <ul className="people">
                    {page.data.map((item) => (
                      <li key={item.id}>
                        <span className="person">{item.displayName}</span>
                        <span className="muted small">{formatDate(item.createdAt)}</span>
                        <button type="button" className="button button-quiet button-small" onClick={() => void act(() => api.cancel(item.id))}>
                          Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>
        </div>
        <div>
          <Panel title="Friends">
            <Loaded load={friends}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>No friends yet. Ask someone by their display name.</Empty>
                ) : (
                  <ul className="people">
                    {page.data.map((friend) => (
                      <li key={friend.userId}>
                        <span className="person">{friend.displayName}</span>
                        <span className="muted small">since {formatDate(friend.since)}</span>
                        <span className="row-buttons">
                          <button type="button" className="button button-quiet button-small" onClick={() => void act(() => api.unfriend(friend.userId))}>
                            Remove
                          </button>
                          <button type="button" className="button button-danger-quiet button-small" onClick={() => void act(() => api.block(friend.displayName))}>
                            Block
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>
          <Panel title="Blocked">
            <ByName label="Block" danger onDone={refresh} action={async (name) => `${(await api.block(name)).displayName} is blocked.`} />
            <Loaded load={blocks}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>Nobody blocked.</Empty>
                ) : (
                  <ul className="people">
                    {page.data.map((block) => (
                      <li key={block.userId}>
                        <span className="person">{block.displayName}</span>
                        <span className="muted small">{formatDate(block.blockedAt)}</span>
                        <button type="button" className="button button-quiet button-small" onClick={() => void act(() => api.unblock(block.userId))}>
                          Unblock
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>
        </div>
      </div>
    </>
  );
};
