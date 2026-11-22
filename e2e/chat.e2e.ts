// `bun run e2e` (e2e/run.sh): decision 228's chat over the local production stack, as the game calls it: two players
// accept the rules and chat in the global channel and directly (the filter, links, the flood limit, the poll after an
// id, unread counts and read marks), a guest is refused, one reports the other's message, and the report reaches the
// moderation routes once the script in the app's container (`bun run admin:grant`) gives a third account the admin
// role: the copy of the message, a mute, the muted player's refusal, the unmute. Runs before api.e2e.ts, so the
// restore drill there carries chat rows. Prints one line per check; exits 1 if any failed.
const base = 'http://localhost:3000';
const run = Date.now().toString(36).slice(-5);
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
};

let nextIp = 40;
const call = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
) => {
  const headers: Record<string, string> = {
    // better-auth counts sign-ups by this header; each player its own address.
    'cf-connecting-ip': `198.51.100.${nextIp}`,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text === '' ? {} : JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    body,
    token: res.headers.get('set-auth-token'),
    headers: res.headers,
  };
};
const signUp = async (name: string) => {
  nextIp++;
  const reply = await call('POST', '/api/auth/sign-up/email', {
    body: {
      name,
      email: `${name.toLowerCase()}-${run}@example.test`,
      password: 'a long enough password',
    },
  });
  const token = reply.token ?? '';
  const displayName = `${name}${run}`;
  await call('PATCH', '/api/profile', { token, body: { displayName } });
  return { token, id: reply.body?.user?.id as string, displayName };
};

const ana = await signUp('Ana');
const bo = await signUp('Bo');
const mod = await signUp('Mod');
ok(
  'three players sign up',
  [ana, bo, mod].every((p) => p.token !== '' && p.id !== undefined),
);

// ---- 1. The rules, then the global channel.
{
  const first = await call('POST', '/api/chat/global', {
    token: ana.token,
    body: { body: 'hello' },
  });
  ok(
    'a message before the rules is refused',
    first.status === 403 && first.body.error === 'CHAT_RULES',
    first.body,
  );
  for (const p of [ana, bo])
    await call('POST', '/api/chat/rules/accept', { token: p.token });
  const page = await call('GET', '/api/chat/global?take=1', {
    token: bo.token,
  });
  ok(
    'the page says the rules are accepted, with no mute',
    page.status === 200 &&
      page.body.rulesAccepted === true &&
      page.body.muted === null,
    page.body,
  );
  const since = page.body.messages.at(-1)?.id ?? 0;
  const said = await call('POST', '/api/chat/global', {
    token: ana.token,
    body: { body: 'hello Bone Pit, what the fuck' },
  });
  ok(
    'a global message is stored masked, as the filter left it',
    said.status === 200 &&
      said.body.body === 'hello Bone Pit, what the ****' &&
      said.body.mine === true,
    said.body,
  );
  const link = await call('POST', '/api/chat/global', {
    token: ana.token,
    body: { body: 'free gold at evil.com' },
  });
  ok(
    'a link elsewhere is refused',
    link.status === 422 && link.body.error === 'LINKS_NOT_ALLOWED',
    link.body,
  );
  const site = await call('POST', '/api/chat/global', {
    token: ana.token,
    body: {
      body: `my page: https://gravoth.petarzarkov.com/players/${ana.id}`,
    },
  });
  ok('a link to the website is taken', site.status === 200, site.body);
  const poll = await call('GET', `/api/chat/global?after=${since}`, {
    token: bo.token,
  });
  ok(
    "Bo's poll after the last id he had brings Ana's two, oldest first",
    poll.body.messages?.length === 2 &&
      poll.body.messages[0].id === said.body.id &&
      poll.body.messages[0].from.userId === ana.id &&
      poll.body.messages[0].mine === false &&
      poll.body.gap === false,
    poll.body,
  );
  const repeat = await call('POST', '/api/chat/global', {
    token: ana.token,
    body: {
      body: `MY PAGE: https://gravoth.petarzarkov.com/players/${ana.id}`,
    },
  });
  ok(
    'the same text again at once is refused',
    repeat.status === 409 && repeat.body.error === 'CHAT_REPEAT',
    repeat.body,
  );
}

