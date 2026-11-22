import { Panel } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { CONTACT_EMAIL } from '../links.js';
import { Link } from '../router.js';
import { useSession } from '../session.js';

/**
 * How to delete a Gravoth Online account: the page Google Play's account
 * deletion requirement links to, readable without signing in.
 */
export const DeleteAccountPage = () => {
  const { session } = useSession();
  const signedIn = session !== null && session !== undefined;
  return (
    <>
      <PageTitle
        title="Delete your account"
        sub="A Gravoth Online account, and everything kept for it."
      />
      <Panel className="prose">
        <p>
          Deleting a Gravoth Online account removes, at once and for good: the
          account and its sign-ins (email and password, Google, Discord), your
          display name and privacy settings, your heroes and every build they
          posted, your records on the leaderboards, your friends, friend
          requests and blocks. A confirmation mail goes to a confirmed address.
          Nothing is kept afterwards.
        </p>
        <p>
          Your heroes on your phone are not affected: the game plays offline and
          keeps its save on the phone.
        </p>
        <h2>On this site</h2>
        <ol>
          <li>
            {signedIn ? (
              'You are signed in.'
            ) : (
              <>
                <Link to="/sign-in?next=/account">Sign in</Link> with the
                account you want to delete.
              </>
            )}
          </li>
          <li>
            Open <Link to="/account">Account</Link>, choose{' '}
            <strong>Delete my account</strong>, enter your password if the
            account has one, and type DELETE to confirm.
          </li>
        </ol>
        <h2>Without signing in</h2>
        <p>
          If you can no longer sign in, write from the address on the account to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and the
          account is deleted within 30 days.
        </p>
      </Panel>
    </>
  );
};
