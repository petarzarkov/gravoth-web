import { Anchor, List, Text, Title } from '@mantine/core';
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
        <Text mb="sm">
          Deleting a Gravoth Online account removes, at once and for good: the
          account and its sign-ins (email and password, Google, Discord), your
          display name and privacy settings, your heroes and every build they
          posted, your records on the leaderboards, the cloud save the game
          keeps, your friends, friend requests and blocks. A confirmation mail
          goes to a confirmed address. The nightly backups that still hold them
          are deleted as they turn 30 days old.
        </Text>
        <Text mb="lg">
          Your heroes on your phone are not affected: the game plays offline and
          keeps its save on the phone.
        </Text>
        <Title order={2} size="h4" mb="xs">
          On this site
        </Title>
        <List type="ordered" spacing="xs" mb="lg">
          <List.Item>
            {signedIn ? (
              'You are signed in.'
            ) : (
              <>
                <Anchor component={Link} to="/sign-in?next=/account">
                  Sign in
                </Anchor>{' '}
                with the account you want to delete.
              </>
            )}
          </List.Item>
          <List.Item>
            Open{' '}
            <Anchor component={Link} to="/account">
              Account
            </Anchor>
            , choose <strong>Delete my account</strong>, enter your password if
            the account has one, and type DELETE to confirm.
          </List.Item>
        </List>
        <Title order={2} size="h4" mb="xs">
          Without signing in
        </Title>
        <Text>
          If you can no longer sign in, write from the address on the account to{' '}
          <Anchor href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Anchor> and
          the account is deleted within 30 days.
        </Text>
      </Panel>
    </>
  );
};
