/**
 * `bun run test [bun test arguments]`: starts Postgres from compose.yml under its own project name and port, runs the
 * suites against it, and removes it again (container and volume), whatever the suites' result. With TEST_DATABASE_URL
 * already set (a Postgres of your own), it runs the suites against that and starts nothing.
 */
const project = 'gravoth-server-test';
const port = Bun.env['TEST_POSTGRES_PORT'] ?? '55432';
const compose = ['docker', 'compose', '-p', project, '-f', 'compose.yml'];
const cwd = `${import.meta.dir}/..`;

const run = async (
  command: string[],
  env: Record<string, string | undefined> = Bun.env,
): Promise<number> => {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  return child.exited;
};

const args = process.argv.slice(2);
let url = Bun.env['TEST_DATABASE_URL'];
const ownDatabase = url === undefined || url === '';

if (ownDatabase) {
  const up = await run(
    [...compose, 'up', '--detach', '--wait', '--quiet-pull', 'postgres'],
    { ...Bun.env, POSTGRES_PORT: port },
  );
  if (up !== 0) {
    console.error(
      'could not start Postgres from compose.yml (is Docker running?)',
    );
    process.exit(up);
  }
  url = `postgres://gravoth:gravoth-local@127.0.0.1:${port}/gravoth`;
}

let code = 1;
try {
  code = await run(['bun', 'test', ...args], {
    ...Bun.env,
    TEST_DATABASE_URL: url,
  });
} finally {
  if (ownDatabase)
    await run([...compose, 'down', '--volumes', '--remove-orphans'], {
      ...Bun.env,
      POSTGRES_PORT: port,
    });
}
process.exit(code);
