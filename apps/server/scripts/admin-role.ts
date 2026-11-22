/**
 * `bun run admin:grant <displayName>` and `bun run admin:revoke <displayName>` (in the image:
 * `docker exec gravoth-api bun run admin:grant <displayName>`): gives or takes the `admin` role, which the moderation
 * routes (`/api/admin/chat`) and the website's /admin/chat need (decision 228). better-auth's `admin` plugin keeps a
 * user's roles in `users.role`, comma-separated; the role counts from the player's next request, since every request
 * reads the user afresh. Reads the database the app reads (DATABASE_URL or the POSTGRES_* parts, config.ts), never
 * boots the app, and prints the player's name and id only.
 */
import { SQL } from 'bun';
import { validate } from '../src/config.js';

const ROLE = 'admin';
const [action, displayName] = process.argv.slice(2);
if ((action !== 'grant' && action !== 'revoke') || !displayName) {
  console.error(
    'usage: bun run admin:grant <displayName> | bun run admin:revoke <displayName>',
  );
  process.exit(2);
}

const sql = new SQL(validate(Bun.env).database.url, { max: 1 });
let code = 0;
try {
  const [player] = (await sql`
    SELECT u.id, u.role, u.is_anonymous, p.display_name
    FROM profiles p JOIN users u ON u.id = p.user_id
    WHERE lower(p.display_name) = lower(${displayName})`) as {
    id: string;
    role: string | null;
    is_anonymous: boolean | null;
    display_name: string;
  }[];
  if (player === undefined) {
    console.error(`no player is named ${displayName}`);
    code = 1;
  } else if (player.is_anonymous === true) {
    console.error(`${player.display_name} is a guest; a guest cannot moderate`);
    code = 1;
  } else {
    const roles = new Set(
      (player.role ?? '')
        .split(',')
        .map((role) => role.trim())
        .filter((role) => role !== ''),
    );
    if (action === 'grant') roles.add(ROLE);
    else roles.delete(ROLE);
    const role = roles.size === 0 ? null : [...roles].sort().join(',');
    await sql`UPDATE users SET role = ${role}, updated_at = now() WHERE id = ${player.id}`;
    console.log(
      `${player.display_name} (${player.id}) ${action === 'grant' ? 'is now' : 'is no longer'} an admin`,
    );
  }
} finally {
  await sql.close();
}
process.exit(code);
