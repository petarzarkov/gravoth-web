import { createTheme, type MantineColorsTuple } from '@mantine/core';

/**
 * The website's Mantine theme, in the game's own palette (Gravoth.Game: Ui.Gold, Ui.Muted, Ui.Panel and
 * LootColors), always dark.
 */
const gold: MantineColorsTuple = [
  '#fff8e6',
  '#ffefc7',
  '#ffe39e',
  '#ffd775',
  '#ffcd5c',
  '#ffc759',
  '#e6ad3f',
  '#c9952f',
  '#a67a22',
  '#805c16',
];

/** Mantine's dark scale: [0] is the text, [7] the page, [6] the cards, [4] the borders. */
const dark: MantineColorsTuple = [
  '#ebe6dc',
  '#c9c3b8',
  '#a8a194',
  '#7a7468',
  '#3a353d',
  '#2a262d',
  '#161418',
  '#0c0a0d',
  '#09080a',
  '#060507',
];

export const theme = createTheme({
  primaryColor: 'gold',
  primaryShade: 5,
  autoContrast: true,
  colors: { gold, dark },
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  headings: {
    fontFamily:
      "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
    fontWeight: '600',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Card: { defaultProps: { withBorder: true, padding: 'lg', radius: 'md' } },
    Paper: { defaultProps: { radius: 'md' } },
    Badge: { defaultProps: { variant: 'outline', radius: 'xl' } },
  },
});
