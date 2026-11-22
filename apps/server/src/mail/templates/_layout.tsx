import type { CSSProperties, ReactNode } from 'react';

/**
 * The frame every Gravoth mail shares: dark, plain, readable on a phone, with the name as a wordmark and no images
 * (nothing to block, nothing to load). Tables and inline styles only, which is what mail clients render alike.
 * `_layout` is skipped by `bun run mail:preview`, which shows the templates beside it.
 */
const palette = {
  page: '#0f0d0b',
  card: '#1a1714',
  edge: '#2c2620',
  text: '#e8dcc4',
  muted: '#a89c86',
  accent: '#d9b56a',
  accentText: '#1a1410',
} as const;

const font = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const styles = {
  body: { margin: 0, padding: 0, backgroundColor: palette.page, color: palette.text, fontFamily: font },
  wordmark: { padding: '0 4px 16px', color: palette.accent, fontSize: '20px', fontWeight: 700, letterSpacing: '6px' },
  card: { backgroundColor: palette.card, border: `1px solid ${palette.edge}`, borderRadius: '8px', padding: '28px 24px' },
  heading: { margin: '0 0 16px', color: palette.text, fontSize: '22px', lineHeight: '30px', fontWeight: 600 },
  paragraph: { margin: '0 0 16px', color: palette.text, fontSize: '16px', lineHeight: '24px' },
  button: {
    display: 'inline-block',
    backgroundColor: palette.accent,
    color: palette.accentText,
    fontSize: '16px',
    fontWeight: 700,
    lineHeight: '20px',
    padding: '14px 24px',
    borderRadius: '6px',
    textDecoration: 'none',
  },
  fallback: { margin: '0 0 16px', color: palette.muted, fontSize: '13px', lineHeight: '20px', wordBreak: 'break-all' },
  link: { color: palette.accent },
  footer: { padding: '16px 4px 0', color: palette.muted, fontSize: '12px', lineHeight: '18px' },
} satisfies Record<string, CSSProperties>;

export function Layout({ preview, heading, children }: { preview: string; heading: string; children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        <title>{heading}</title>
      </head>
      <body style={styles.body}>
        {/* The line a mail app shows beside the subject; kept out of the plain-text body. */}
        <div data-skip-in-text="true" style={{ display: 'none', maxHeight: 0, overflow: 'hidden' }}>
          {preview}
        </div>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: palette.page }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 16px' }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: '520px' }}>
                  <tbody>
                    <tr>
                      <td data-skip-in-text="true" style={styles.wordmark}>
                        GRAVOTH
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.card}>
                        <h1 style={styles.heading}>{heading}</h1>
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.footer}>
                        This mail is about your Gravoth account. It comes from an address that does not take replies.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <p style={styles.paragraph}>{children}</p>;
}

/** The one action of a mail, then the same link spelled out for a mail app that shows no buttons. */
export function Action({ label, url }: { label: string; url: string }) {
  return (
    <>
      <p style={{ margin: '8px 0 24px' }}>
        <a href={url} style={styles.button}>
          {label}
        </a>
      </p>
      <p data-skip-in-text="true" style={styles.fallback}>
        Or open this link:{' '}
        <a href={url} style={styles.link}>
          {url}
        </a>
      </p>
    </>
  );
}
