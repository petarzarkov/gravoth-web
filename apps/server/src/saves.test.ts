import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { CloudSaveView } from '@gravoth/contracts';
import { SQL } from 'bun';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * The cloud save (decision 225) over HTTP, as the game calls it: one copy per account, replaced whole, read back to the
 * byte, shown to the website without its data, deleted, refused to a guest, gone with the account. The bytes are kept
 * decoded (`bytea`), so the database's own `octet_length` and `sha256` are checked against what was sent.
 */
let started: TestApp;
let base = '';
let sql: SQL;

beforeAll(async () => {
  started = await startTestApp();
  base = started.base;
  sql = new SQL(started.database.url, { max: 1 });
});

afterAll(async () => {
  await sql.close();
  await started.close();
});

let counter = 0;
const player = async (): Promise<Player> => {
  counter += 1;
  return signUp(base, 'Saver', `saver${counter}@saves.test`);
};

/** Bytes a text column would mangle: zeros, the high half, and every byte value. */
const awkwardBytes = (): Uint8Array => {
  const bytes = new Uint8Array(70_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919) % 256;
  bytes.set([0, 0, 0, 255, 254, 128, 127, 0, 0x5c, 0x27, 0x22, 0], 0);
  bytes.set([0, 255, 0, 255], bytes.length - 4);
  return bytes;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const put = (token: string, body: unknown, headers?: Record<string, string>) =>
  call<CloudSaveView & { error?: string; issues?: unknown[] }>(
    base,
    'PUT',
    '/api/saves/me',
    { token, body, ...(headers === undefined ? {} : { headers }) },
  );
const get = (token: string, query = '') =>
  call<CloudSaveView & { error?: string }>(
    base,
    'GET',
    `/api/saves/me${query}`,
    { token },
  );
const remove = (token: string) =>
  call<{ deleted: boolean; error?: string }>(base, 'DELETE', '/api/saves/me', {
    token,
  });

const stored = async (userId: string) =>
  (await sql`
    SELECT octet_length(data)::int AS octets, size, sha256, encode(sha256(data), 'hex') AS actual,
           created_at AS "createdAt", updated_at AS "updatedAt"
      FROM cloud_saves WHERE user_id = ${userId}`) as {
    octets: number;
    size: number;
    sha256: string;
    actual: string;
    createdAt: Date;
    updatedAt: Date;
  }[];

const NONE = {
  exists: false,
  data: null,
  description: '',
  playSeconds: 0,
  gameVersion: null,
  size: 0,
  updatedAt: null,
};

describe('the cloud save', () => {
  it('starts empty: exists false, with nulls and zeros', async () => {
    const me = await player();
    const reply = await get(me.token);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(NONE);
    expect((await get(me.token, '?data=false')).body).toEqual(NONE);
  });

  it('keeps the exact bytes: zeros and high bytes come back as they went', async () => {
    const me = await player();
    const bytes = awkwardBytes();
    const written = await put(me.token, {
      data: b64(bytes),
      description: 'Grom, level 24 (3 characters)',
      playSeconds: 86_400 * 3 + 125,
      gameVersion: '0.13.1',
    });
    expect(written.status).toBe(200);
    expect(written.body).toMatchObject({
      exists: true,
      data: null,
      description: 'Grom, level 24 (3 characters)',
      playSeconds: 259_325,
      gameVersion: '0.13.1',
      size: bytes.length,
    });
    expect(Date.parse(written.body.updatedAt ?? '')).toBeGreaterThan(
      Date.now() - 60_000,
    );

    const read = await get(me.token);
    expect(read.status).toBe(200);
    expect(read.body.data).toBe(b64(bytes));
    const back = Buffer.from(read.body.data ?? '', 'base64');
    expect(Buffer.compare(back, Buffer.from(bytes))).toBe(0);
    expect(read.body.size).toBe(bytes.length);

    // Stored decoded: the database counts the bytes and hashes them as the server did.
    const [row] = await stored(me.id);
    expect(row?.octets).toBe(bytes.length);
    expect(row?.size).toBe(bytes.length);
    expect(row?.sha256).toBe(row?.actual ?? '');
    expect(row?.sha256).toBe(
      new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    );
  });

  it('leaves the data out for ?data=false, and nothing else', async () => {
    const me = await player();
    await put(me.token, { data: b64(new Uint8Array([1, 2, 3, 0])) });
    const full = await get(me.token);
    const short = await get(me.token, '?data=false');
    expect(short.status).toBe(200);
    expect(short.body).toEqual({ ...full.body, data: null });
    expect(full.body).toMatchObject({
      exists: true,
      description: '',
      playSeconds: 0,
      gameVersion: null,
      size: 4,
    });
    expect((await get(me.token, '?data=true')).body.data).toBe('AQIDAA==');
    expect((await get(me.token, '?data=maybe')).status).toBe(400);
  });

  it('replaces the copy whole: new bytes, and what the new write left out is gone', async () => {
    const me = await player();
    await put(me.token, {
      data: b64(awkwardBytes()),
      description: 'first',
      playSeconds: 60,
      gameVersion: '0.13.1',
    });
    const [first] = await stored(me.id);
    await Bun.sleep(5);
    const next = new Uint8Array([9, 0, 9, 255]);
    const again = await put(me.token, {
      data: b64(next),
      description: 'second',
    });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      description: 'second',
      playSeconds: 0,
      gameVersion: null,
      size: 4,
    });
    const read = await get(me.token);
    expect(read.body.data).toBe(b64(next));
    const rows = await stored(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt.getTime()).toBe(first?.createdAt.getTime() ?? 0);
    expect(rows[0]?.updatedAt.getTime()).toBeGreaterThan(
      first?.updatedAt.getTime() ?? 0,
    );
  });

  it('deletes the copy, and says when there was none', async () => {
    const me = await player();
    await put(me.token, { data: 'AAAA' });
    const gone = await remove(me.token);
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ deleted: true });
    expect((await get(me.token)).body).toEqual(NONE);
    expect(await stored(me.id)).toHaveLength(0);
    expect((await remove(me.token)).body).toEqual({ deleted: false });
  });

  it("only ever reaches the caller's own copy", async () => {
    const [ana, bo] = [await player(), await player()];
    await put(ana.token, { data: b64(new Uint8Array([1, 1, 1])) });
    await put(bo.token, { data: b64(new Uint8Array([2, 2, 2])) });
    expect((await get(ana.token)).body.data).toBe('AQEB');
    expect((await get(bo.token)).body.data).toBe('AgIC');
    await remove(ana.token);
    expect((await get(bo.token)).body.data).toBe('AgIC');
  });

  it('refuses a guest, on all three, and keeps nothing for it', async () => {
    const visitor = await guest(base);
    for (const reply of [
      await get(visitor.token),
      await put(visitor.token, { data: 'AAAA' }),
      await remove(visitor.token),
    ]) {
      expect(reply.status).toBe(403);
      expect(reply.body.error).toBe('GUEST_ACCOUNT');
    }
    expect(await stored(visitor.id)).toHaveLength(0);
  });

  it('a guest that signs up starts without a copy, and can keep one', async () => {
    const visitor = await guest(base);
    counter += 1;
    const up = await call<{ user: { id: string } }>(
      base,
      'POST',
      '/api/auth/sign-up/email',
      {
        token: visitor.token,
        body: {
          name: 'Upgraded',
          email: `saver${counter}@saves.test`,
          password: 'a long enough password',
        },
      },
    );
    expect(up.status).toBe(200);
    const token = up.token ?? '';
    expect((await get(token)).body).toEqual(NONE);
    expect((await put(token, { data: 'AAAA' })).status).toBe(200);
  });

  it('refuses a caller without a session', async () => {
    const response = await fetch(`${base}/api/saves/me`);
    expect(response.status).toBe(401);
    const write = await fetch(`${base}/api/saves/me`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'AAAA' }),
    });
    expect(write.status).toBe(401);
  });

  it('refuses data that is not base64, and keeps the old copy', async () => {
    const me = await player();
    await put(me.token, { data: 'AQID' });
    // Each passes the schema's pattern but does not decode to itself: a ragged length, padding with nothing to pad,
    // bits after the last byte.
    for (const data of ['AAAAA', 'A===', 'AAAAA===', 'AB==', 'AAAAAAB=']) {
      const reply = await put(me.token, { data });
      expect(reply.status).toBe(400);
      expect(JSON.stringify(reply.body.issues)).toContain('data');
    }
    // And these fail the pattern itself.
    for (const data of ['AA-_', 'not base64!', 'AA AA']) {
      expect((await put(me.token, { data })).status).toBe(400);
    }
    expect((await get(me.token)).body.data).toBe('AQID');
  });

  it('keeps the largest save, 3 MB, and refuses a larger one with SAVE_TOO_LARGE', async () => {
    const me = await player();
    const largest = 'A'.repeat(4_000_000);
    const kept = await put(me.token, { data: largest });
    expect(kept.status).toBe(200);
    expect(kept.body.size).toBe(3_000_000);

    const over = await put(me.token, { data: `${largest}AAAA` });
    expect(over.status).toBe(413);
    expect(over.body.error).toBe('SAVE_TOO_LARGE');
    // A body far past any save is refused on its length alone.
    const huge = await put(me.token, { data: 'A'.repeat(5_000_000) });
    expect(huge.status).toBe(413);
    expect(huge.body.error).toBe('SAVE_TOO_LARGE');
    expect((await get(me.token, '?data=false')).body.size).toBe(3_000_000);
  });

  it('refuses a malformed body or a bad description, version or play time', async () => {
    const me = await player();
    const raw = await fetch(`${base}/api/saves/me`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${me.token}`,
      },
      body: '{"data": "AAAA"',
    });
    expect(raw.status).toBe(400);
    for (const body of [
      { data: 'AAAA', description: 'x'.repeat(201) },
      { data: 'AAAA', gameVersion: 'latest' },
      { data: 'AAAA', playSeconds: -1 },
      { data: 'AAAA', playSeconds: 10_000_000_001 },
      { description: 'no data' },
    ])
      expect((await put(me.token, body)).status).toBe(400);
    expect(
      (await put(me.token, { data: 'AAAA', playSeconds: 10_000_000_000 })).body
        .playSeconds,
    ).toBe(10_000_000_000);
  });

  it('is deleted with the account', async () => {
    const me = await player();
    await put(me.token, { data: b64(awkwardBytes()) });
    expect(await stored(me.id)).toHaveLength(1);
    const deleted = await call(base, 'POST', '/api/account/delete', {
      token: me.token,
      body: { password: 'a long enough password' },
    });
    expect(deleted.status).toBe(200);
    expect(await stored(me.id)).toHaveLength(0);
  });
});

describe('the write limit', () => {
  it('takes 240 writes an hour from one caller, then answers 429', async () => {
    const me = await player();
    // Its own address, so no other test's writes count against it.
    const from = {
      'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    };
    const statuses: number[] = [];
    for (let i = 0; i < 241; i++)
      statuses.push((await put(me.token, { data: 'AAAA' }, from)).status);
    expect(statuses.slice(0, 240).every((status) => status === 200)).toBe(true);
    expect(statuses[240]).toBe(429);
    // Reading is not a write.
    expect((await get(me.token)).status).toBe(200);
  });
});
