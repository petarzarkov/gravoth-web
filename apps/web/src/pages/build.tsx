import type {
  BuildCard,
  CardPage,
  GearItem,
  SkillGem,
} from '@gravoth/contracts';
import { ITEM_SLOTS } from '@gravoth/contracts/constants';
import { api } from '../api.js';
import {
  ClassBadge,
  Empty,
  HardcoreBadge,
  Loaded,
  Panel,
} from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import {
  CLASS_NAMES,
  SLOT_NAMES,
  formatCompact,
  formatDate,
  titleOf,
} from '../format.js';

const Stat = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) => (
  <div className={accent === true ? 'stat stat-accent' : 'stat'}>
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </div>
);

const Sheet = ({ build }: { build: BuildCard }) => {
  const s = build.summary;
  const resists = s.resistances;
  return (
    <Panel title="Sheet">
      <div className="stats">
        <Stat label="DPS" value={formatCompact(s.dps)} accent />
        <Stat label="Clear DPS" value={formatCompact(s.clearDps)} />
        <Stat label="Effective HP" value={formatCompact(s.ehp)} accent />
        <Stat label="Life" value={s.life.toLocaleString('en-US')} />
        {s.energyShield > 0 ? (
          <Stat
            label="Energy shield"
            value={s.energyShield.toLocaleString('en-US')}
          />
        ) : null}
        {s.mana === undefined ? null : (
          <Stat label="Mana" value={s.mana.toLocaleString('en-US')} />
        )}
        {s.armour === undefined ? null : (
          <Stat label="Armour" value={formatCompact(s.armour)} />
        )}
        {s.evasion === undefined ? null : (
          <Stat label="Evasion" value={formatCompact(s.evasion)} />
        )}
        {s.blockPercent === undefined ? null : (
          <Stat label="Block" value={`${Math.round(s.blockPercent)}%`} />
        )}
      </div>
      {resists === undefined ? null : (
        <div className="resists" aria-label="Resistances">
          <span className="resist resist-fire">
            Fire {Math.round(resists.fire)}%
          </span>
          <span className="resist resist-cold">
            Cold {Math.round(resists.cold)}%
          </span>
          <span className="resist resist-lightning">
            Lightning {Math.round(resists.lightning)}%
          </span>
          <span className="resist resist-chaos">
            Chaos {Math.round(resists.chaos)}%
          </span>
        </div>
      )}
    </Panel>
  );
};

const Skill = ({ skill }: { skill: SkillGem }) => (
  <li className="skill">
    <div className="skill-head">
      <span className="skill-name">{titleOf(skill.id, skill.name)}</span>
      <span className="skill-level">
        Lv {skill.level}
        {skill.quality === undefined || skill.quality === 0
          ? ''
          : ` · ${skill.quality}%`}
      </span>
    </div>
    {skill.supports.length === 0 ? null : (
      <ul className="supports">
        {skill.supports.map((support) => (
          <li key={support.id} className="support">
            {titleOf(support.id, support.name)}{' '}
            <span className="support-level">{support.level}</span>
          </li>
        ))}
      </ul>
    )}
  </li>
);

