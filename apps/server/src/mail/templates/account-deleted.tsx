import { Layout, Paragraph } from './_layout.js';

export interface AccountDeletedProps {
  name: string;
}

/** Sent once an account and everything kept for it are deleted (Google Play's account deletion). */
export default function AccountDeleted({ name }: AccountDeletedProps) {
  return (
    <Layout preview="Your Gravoth account and its data are deleted." heading="Your account is deleted">
      <Paragraph>Hello {name},</Paragraph>
      <Paragraph>
        Your Gravoth account is deleted, with everything the server kept for it: its sign-ins, its profile, its heroes and their builds, its
        places on the boards, and its friends and blocks.
      </Paragraph>
      <Paragraph>Heroes kept on your own device are not touched. If you did not ask for this, write to the contact address on the game's store page.</Paragraph>
    </Layout>
  );
}

AccountDeleted.subject = 'Your Gravoth account is deleted';
AccountDeleted.PreviewProps = { name: 'Sol' } satisfies AccountDeletedProps;
