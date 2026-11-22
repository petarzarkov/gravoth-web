import type {
  BuildCard,
  CardPage,
  GearItem,
  SkillGem,
} from '@gravoth/contracts';
import { ITEM_SLOTS } from '@gravoth/contracts/constants';
import {
  Badge,
  Box,
  Button,
  CopyButton,
  Grid,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
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
  <Paper p="sm" bg="dark.7" withBorder>
    <Text
      fz="xl"
      fw={700}
      className="num"
      ta="left"
      {...(accent === true ? { c: 'gold' } : {})}
    >
      {value}
    </Text>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
  </Paper>
);

const Sheet = ({ build }: { build: BuildCard }) => {
  const s = build.summary;
  const resists = s.resistances;
  return (
    <Panel title="Sheet">
      <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="sm">
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
      </SimpleGrid>
      {resists === undefined ? null : (
        <Group gap="xs" mt="md" aria-label="Resistances">
          <Badge color="#ff7a4d">Fire {Math.round(resists.fire)}%</Badge>
          <Badge color="#7fc4ff">Cold {Math.round(resists.cold)}%</Badge>
          <Badge color="#ffe066">
            Lightning {Math.round(resists.lightning)}%
          </Badge>
          <Badge color="#c27cff">Chaos {Math.round(resists.chaos)}%</Badge>
        </Group>
      )}
    </Panel>
  );
};

const Skill = ({ skill }: { skill: SkillGem }) => (
  <Paper className="skill" p="sm" bg="dark.7">
    <Group justify="space-between" gap="sm">
      <Text fw={600}>{titleOf(skill.id, skill.name)}</Text>
      <Text size="sm" c="dimmed" className="num">
        Lv {skill.level}
        {skill.quality === undefined || skill.quality === 0
          ? ''
          : ` · ${skill.quality}%`}
      </Text>
    </Group>
    {skill.supports.length === 0 ? null : (
      <Group gap={6} mt={6}>
        {skill.supports.map((support) => (
          <Badge
            key={support.id}
            variant="light"
            color="blue"
            radius="sm"
            tt="none"
          >
            {titleOf(support.id, support.name)} {support.level}
          </Badge>
        ))}
      </Group>
    )}
  </Paper>
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
        <Stack gap="sm">
          {skills.map((skill) => (
            <Skill key={`${skill.id}:${skill.slot}`} skill={skill} />
          ))}
        </Stack>
      )}
      {build.auras.length === 0 ? null : (
        <Box mt="md">
          <Text size="xs" c="dimmed" tt="uppercase" lts="0.12em" mb={6}>
            Auras
          </Text>
          <Stack gap={4}>
            {build.auras.map((aura) => (
              <Text key={aura.id} size="sm">
                {titleOf(aura.id, aura.name)}{' '}
                <Text span c="dimmed" size="sm">
                  {aura.level}
                  {aura.reservedPercent === undefined
                    ? ''
                    : ` · ${Math.round(aura.reservedPercent)}% reserved`}
                </Text>
              </Text>
            ))}
          </Stack>
        </Box>
      )}
    </Panel>
  );
};

const Item = ({ item }: { item: GearItem }) => (
  <Paper className={`item rarity-${item.rarity.toLowerCase()}`}>
    <Text size="xs" c="dimmed" tt="uppercase" lts="0.14em">
      {SLOT_NAMES[item.slot] ?? item.slot}
    </Text>
    <Title order={3} size="h5" className="item-name">
      {item.name}
    </Title>
    {item.rarity === 'Normal' || item.name === item.base ? null : (
      <Text size="sm" className="item-base">
        {item.base}
      </Text>
    )}
    <Text size="xs" c="dimmed" mt={6}>
      Item level {item.itemLevel}
      {item.quality === undefined || item.quality === 0
        ? ''
        : ` · Quality ${item.quality}%`}
      {item.sockets === undefined || item.sockets === 0
        ? ''
        : ` · ${item.sockets} socket${item.sockets === 1 ? '' : 's'}`}
    </Text>
    {item.lines.length === 0 ? null : (
      <ul className="item-lines">
        {item.lines.map((line, index) => (
          <li key={index} className={`line-${line.kind ?? 'plain'}`}>
            {line.text}
            {line.tier === undefined ? null : (
              <Text span size="xs" c="dimmed" ml={6}>
                T{line.tier}
              </Text>
            )}
          </li>
        ))}
      </ul>
    )}
    {item.corrupted === true ? (
      <Text size="sm" fw={600} mt="xs" className="item-corrupted">
        Corrupted
      </Text>
    ) : null}
  </Paper>
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
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          {gear.map((item) => (
            <Item key={item.slot} item={item} />
          ))}
        </SimpleGrid>
      )}
    </Panel>
  );
};

/** The rules checker's own pages, when it has read this build's save. */
const CheckerCard = ({ pages }: { pages: CardPage[] }) => (
  <Panel title="Rules checker">
    <Stack gap="md">
      {pages.map((page) => (
        <Box key={page.title}>
          <Title order={3} size="h5" mb="xs">
            {page.title}
          </Title>
          {page.sections.map((section) => (
            <Box key={section.title} mb="sm">
              <Text size="xs" c="dimmed" tt="uppercase" lts="0.12em">
                {section.title}
              </Text>
              <Table verticalSpacing={4}>
                <Table.Tbody>
                  {section.rows.map((row) => (
                    <Table.Tr key={row.label}>
                      <Table.Td c="dimmed">{row.label}</Table.Td>
                      <Table.Td className="num">{row.value}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          ))}
        </Box>
      ))}
    </Stack>
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
              <Group gap="sm">
                <ClassBadge heroClass={card.hero.class} />
                {card.hero.hardcore ? <HardcoreBadge /> : null}
                <Text span>
                  Level {card.level}{' '}
                  {card.ascendancy ?? CLASS_NAMES[card.hero.class]}
                </Text>
                <Text span c="dimmed">
                  {card.player === null
                    ? 'A hidden player'
                    : card.player.displayName}
                </Text>
              </Group>
            }
          >
            <CopyButton value={window.location.href}>
              {({ copied, copy }) => (
                <Button variant="default" onClick={copy}>
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              )}
            </CopyButton>
          </PageTitle>
          <Text size="sm" c="dimmed" mt={-8} mb="lg">
            Build {card.revision} · game {card.gameVersion} ·{' '}
            {formatDate(card.createdAt)}
          </Text>
          <Grid gap="lg">
            <Grid.Col span={{ base: 12, md: 5 }}>
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
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Gear build={card} />
              {card.card === null || card.card.length === 0 ? null : (
                <CheckerCard pages={card.card} />
              )}
            </Grid.Col>
          </Grid>
        </>
      )}
    </Loaded>
  );
};