const Skills = ({ build }: { build: BuildCard }) => {
  const skills = [...build.skills].sort(
    (a, b) => (a.slot ?? 99) - (b.slot ?? 99),
  );
  return (
    <Panel title="Skills">
      {skills.length === 0 ? (
        <Empty>No skills.</Empty>
      ) : (
        <ul className="skills">
          {skills.map((skill) => (
            <Skill key={`${skill.id}:${skill.slot}`} skill={skill} />
          ))}
        </ul>
      )}
      {build.auras.length === 0 ? null : (
        <div className="auras">
          <h3>Auras</h3>
          <ul>
            {build.auras.map((aura) => (
              <li key={aura.id}>
                {titleOf(aura.id, aura.name)}{' '}
                <span className="support-level">{aura.level}</span>
                {aura.reservedPercent === undefined ? null : (
                  <span className="muted">
                    {' '}
                    · {Math.round(aura.reservedPercent)}% reserved
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
};

const Item = ({ item }: { item: GearItem }) => (
  <article className={`item rarity-${item.rarity.toLowerCase()}`}>
    <header className="item-head">
      <span className="item-slot">{SLOT_NAMES[item.slot] ?? item.slot}</span>
      <h3 className="item-name">{item.name}</h3>
      {item.rarity === 'Normal' || item.name === item.base ? null : (
        <span className="item-base">{item.base}</span>
      )}
    </header>
    <p className="item-meta">
      Item level {item.itemLevel}
      {item.quality === undefined || item.quality === 0
        ? ''
        : ` · Quality ${item.quality}%`}
      {item.sockets === undefined || item.sockets === 0
        ? ''
        : ` · ${item.sockets} socket${item.sockets === 1 ? '' : 's'}`}
    </p>
    {item.lines.length === 0 ? null : (
      <ul className="item-lines">
        {item.lines.map((line, index) => (
          <li key={index} className={`line line-${line.kind ?? 'plain'}`}>
            {line.text}
            {line.tier === undefined ? null : (
              <span className="line-tier">T{line.tier}</span>
            )}
          </li>
        ))}
      </ul>
    )}
    {item.corrupted === true ? (
      <p className="item-corrupted">Corrupted</p>
    ) : null}
  </article>
);

const Gear = ({ build }: { build: BuildCard }) => {
  const order = (slot: string) => {
    const index = (ITEM_SLOTS as readonly string[]).indexOf(slot);
    return index === -1 ? 99 : index;
  };
  const gear = [...build.gear].sort((a, b) => order(a.slot) - order(b.slot));
  return (
    <Panel title="Gear">
      {gear.length === 0 ? (
        <Empty>No gear.</Empty>
      ) : (
        <div className="gear">
          {gear.map((item) => (
            <Item key={item.slot} item={item} />
          ))}
        </div>
      )}
    </Panel>
  );
};

/** The rules checker's own pages, when it has read this build's save. */
const CheckerCard = ({ pages }: { pages: CardPage[] }) => (
  <Panel title="Rules checker">
    <div className="checker">
      {pages.map((page) => (
        <div key={page.title} className="checker-page">
          <h3>{page.title}</h3>
          {page.sections.map((section) => (
            <dl key={section.title} className="checker-section">
              <dt className="checker-section-title">{section.title}</dt>
              {section.rows.map((row) => (
                <div key={row.label} className="checker-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      ))}
    </div>
  </Panel>
);

const documentSize = (value: Record<string, unknown>): number =>
  Object.keys(value).length;

export const BuildPage = ({ id }: { id: string }) => {
  const [build, reload] = useLoad(id, () => api.build(id));
  return (
    <Loaded load={build} retry={reload}>
      {(card) => (
        <>
          <PageTitle
            title={card.hero.name}
            sub={
              <span className="build-sub">
                <ClassBadge heroClass={card.hero.class} />
                {card.hero.hardcore ? <HardcoreBadge /> : null}
                <span>
                  Level {card.level}{' '}
                  {card.ascendancy ?? CLASS_NAMES[card.hero.class]}
                </span>
                <span className="muted">
                  {card.player === null
                    ? 'Hidden player'
                    : card.player.displayName}
                </span>
              </span>
            }
          >
            <button
              type="button"
              className="button button-quiet"
              onClick={() =>
                void navigator.clipboard?.writeText(window.location.href)
              }
            >
              Copy link
            </button>
          </PageTitle>
          <p className="build-meta muted">
            Build {card.revision} · game {card.gameVersion} ·{' '}
            {formatDate(card.createdAt)}
          </p>
          <div className="build-grid">
            <div className="build-col">
              <Sheet build={card} />
              <Skills build={card} />
              {documentSize(card.talents) + documentSize(card.atlas) ===
              0 ? null : (
                <Panel title="Talents and atlas">
                  <details className="raw">
                    <summary>As the game sent them</summary>
                    <pre>
                      {JSON.stringify(
                        { talents: card.talents, atlas: card.atlas },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </Panel>
              )}
            </div>
            <div className="build-col build-col-wide">
              <Gear build={card} />
              {card.card === null || card.card.length === 0 ? null : (
                <CheckerCard pages={card.card} />
              )}
            </div>
          </div>
        </>
      )}
    </Loaded>
  );
};
