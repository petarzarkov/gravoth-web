import { Action, Layout, Paragraph } from './_layout.js';

export interface ResetPasswordProps {
  name: string;
  url: string;
}

/** Sent when the player asks to reset a forgotten password. */
export default function ResetPassword({ name, url }: ResetPasswordProps) {
  return (
    <Layout preview="Choose a new password for your Gravoth account." heading="Reset your password">
      <Paragraph>Hello {name},</Paragraph>
      <Paragraph>Someone asked to reset the password of your Gravoth account. Open the link to choose a new one. It works for one hour.</Paragraph>
      <Action label="Choose a new password" url={url} />
      <Paragraph>If it was not you, ignore this mail: your password stays as it is.</Paragraph>
    </Layout>
  );
}

ResetPassword.subject = 'Reset your Gravoth password';
ResetPassword.PreviewProps = { name: 'Sol', url: 'https://gravoth-api.petarzarkov.com/api/account/reset-password?token=preview' } satisfies ResetPasswordProps;
