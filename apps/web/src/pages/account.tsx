import type { ProfileView, UpdateProfile } from '@gravoth/contracts';
import { DISPLAY_NAME_PATTERN, DISPLAY_NAME_RULE } from '@gravoth/contracts/constants';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '../api.js';
import { ClassBadge, Empty, HardcoreBadge, Loaded, Panel } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatDate, messageFor } from '../format.js';
import { useNavigation } from '../router.js';
import { useSession } from '../session.js';

const problem = (caught: unknown): string => (caught instanceof ApiError ? messageFor(caught.code) : "Can't reach the server.");

const Toggle = ({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-text">
      <span>{label}</span>
      <span className="muted">{hint}</span>
    </span>
  </label>
);

const ProfileForm = ({ profile, onSaved }: { profile: ProfileView; onSaved: (profile: ProfileView) => void }) => {
  const [name, setName] = useState(profile.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setName(profile.displayName), [profile.displayName]);

  const save = async (changes: UpdateProfile) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.updateProfile(changes));
      setSaved(true);
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!DISPLAY_NAME_PATTERN.test(name)) {
      setError(DISPLAY_NAME_RULE.charAt(0).toUpperCase() + DISPLAY_NAME_RULE.slice(1) + '.');
      return;
    }
    void save({ displayName: name });
  };

  return (
    <Panel title="Profile">
      <form className="form form-inline" onSubmit={rename}>
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={20} autoComplete="nickname" aria-describedby="name-rule" />
        </label>
        <button type="submit" className="button button-primary" disabled={busy || name === profile.displayName}>
          Save
        </button>
      </form>
      <p id="name-rule" className="muted small">
        {profile.nameChosen ? 'What boards and friends see.' : 'Made from your sign-in. Pick your own: boards and friends see it.'}
      </p>
      <div className="toggles">
        <Toggle label="Public profile" hint="Off: your name shows as hidden on the boards." checked={profile.publicProfile} disabled={busy} onChange={(value) => void save({ publicProfile: value })} />
        <Toggle label="Friend requests" hint="Let players ask to be your friend." checked={profile.allowFriendRequests} disabled={busy} onChange={(value) => void save({ allowFriendRequests: value })} />
        <Toggle label="Show when online" hint="Friends see when you play." checked={profile.showOnline} disabled={busy} onChange={(value) => void save({ showOnline: value })} />
        <Toggle label="Mail me friend requests" hint="An email when someone asks." checked={profile.emailFriendRequests} disabled={busy} onChange={(value) => void save({ emailFriendRequests: value })} />
      </div>
      {error === null ? null : (
        <p className="note note-error" role="alert">
          {error}
        </p>
      )}
      {saved && error === null ? (
        <p className="note" role="status">
          Saved.
        </p>
      ) : null}
    </Panel>
  );
};

const METHOD_NAMES: Record<string, string> = { email: 'Email and password', google: 'Google', discord: 'Discord', guest: 'Guest' };

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="kv">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

export const AccountPage = () => {
  const { session, refresh } = useSession();
  const { navigate } = useNavigation();
  const [account, reloadAccount] = useLoad(`account:${session?.user.id}`, () => api.account());
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [profileLoad] = useLoad(`profile:${session?.user.id}`, () => api.profile());
  const [heroes] = useLoad(`heroes:${session?.user.id}`, () => api.heroes());
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) navigate('/sign-in?next=/account', { replace: true });
  }, [session, navigate]);

  useEffect(() => {
    if (profileLoad.state === 'ready') setProfile(profileLoad.value);
  }, [profileLoad]);

  if (session === null || session === undefined) return null;

  const signOut = async () => {
    try {
      await api.signOut();
    } finally {
      await refresh();
      navigate('/', { replace: true });
    }
  };

  const verify = async (email: string) => {
    setError(null);
    try {
      await api.sendVerification(email);
      setNotice(`A confirmation link is on its way to ${email}.`);
    } catch (caught) {
      setError(problem(caught));
    }
  };

  const remove = async (hasPassword: boolean) => {
    setError(null);
    try {
      await api.deleteAccount(hasPassword ? password : undefined);
      await refresh();
      navigate('/', { replace: true });
    } catch (caught) {
      setError(problem(caught));
    }
  };

  return (
    <>
      <PageTitle title="Account" sub={profile === null ? undefined : `Signed in as ${profile.displayName}`}>
        <button type="button" className="button button-quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </PageTitle>
      <div className="two-col">
        <div>
          {profile === null ? <Loaded load={profileLoad}>{() => null}</Loaded> : <ProfileForm profile={profile} onSaved={setProfile} />}
          <Panel title="Your heroes">
            <Loaded load={heroes}>
              {({ heroes: list }) =>
                list.length === 0 ? (
                  <Empty>No heroes yet. A hero shows up here once the game posts its first record.</Empty>
                ) : (
                  <ul className="hero-list">
                    {list.map((hero) => (
                      <li key={hero.id}>
                        <span className="hero-list-name">{hero.name}</span>
                        <ClassBadge heroClass={hero.class} />
                        {hero.hardcore ? <HardcoreBadge /> : null}
                        <span className="muted small">since {formatDate(hero.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>
        </div>
        <div>
          <Loaded load={account} retry={reloadAccount}>
            {(view) => {
              const hasPassword = view.signIn.includes('email');
              return (
                <>
                  <Panel title="Sign-in">
                    <dl className="kvs">
                      <Row label="Email">
                        {view.email ?? <span className="muted">None (guest)</span>}
                        {view.email === null ? null : view.emailVerified ? (
                          <span className="badge badge-verified">Confirmed</span>
                        ) : (
                          <button type="button" className="link" onClick={() => void verify(view.email ?? '')}>
                            Send a confirmation link
                          </button>
                        )}
                      </Row>
                      <Row label="Signs in with">{view.signIn.map((method) => METHOD_NAMES[method] ?? method).join(', ')}</Row>
                      <Row label="Since">{formatDate(view.createdAt)}</Row>
                    </dl>
                    {notice === null ? null : (
                      <p className="note" role="status">
                        {notice}
                      </p>
                    )}
                  </Panel>
                  <Panel title="Delete account" className="panel-danger">
                    {deleting ? (
                      <form
                        className="form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void remove(hasPassword);
                        }}
                      >
                        <p>Your heroes, records, builds and friends are deleted with it. This can't be undone.</p>
                        {hasPassword ? (
                          <label className="field">
                            <span>Password</span>
                            <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                          </label>
                        ) : null}
                        <label className="field">
                          <span>Type DELETE to confirm</span>
                          <input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
                        </label>
                        <div className="row-buttons">
                          <button type="submit" className="button button-danger" disabled={confirm !== 'DELETE'}>
                            Delete everything
                          </button>
                          <button type="button" className="button button-quiet" onClick={() => setDeleting(false)}>
                            Keep my account
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button type="button" className="button button-danger-quiet" onClick={() => setDeleting(true)}>
                        Delete my account
                      </button>
                    )}
                  </Panel>
                </>
              );
            }}
          </Loaded>
          {error === null ? null : (
            <p className="note note-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </>
  );
};
