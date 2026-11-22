import { useEffect } from 'react';
import { PLAY_URL } from '../links.js';
import { Link } from '../router.js';

const SHOTS = [
  ['v116-01-boss', 'A boss fight in the crypts'],
  ['v116-02-pack', 'A marked pack charging'],
  ['v116-03-hideout', 'The Hideout, every trader by the fire'],
  ['v116-04-atlas', 'The atlas of the Old Kingdom'],
  ['v116-05-pit', 'A floor of the Bone Pit'],
  ['v116-06-talents', 'The talent tree'],
  ['v116-07-character', 'The character sheet'],
  ['v116-08-bag', 'The bag and the paper doll'],
] as const;

const FEATURES: readonly (readonly [string, string])[] = [
  [
    'Four acts, the whole story',
    "Ashfall and its crypts, the buried city of lamps, the Silent Sea with the Halcyon, a galley frozen into the ice, and Act IV, The Name Below: camp at the Hearth and walk Gravoth's back, the First City between its ribs, its throat and its heart.",
  ],
  [
    'The endgame, Charts of the Old Kingdom',
    "Charts drop as loot, each with a tier, up to four modifiers and three lives. Open them at the Chart Table, uncover a 48-place atlas, spend atlas points on a tree that shapes your maps, and meet each act's boss again in his hall. Loot climbs to item level 130, with a seventh affix tier and chart uniques.",
  ],
  [
    'The Hideout',
    'Once Gravoth has fallen, travel from anywhere to a small courtyard with every trader, the smith, the stash, the sell-swords and a Chart Table a few steps from the fire.',
  ],
  [
    'Walk the world without loading screens',
    'Neighbouring zones join, so you cross from one into the next on foot.',
  ],
  [
    'Five hero styles',
    'Melee, bows, spells, void and minions, a talent tree of over 300 nodes and twenty-three ascendancy rites. Combine any rites you like, whatever their style: win the trials and hold three at once. Full build stats on the Character page show every number behind your hero.',
  ],
  [
    'Monsters that fight back with a plan',
    'Marked members of every pack charge, slam, poison the ground or burst when they die. Champions, named monsters and bosses each have their own rules.',
  ],
  [
    'The Bone Pit',
    'An endless descent of generated dungeon floors, each sealed by a Keeper, harder the deeper you go, with a boss every five floors.',
  ],
  [
    'Loot that matters',
    'Magic, rare and unique items with build-changing powers, a forge to add, raise or remove an affix, a gambler and a stash with tabs, and a sell-sword at your side who wears the gear you give.',
  ],
];

/** gravoth.petarzarkov.com's home: what the game is, its screenshots, the Play link, and the way to the boards. */
export const LandingPage = () => {
  useEffect(() => {
    document.title = 'Gravoth: a dark-fantasy action RPG for Android';
  }, []);

  return (
    <div className="landing">
      <section className="hero">
        <img
          className="hero-art"
          src="/img/feature-1024x500.jpg"
          alt="Gravoth: a hero in the crypts under Ashfall"
          width={1024}
          height={500}
        />
        <div className="hero-copy">
          <h1 className="hero-title">Gravoth</h1>
          <p className="hero-sub">
            A dark-fantasy action RPG for Android phones
          </p>
          <div className="row-buttons">
            <a className="button button-primary" href={PLAY_URL}>
              Get it on Google Play
            </a>
            <Link to="/boards" className="button">
              See the leaderboards
            </Link>
          </div>
        </div>
      </section>

      <section className="panel prose">
        <h2>What Gravoth is</h2>
        <p>
          The dead are walking the roads around Ashfall, and the one you love
          was carried past them, further down. Gravoth is a single-player action
          RPG made for phones, with thumb-sized controls, landscape play and a
          story you follow below ground, one act at a time.
        </p>
        <p>
          Fight through the crypts under Ashfall, the buried city of lamps
          beneath them and the Silent Sea, a frozen ocean deep under the world,
          then go down into Gravoth itself and end the story by speaking its
          name. After the story the endgame begins: charts of the Old Kingdom, a
          48-place atlas, and every act's boss waiting in his hall for a
          rematch. Build a classless hero from five styles, swear three
          ascendancy rites, forge your gear and hire a sell-sword to fight
          beside you.
        </p>
      </section>

      <section className="shots" aria-label="Screenshots">
        {SHOTS.map(([file, alt]) => (
          <a key={file} href={`/img/${file}.jpg`} className="shot">
            <img src={`/img/${file}.jpg`} alt={alt} loading="lazy" />
          </a>
        ))}
      </section>

      <section className="features">
        {FEATURES.map(([title, text]) => (
          <article key={title} className="panel feature">
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="panel prose">
        <h2>Offline first, no ads</h2>
        <p>
          Gravoth plays fully offline. There are no ads and nothing pay-to-win.
          Optional supporter packs through Google Play are thank-yous with a
          cosmetic item to wear and no gameplay advantage; they help one
          developer keep making it. Your progress is saved on your phone.
        </p>
        <p>
          Gravoth Online is optional: sign in with the same account as in the
          game to put your records on the <Link to="/boards">leaderboards</Link>
          , each with the whole build that set it, and to keep a friends list.
        </p>
        <p className="muted small">
          What the game does and does not collect:{' '}
          <a href="/privacy/">privacy policy</a>. To delete an account:{' '}
          <Link to="/delete-account">delete your account</Link>.
        </p>
      </section>
    </div>
  );
};
