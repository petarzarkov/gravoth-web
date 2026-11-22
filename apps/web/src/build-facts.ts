import type { BuildDocument } from '@gravoth/contracts';
import {
  AVATAR_BORDER_NAMES,
  avatarBorderOf,
} from '@gravoth/contracts/constants';
import { titleOf } from './format.js';

/**
 * What a build's free documents say, read for the build card: the talents, the atlas and the extras are the game's
 * own JSON (`BuildSnapshotJson.cs` in the game's repository), so every field is read as maybe absent or another shape,
 * and a field this site does not know is left to the raw view.
 */
export interface FactRow {
  readonly label: string;
  readonly value: string;
}

export interface FactSection {
  readonly title: string;
  readonly rows: readonly FactRow[];
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const asList = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const asDocument = (value: unknown): BuildDocument | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as BuildDocument)
    : undefined;

const count = (value: number): string => value.toLocaleString('en-US');

/** An id the game sent, named when it sent a name: `blade_vortex` reads `Blade Vortex`. */
const named = (id: unknown, name?: unknown): string | undefined => {
  const key = asText(id);
  return key === undefined ? asText(name) : titleOf(key, asText(name));
};

const row = (label: string, value: string | undefined): FactRow[] =>
  value === undefined ? [] : [{ label, value }];

/** The sections the build card shows beside the sheet, skills and gear; a section with no rows is left out. */
export const buildFacts = (build: {
  readonly talents: BuildDocument;
  readonly atlas: BuildDocument;
  readonly extras: BuildDocument;
}): FactSection[] => {
  const { talents, atlas, extras } = build;

  const spent = asNumber(talents['points']);
  const earned = asNumber(talents['earned']);
  const nodes = asList(talents['nodes']).length;
  const carvings = asDocument(extras['carvings']);
  const carvingPoints = asNumber(carvings?.['points']);
  const marks = asNumber(extras['marks']);
  const overlevels = asNumber(extras['overlevels']);
  const progress: FactRow[] = [
    ...row(
      'Talent points',
      spent === undefined
        ? undefined
        : earned === undefined
          ? count(spent)
          : `${count(spent)} of ${count(earned)}`,
    ),
    ...row('Talents taken', nodes === 0 ? undefined : count(nodes)),
    ...row(
      'Carvings',
      carvingPoints === undefined
        ? undefined
        : `${count(carvingPoints)} points`,
    ),
    ...row('Marks', marks === undefined ? undefined : count(marks)),
    ...row(
      'Overlevels',
      overlevels === undefined || overlevels === 0
        ? undefined
        : count(overlevels),
    ),
  ];

  const highest = asNumber(atlas['highestTier']);
  const cleared = asNumber(atlas['cleared']);
  const chartsRun = asNumber(atlas['chartsRun']);
  const atlasTree = asList(atlas['tree']).length;
  const atlasRows: FactRow[] = [
    ...row(
      'Highest tier',
      highest === undefined || highest === 0 ? undefined : `T${highest}`,
    ),
    ...row(
      'Places cleared',
      cleared === undefined ? undefined : count(cleared),
    ),
    ...row(
      'Charts run',
      chartsRun === undefined ? undefined : count(chartsRun),
    ),
    ...row('Atlas nodes', atlasTree === 0 ? undefined : count(atlasTree)),
  ];

  const attributes = asDocument(extras['attributes']) ?? {};
  const attributeRows: FactRow[] = Object.entries(attributes).flatMap(
    ([key, value]) => {
      const total = asNumber(value);
      return total === undefined
        ? []
        : [{ label: titleOf(key), value: count(Math.round(total)) }];
    },
  );

  const skillRows: FactRow[] = [
    ...row('Main skill', named(extras['mainSkill'])),
    ...row('Movement', named(extras['movement'])),
  ];

  const riteRows: FactRow[] = asList(extras['rites']).flatMap((value) => {
    const rite = asDocument(value);
    const name = named(rite?.['id'], rite?.['name']);
    if (rite === undefined || name === undefined) return [];
    const slot = asNumber(rite['slot']);
    const taken = asList(rite['nodes']).length;
    return [
      {
        label: slot === undefined ? 'Rite' : `Rite ${slot}`,
        value:
          taken === 0
            ? name
            : `${name} · ${count(taken)} node${taken === 1 ? '' : 's'}`,
      },
    ];
  });
  const borrowed = named(extras['borrowedRite']);
  if (borrowed !== undefined)
    riteRows.push({ label: 'Borrowed rite', value: borrowed });

  const border = avatarBorderOf(extras['border']);
  const lookRows: FactRow[] = [
    ...row(
      'Avatar border',
      border === null
        ? undefined
        : `${AVATAR_BORDER_NAMES[border].name} (${AVATAR_BORDER_NAMES[border].earned})`,
    ),
    ...asList(extras['cosmetics']).flatMap((value) => {
      const worn = asDocument(value);
      const name = named(worn?.['id'], worn?.['name']);
      return name === undefined
        ? []
        : [{ label: asText(worn?.['slot']) ?? 'Cosmetic', value: name }];
    }),
  ];

  return [
    { title: 'Progress', rows: progress },
    { title: 'Attributes', rows: attributeRows },
    { title: 'Skills in use', rows: skillRows },
    { title: 'Ascendancy', rows: riteRows },
    { title: 'Atlas', rows: atlasRows },
    { title: 'Look', rows: lookRows },
  ].filter((section) => section.rows.length > 0);
};
