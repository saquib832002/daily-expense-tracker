import { useColorScheme } from 'react-native';

/**
 * Design tokens.
 *
 * Phase 1 uses plain StyleSheet rather than NativeWind, deliberately: the goal
 * of this phase is a green build on Windows, and a styling library is one more
 * babel/metro integration that can go wrong before there is anything to style.
 * Every colour and size is a token here, so moving to NativeWind in Phase 2 is
 * a mechanical change rather than a rewrite.
 */

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textDim: string;
  border: string;
  accent: string;
  accentSoft: string;
  expense: string;
  income: string;
  warn: string;
  danger: string;
  onAccent: string;
  /**
   * The home screen's hero card. It is the one surface on the whole app that
   * is allowed to be tinted — everything else is `surface` — because a
   * dashboard needs exactly one place the eye lands first.
   */
  heroBg: string;
  heroDim: string;
  heroTrack: string;
}

const light: Palette = {
  bg: '#F7F6F2',
  surface: '#FFFFFF',
  surfaceAlt: '#F1EFE9',
  text: '#191B1F',
  textDim: '#6B7079',
  border: '#E1DED6',
  accent: '#14574B',
  accentSoft: '#DCEAE5',
  expense: '#993128',
  income: '#14574B',
  warn: '#9A6C10',
  danger: '#993128',
  onAccent: '#FFFFFF',
  heroBg: '#DCEAE5',
  heroDim: '#4A5551',
  heroTrack: '#C2D6CF',
};

const dark: Palette = {
  bg: '#101215',
  surface: '#171A1E',
  surfaceAlt: '#1D2126',
  text: '#E8E6E0',
  textDim: '#8E949D',
  border: '#2A2E34',
  accent: '#57BFA8',
  accentSoft: '#16302C',
  expense: '#DB8074',
  income: '#57BFA8',
  warn: '#D6A648',
  danger: '#DB8074',
  onAccent: '#0B1512',
  heroBg: '#16302C',
  heroDim: '#9BA8A3',
  heroTrack: '#24443E',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const type = {
  display: 40,
  title: 22,
  body: 16,
  small: 13,
  tiny: 11,
} as const;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export { dark, light };
