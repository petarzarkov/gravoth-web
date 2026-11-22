import { AUTH_ROUTES } from '@gravoth/contracts/constants';
import { API_BASE } from './links.js';
import type {
  AccountView,
  BlockView,
  BoardList,
  BoardPage,
  BuildCard,
  CloudSaveDeleted,
  CloudSaveView,
  FriendView,
  HeroClass,
  MetaInfo,
  MyHeroes,
  Neighbourhood,
  Page,
  ProfileView,
  RequestOutcome,
  RequestView,
  SessionView,
  SignInMethods,
  SocialProvider,
  UpdateProfile,
} from '@gravoth/contracts';

/**
 * The API, same origin: the server serves this site, so the session is a
 * first-party cookie and no request is cross-site. Every shape is the
 * contracts' own.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The API's error code (`NAME_TAKEN`), or its message when it has none. */
    readonly code: string,
  ) {
    super(code);
  }
}

/** The code out of an error body: dunx answers `{ error, status }`, better-auth `{ code, message }`. */
export const errorCode = (status: number, body: unknown): string => {
  if (typeof body === 'object' && body !== null) {
    const { code, error, message } = body as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
    };
    for (const value of [code, error, message]) {
      if (typeof value === 'string' && value !== '') return value;
    }
  }
  return `HTTP_${status}`;
};

type Query = Record<string, string | number | boolean | undefined>;

export const withQuery = (path: string, query: Query = {}): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
};

export const request = async <T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> => {
  // `include`: on Cloudflare Pages the API is another origin of the same site, and the session cookie is the API's.
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
  }
  if (!response.ok)
    throw new ApiError(response.status, errorCode(response.status, parsed));
  return parsed as T;
};

const get = <T>(path: string, query?: Query) =>
  request<T>('GET', withQuery(path, query));
const post = <T>(path: string, body: unknown = {}) =>
  request<T>('POST', path, body);

export interface BoardQuery {
  readonly hardcore?: boolean | undefined;
  readonly class?: HeroClass | undefined;
  readonly view?: 'all' | 'friends' | undefined;
  readonly take?: number | undefined;
  readonly cursor?: string | undefined;
  readonly direction?: 'forward' | 'backward' | undefined;
}

export const api = {
  meta: () => get<MetaInfo>('/api/meta'),

  // Boards and builds: public.
  boards: (hardcore: boolean) =>
    get<BoardList>('/api/leaderboards', { hardcore }),
  board: (key: string, query: BoardQuery = {}) =>
    get<BoardPage>(`/api/leaderboards/${encodeURIComponent(key)}`, {
      ...query,
    }),
  aroundMe: (key: string, query: BoardQuery & { around?: number } = {}) =>
    get<Neighbourhood>(`/api/leaderboards/${encodeURIComponent(key)}/me`, {
      hardcore: query.hardcore,
      class: query.class,
      view: query.view,
      around: query.around,
    }),
  build: (id: string) =>
    get<BuildCard>(`/api/builds/${encodeURIComponent(id)}`),

  // The session (better-auth).
  session: () => get<SessionView | null>(AUTH_ROUTES.session),
  methods: () => get<SignInMethods>('/api/account/methods'),
  signIn: (email: string, password: string) =>
    post<unknown>(AUTH_ROUTES.signInEmail, {
      email,
      password,
      rememberMe: true,
    }),
  signUp: (name: string, email: string, password: string) =>
    post<unknown>(AUTH_ROUTES.signUpEmail, { name, email, password }),
  /**
   * Starts a provider's redirect: the answer's `url` is where the browser goes next. The provider comes back to the
   * API, which then sends the browser to these absolute addresses on this site (trusted by the API's CORS_ORIGIN).
   */
  signInSocial: (provider: SocialProvider, next: string) =>
    post<{ url?: string; redirect?: boolean }>(AUTH_ROUTES.signInSocial, {
      provider,
      callbackURL: `${window.location.origin}${next}`,
      errorCallbackURL: `${window.location.origin}/sign-in`,
    }),
  signOut: () => post<unknown>(AUTH_ROUTES.signOut),
  requestPasswordReset: (email: string) =>
    post<unknown>(AUTH_ROUTES.requestPasswordReset, { email }),
  sendVerification: (email: string) =>
    post<unknown>(AUTH_ROUTES.sendVerificationEmail, { email }),

  // The account and the profile.
  account: () => get<AccountView>('/api/account'),
  deleteAccount: (password?: string) =>
    post<{ deleted: true }>(
      '/api/account/delete',
      password === undefined ? {} : { password },
    ),
  profile: () => get<ProfileView>('/api/profile'),
  updateProfile: (changes: UpdateProfile) =>
    request<ProfileView>('PATCH', '/api/profile', changes),
  heroes: () => get<MyHeroes>('/api/heroes'),
  /** The game's cloud save, without its data: what it is, not the save itself. */
  cloudSave: () => get<CloudSaveView>('/api/saves/me', { data: false }),
  deleteCloudSave: () => request<CloudSaveDeleted>('DELETE', '/api/saves/me'),

  // Friends and blocks.
  friends: (cursor?: string) =>
    get<Page<FriendView>>('/api/friends', { take: 100, cursor }),
  incoming: () =>
    get<Page<RequestView>>('/api/friends/requests/incoming', { take: 100 }),
  outgoing: () =>
    get<Page<RequestView>>('/api/friends/requests/outgoing', { take: 100 }),
  askFriend: (displayName: string) =>
    post<RequestOutcome>('/api/friends/requests', { displayName }),
  accept: (id: string) =>
    post<FriendView>(`/api/friends/requests/${id}/accept`),
  decline: (id: string) =>
    post<{ declined: true }>(`/api/friends/requests/${id}/decline`),
  cancel: (id: string) =>
    post<{ cancelled: true }>(`/api/friends/requests/${id}/cancel`),
  unfriend: (userId: string) =>
    post<{ removed: true }>(`/api/friends/${userId}/remove`),
  blocks: () => get<Page<BlockView>>('/api/blocks', { take: 100 }),
  block: (displayName: string) =>
    post<BlockView>('/api/blocks', { displayName }),
  unblock: (userId: string) =>
    post<{ unblocked: true }>(`/api/blocks/${userId}/remove`),
};
