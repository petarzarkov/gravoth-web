import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { AccountView, ProfileView } from '@gravoth/contracts';
import { startTestApp, type TestApp } from './testing/app.js';
import { call } from './testing/http.js';
import {
  answerDiscordTokens,
  discordSignIn,
  standInProviders,
  type DiscordStandIn,
  type GoogleStandIn,
} from './testing/stand-ins.js';

/**
 * Pictures (decision 222): a Google or Discord sign-up starts on its photo, linked (Google's or Discord's own address,
 * never copied), which every later sign-in brings up to date; Discord's generated default avatar is no photo; the
 * player picks the photo or a portrait. The providers are the stand-ins (testing/stand-ins.ts), whose photos a test
 * changes between sign-ins the way a player changes theirs.
 */
const GOOGLE = new Map<string, GoogleStandIn>([
  [
    'google-pia',
    {
      id: 'g-pia',
      email: 'pia@example.test',
      name: 'Pia',
      emailVerified: true,
      image: 'https://lh3.googleusercontent.com/a/pia-first=s96-c',
    },
  ],
]);

const DISCORD = new Map<string, DiscordStandIn>([
  [
    'code-tao',
    {
      id: '1004',
      email: 'tao@example.test',
      global_name: 'Tao',
      verified: true,
      // Discord's generated default: no photo of Tao's own.
      image: 'https://cdn.discordapp.com/embed/avatars/2.png',
    },
  ],
]);

let started: TestApp;
let base = '';
let restoreFetch = () => {};

beforeAll(async () => {
  restoreFetch = answerDiscordTokens();
  started = await startTestApp({
    config: { PUBLIC_URL: 'https://gravoth-api.example.test' },
    overrides: [standInProviders(GOOGLE, DISCORD)],
  });
  base = started.base;
});

afterAll(async () => {
  restoreFetch();
  await started.close();
});

const googleSignIn = async (idToken: string): Promise<string> => {
  const reply = await call(base, 'POST', '/api/auth/sign-in/social', {
    body: { provider: 'google', idToken: { token: idToken } },
  });
  expect(reply.status).toBe(200);
  return reply.token ?? '';
};

const profileOf = async (token: string): Promise<ProfileView> =>
  (await call<ProfileView>(base, 'GET', '/api/profile', { token })).body;

const account = async (token: string): Promise<AccountView> =>
  (await call<AccountView>(base, 'GET', '/api/account', { token })).body;

const pickAvatar = (token: string, avatar: string) =>
  call<ProfileView>(base, 'PATCH', '/api/profile', {
    token,
    body: { avatar },
  });

describe('pictures', () => {
  it('starts a Google sign-up on its photo, and follows the photo at the next sign-in, leaving the name and address', async () => {
    const first = await googleSignIn('google-pia');
    const made = await profileOf(first);
    expect(made.hasProviderPhoto).toBe(true);
    expect(made.avatar).toMatchObject({
      kind: 'provider',
      url: 'https://lh3.googleusercontent.com/a/pia-first=s96-c',
    });

    const pia = GOOGLE.get('google-pia');
    if (pia === undefined) throw new Error('no stand-in');
    GOOGLE.set('google-pia', {
      ...pia,
      name: 'Pia Renamed',
      image: 'https://lh3.googleusercontent.com/a/pia-second=s96-c',
    });
    const second = await googleSignIn('google-pia');
    const again = await profileOf(second);
    expect(again.avatar).toEqual({
      kind: 'provider',
      portrait: made.avatar.portrait,
      url: 'https://lh3.googleusercontent.com/a/pia-second=s96-c',
    });
    expect(await account(second)).toMatchObject({
      name: 'Pia',
      email: 'pia@example.test',
    });

    // A portrait, then the photo again.
    expect((await pickAvatar(second, 'wick')).body.avatar).toEqual({
      kind: 'portrait',
      portrait: 'wick',
      url: null,
    });
    expect((await pickAvatar(second, 'provider')).body.avatar).toEqual({
      kind: 'provider',
      portrait: 'wick',
      url: 'https://lh3.googleusercontent.com/a/pia-second=s96-c',
    });
  });

  it("counts Discord's default avatar as no photo, takes a real one at the next sign-in, and drops it when it goes", async () => {
    const first = await discordSignIn(base, 'code-tao');
    const made = await profileOf(first.token ?? '');
    expect(made.hasProviderPhoto).toBe(false);
    expect(made.avatar.kind).toBe('portrait');
    expect((await pickAvatar(first.token ?? '', 'provider')).status).toBe(409);

    const tao = DISCORD.get('code-tao');
    if (tao === undefined) throw new Error('no stand-in');
    DISCORD.set('code-tao', {
      ...tao,
      image: 'https://cdn.discordapp.com/avatars/1004/tao.png',
    });
    const second = await discordSignIn(base, 'code-tao');
    expect((await profileOf(second.token ?? '')).hasProviderPhoto).toBe(true);
    expect(
      (await pickAvatar(second.token ?? '', 'provider')).body.avatar,
    ).toEqual({
      kind: 'provider',
      portrait: made.avatar.portrait,
      url: 'https://cdn.discordapp.com/avatars/1004/tao.png',
    });

    // The avatar removed at Discord: the portrait shows in its place until a photo is back.
    DISCORD.set('code-tao', tao);
    const third = await discordSignIn(base, 'code-tao');
    const after = await profileOf(third.token ?? '');
    expect(after.hasProviderPhoto).toBe(false);
    expect(after.avatar).toEqual({
      kind: 'portrait',
      portrait: made.avatar.portrait,
      url: null,
    });
  });
});
