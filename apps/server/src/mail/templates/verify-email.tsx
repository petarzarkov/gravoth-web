import { Action, Layout, Paragraph } from './_layout.js';

export interface VerifyEmailProps {
  name: string;
  url: string;
}

/** Sent at sign-up with an email and a password, and when the player asks again. */
export default function VerifyEmail({ name, url }: VerifyEmailProps) {
  return (
    <Layout
      preview="Confirm the address of your Gravoth account."
      heading="Confirm your address"
    >
      <Paragraph>Hello {name},</Paragraph>
      <Paragraph>
        Confirm this address for your Gravoth account. The link works for one
        hour.
      </Paragraph>
      <Action label="Confirm my address" url={url} />
      <Paragraph>
        If you did not make a Gravoth account, ignore this mail.
      </Paragraph>
    </Layout>
  );
}

VerifyEmail.subject = 'Confirm your Gravoth account';
VerifyEmail.PreviewProps = {
  name: 'Sol',
  url: 'https://gravoth-api.petarzarkov.com/api/auth/verify-email?token=preview',
} satisfies VerifyEmailProps;
