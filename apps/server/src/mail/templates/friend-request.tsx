import { Layout, Paragraph } from './_layout.js';

export interface FriendRequestProps {
  name: string;
  /** The requester's display name (letters, digits, `_` and `-` only, so it is safe in the subject too). */
  from: string;
}

/** One plain mail per request (no digest), to a confirmed address whose profile allows it. */
export default function FriendRequest({ name, from }: FriendRequestProps) {
  return (
    <Layout preview={`${from} wants to be your friend in Gravoth.`} heading="A friend request">
      <Paragraph>Hello {name},</Paragraph>
      <Paragraph>
        <strong>{from}</strong> sent you a friend request in Gravoth. Accept or decline it under FRIENDS in the game.
      </Paragraph>
      <Paragraph>To stop these mails, turn off friend request mails in the game's account settings.</Paragraph>
    </Layout>
  );
}

FriendRequest.subject = (from: string) => `${from} sent you a friend request in Gravoth`;
FriendRequest.PreviewProps = { name: 'Sol', from: 'Kriso' } satisfies FriendRequestProps;