// ---- 2. Direct messages between friends, and the badge.
{
  const ask = await call('POST', '/api/friends/requests', {
    token: ana.token,
    body: { displayName: bo.displayName },
  });
  const stranger = await call('POST', `/api/chat/direct/${bo.id}`, {
    token: ana.token,
    body: { body: 'hi bo' },
  });
  ok(
    'a direct message to a player who is not a friend is refused',
    stranger.status === 403 && stranger.body.error === 'NOT_FRIENDS',
    stranger.body,
  );
  await call('POST', `/api/friends/requests/${ask.body.request?.id}/accept`, {
    token: bo.token,
  });
  const sent = await call('POST', `/api/chat/direct/${bo.id}`, {
    token: ana.token,
    body: { body: 'hi bo' },
  });
  ok('Ana writes to Bo, a friend', sent.status === 200, sent.body);
  const unread = await call('GET', '/api/chat/unread', { token: bo.token });
  ok(
    'Bo has one unread, from Ana',
    unread.body.direct === 1 && unread.body.from?.[0]?.userId === ana.id,
    unread.body,
  );
  const list = await call('GET', '/api/chat/direct', { token: bo.token });
  ok(
    'his conversations list Ana with her last line',
    list.body.conversations?.[0]?.peer.userId === ana.id &&
      list.body.conversations[0].last.body === 'hi bo' &&
      list.body.conversations[0].unread === 1,
    list.body,
  );
  await call('POST', `/api/chat/direct/${ana.id}/read`, {
    token: bo.token,
    body: { upTo: sent.body.id },
  });
  const read = await call('GET', '/api/chat/unread', { token: bo.token });
  ok('read, the badge is clear', read.body.direct === 0, read.body);
  const reply = await call('POST', `/api/chat/direct/${ana.id}`, {
    token: bo.token,
    body: { body: 'hi ana' },
  });
  const thread = await call('GET', `/api/chat/direct/${bo.id}`, {
    token: ana.token,
  });
  ok(
    'the conversation reads both ways, oldest first',
    reply.status === 200 &&
      thread.body.messages?.map((m: any) => m.body).join('|') ===
        'hi bo|hi ana',
    thread.body,
  );
}

// ---- 3. Ten a minute, a guest refused.
{
  let last = 0;
  for (let n = 0; n < 8; n++)
    last = (
      await call('POST', '/api/chat/global', {
        token: bo.token,
        body: { body: `count ${n}` },
      })
    ).status;
  // Bo has sent 1 + 8 = 9 this minute; the tenth goes, the eleventh does not.
  const tenth = await call('POST', '/api/chat/global', {
    token: bo.token,
    body: { body: 'ten' },
  });
  const eleventh = await call('POST', '/api/chat/global', {
    token: bo.token,
    body: { body: 'eleven' },
  });
  ok(
    'a player may send ten messages a minute, both channels together',
    last === 200 &&
      tenth.status === 200 &&
      eleventh.status === 429 &&
      eleventh.body.error === 'TOO_MANY_REQUESTS' &&
      Number(eleventh.headers.get('retry-after')) > 0,
    [last, tenth.status, eleventh.status, eleventh.body],
  );
  const guest = await call('POST', '/api/auth/sign-in/anonymous', {
    body: {},
  });
  const refused = await call('GET', '/api/chat/global', {
    token: guest.token ?? '',
  });
  ok(
    'a guest has no chat',
    refused.status === 403 && refused.body.error === 'GUEST_ACCOUNT',
    refused.body,
  );
}

