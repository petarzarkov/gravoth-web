import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Empty } from './components/bits.js';
import { Layout, PageTitle } from './components/layout.js';
import { AccountPage } from './pages/account.js';
import { BoardPage } from './pages/board.js';
import { BuildPage } from './pages/build.js';
import { FriendsPage } from './pages/friends.js';
import { BoardsPage } from './pages/home.js';
import { DeleteAccountPage } from './pages/delete-account.js';
import { LandingPage } from './pages/landing.js';
import { SignInPage } from './pages/sign-in.js';
import { Link, Router, Routes, type RouteDefinition } from './router.js';
import { SessionProvider } from './session.js';

const routes: readonly RouteDefinition[] = [
  { pattern: '/', render: () => <LandingPage /> },
  { pattern: '/boards', render: () => <BoardsPage /> },
  {
    pattern: '/boards/:key',
    render: ({ key }) => <BoardPage key={key} boardKey={key ?? ''} />,
  },
  {
    pattern: '/builds/:id',
    render: ({ id }) => <BuildPage key={id} id={id ?? ''} />,
  },
  { pattern: '/sign-in', render: () => <SignInPage /> },
  { pattern: '/account', render: () => <AccountPage /> },
  { pattern: '/friends', render: () => <FriendsPage /> },
  { pattern: '/delete-account', render: () => <DeleteAccountPage /> },
];

const NotFound = () => (
  <>
    <PageTitle title="Not here" />
    <Empty>
      Nothing at this address. <Link to="/">Back to the start</Link>.
    </Empty>
  </>
);

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <Router>
      <SessionProvider>
        <Layout>
          <Routes routes={routes} fallback={<NotFound />} />
        </Layout>
      </SessionProvider>
    </Router>
  </StrictMode>,
);