// ---- 4. A report, and the moderation routes.
{
  const page = await call('GET', '/api/chat/global', { token: bo.token });
  const target = page.body.messages.find(
    (m: any) => m.body === 'hello Bone Pit, what the ****',
  );
  const reported = await call(
    'POST',
    `/api/chat/messages/${target?.id}/report`,
    {
      token: bo.token,
      body: { reason: 'harassment', note: 'rude to everyone' },
    },
  );
  const again = await call('POST', `/api/chat/messages/${target?.id}/report`, {
    token: bo.token,
    body: { reason: 'spam' },
  });
  ok(
    'Bo reports it, and again changes nothing',
    reported.status === 200 &&
      reported.body.reported === true &&
      again.status === 200,
    [reported.body, again.body],
  );
  const own = await call('POST', `/api/chat/messages/${target?.id}/report`, {
    token: ana.token,
    body: { reason: 'spam' },
  });
  ok(
    'Ana cannot report her own',
    own.status === 400 && own.body.error === 'CANNOT_REPORT_SELF',
    own.body,
  );

  const before = await call('GET', '/api/admin/chat/reports', {
    token: mod.token,
  });
  ok(
    'the moderation routes refuse a player without the role',
    before.status === 403,
    before.status,
  );
  const grant = Bun.spawn(
    [
      'docker',
      'exec',
      'gravoth-api',
      'bun',
      'run',
      'admin:grant',
      mod.displayName,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err] = await Promise.all([
    new Response(grant.stdout).text(),
    new Response(grant.stderr).text(),
  ]);
  ok(
    "the script in the app's container gives the role",
    (await grant.exited) === 0 &&
      out.includes(`${mod.displayName} (${mod.id}) is now an admin`),
    err.slice(-300),
  );
  const account = await call('GET', '/api/account', { token: mod.token });
  ok('the account says so', account.body.admin === true, account.body);

  const reports = await call('GET', '/api/admin/chat/reports', {
    token: mod.token,
  });
  const entry = reports.body.reports?.find(
    (r: any) => r.message.id === target?.id,
  );
  ok(
    'the report reaches the admin, with its copy of the message, reason, note and reporter',
    reports.status === 200 &&
      entry?.reason === 'harassment' &&
      entry.note === 'rude to everyone' &&
      entry.reporter.userId === bo.id &&
      entry.message.from.userId === ana.id &&
      entry.message.body === 'hello Bone Pit, what the ****' &&
      entry.reports === 1 &&
      entry.resolved === null,
    reports.body,
  );
  const around = await call(
    'GET',
    `/api/admin/chat/messages?around=${target?.id}&take=4`,
    { token: mod.token },
  );
  ok(
    'the admin reads the messages around it',
    around.body.messages?.some((m: any) => m.id === target?.id),
    around.body,
  );
  const muted = await call(
    'POST',
    `/api/admin/chat/reports/${entry?.id}/resolve`,
    {
      token: mod.token,
      body: { action: 'mute', hours: 1, reason: 'harassment' },
    },
  );
  ok(
    'hide and mute closes the report',
    muted.status === 200 &&
      muted.body.resolved?.action === 'mute' &&
      muted.body.message.hidden === true,
    muted.body,
  );
  const refused = await call('POST', '/api/chat/global', {
    token: ana.token,
    body: { body: 'let me talk' },
  });
  ok(
    'Ana is muted for an hour, in every channel',
    refused.status === 403 &&
      refused.body.error === 'CHAT_MUTED' &&
      Date.parse(refused.body.until) > Date.now() + 3_500_000,
    refused.body,
  );
  const gone = await call('GET', '/api/chat/global', { token: bo.token });
  ok(
    "the hidden message leaves the players' channel and is listed as removed",
    !gone.body.messages.some((m: any) => m.id === target?.id) &&
      gone.body.removed.includes(target?.id),
    gone.body.removed,
  );
  const unmute = await call('POST', `/api/admin/chat/mutes/${ana.id}/remove`, {
    token: mod.token,
  });
  const back = await call('POST', `/api/chat/direct/${bo.id}`, {
    token: ana.token,
    body: { body: 'sorry' },
  });
  ok(
    'unmuted, Ana writes again',
    unmute.status === 200 && back.status === 200,
    [unmute.body, back.body],
  );
  await Bun.spawn([
    'docker',
    'exec',
    'gravoth-api',
    'bun',
    'run',
    'admin:revoke',
    mod.displayName,
  ]).exited;
  const revoked = await call('GET', '/api/admin/chat/mutes', {
    token: mod.token,
  });
  ok(
    'revoked, the routes refuse him again',
    revoked.status === 403,
    revoked.status,
  );
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
