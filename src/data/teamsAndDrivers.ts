export type TeamId =
  | 'mercedes'
  | 'redbull'
  | 'mclaren'
  | 'ferrari'
  | 'racingbulls'
  | 'alpine';

export interface TeamConfig {
  id: TeamId;
  name: string;
  shortName: string;
  primaryColor: string;
  uiColor: string;
  secondaryColor: string;
  accentColor: string;
  carbonColor: string;
  wheelAccentColor: string;
  points2026: number;
  wins2026: number;
  standing2026: number;
  carPerf: number; // 0.94 - 1.02 relative baseline
  summary2026: string;
}

export interface HelmetPalette {
  shell: string;
  stripe: string;
  visor: string;
}

export interface DriverConfig {
  id: string;
  name: string;
  code: string;
  number: number;
  country: string;
  countryCode: string;
  flag: string;
  teamId: TeamId;
  playable: boolean;
  isFlexStar?: boolean;
  flexTeams?: TeamId[];
  points2026: number;
  wins2026: number;
  standing2026: number;
  pace: number; // 80 - 99
  overtaking: number;
  tireManagement: number;
  consistency: number;
  helmet: HelmetPalette;
  portraitBase: string;
  tagline: string;
}

export const TEAMS: Record<TeamId, TeamConfig> = {
  mercedes: {
    id: 'mercedes',
    name: 'Mercedes-AMG Petronas',
    shortName: 'Mercedes',
    primaryColor: '#00D2BE',
    uiColor: '#00E5CE',
    secondaryColor: '#C8CFD6',
    accentColor: '#00F5DF',
    carbonColor: '#13181C',
    wheelAccentColor: '#00D2BE',
    points2026: 652,
    wins2026: 12,
    standing2026: 1,
    carPerf: 1.015,
    summary2026: '2026 Constructors Champions — dominant 2026 power unit & active aero package',
  },
  ferrari: {
    id: 'ferrari',
    name: 'Scuderia Ferrari',
    shortName: 'Ferrari',
    primaryColor: '#E8002D',
    uiColor: '#FF2848',
    secondaryColor: '#FFF200',
    accentColor: '#FF2A4D',
    carbonColor: '#161114',
    wheelAccentColor: '#E8002D',
    points2026: 512,
    wins2026: 2,
    standing2026: 2,
    carPerf: 1.003,
    summary2026: 'Strong straight-line speed led by Hamilton & Leclerc',
  },
  redbull: {
    id: 'redbull',
    name: 'Oracle Red Bull Racing',
    shortName: 'Red Bull',
    primaryColor: '#1F3270',
    uiColor: '#FF2E4C',
    secondaryColor: '#FF1E1E',
    accentColor: '#FFD700',
    carbonColor: '#0D1021',
    wheelAccentColor: '#FFD700',
    points2026: 415,
    wins2026: 3,
    standing2026: 3,
    carPerf: 1.008,
    summary2026: 'Razor-sharp cornering balance with Verstappen leading P2 title charge',
  },
  mclaren: {
    id: 'mclaren',
    name: 'McLaren Formula 1 Team',
    shortName: 'McLaren',
    primaryColor: '#FF8000',
    uiColor: '#FF8A14',
    secondaryColor: '#47C7FC',
    accentColor: '#FF9B33',
    carbonColor: '#151619',
    wheelAccentColor: '#FF8000',
    points2026: 398,
    wins2026: 3,
    standing2026: 4,
    carPerf: 1.004,
    summary2026: 'Papaya pace-setter carrying the #1 plate with Norris & Piastri',
  },
  racingbulls: {
    id: 'racingbulls',
    name: 'Visa Cash App Racing Bulls',
    shortName: 'Racing Bulls',
    primaryColor: '#2B45C7',
    uiColor: '#4F75FF',
    secondaryColor: '#F4F6FA',
    accentColor: '#E10600',
    carbonColor: '#141826',
    wheelAccentColor: '#F4F6FA',
    points2026: 112,
    wins2026: 0,
    standing2026: 5,
    carPerf: 0.968,
    summary2026: 'Leading the 2026 midfield charge',
  },
  alpine: {
    id: 'alpine',
    name: 'BWT Alpine F1 Team',
    shortName: 'Alpine',
    primaryColor: '#0093CC',
    uiColor: '#29B6F6',
    secondaryColor: '#FF87BC',
    accentColor: '#FF87BC',
    carbonColor: '#121820',
    wheelAccentColor: '#FF87BC',
    points2026: 69,
    wins2026: 0,
    standing2026: 6,
    carPerf: 0.958,
    summary2026: 'Clean aero efficiency fighting for top-10 points',
  },
};

export const YAHIA_DRIVER: DriverConfig = {
  id: 'yahia',
  name: 'Yahia Samy',
  code: 'SAM',
  number: 17,
  country: 'Egypt',
  countryCode: 'EGY',
  flag: '🇪🇬',
  teamId: 'mercedes',
  playable: true,
  isFlexStar: true,
  flexTeams: ['mercedes', 'redbull', 'mclaren'],
  points2026: 0,
  wins2026: 0,
  standing2026: 1,
  pace: 96,
  overtaking: 97,
  tireManagement: 94,
  consistency: 95,
  helmet: {
    shell: '#11141C',
    stripe: '#FFD700',
    visor: '#00E5FF',
  },
  portraitBase: 'yahia',
  tagline: 'Egyptian Rookie Phenomenon • Flex Star Seat (#17)',
};

export const MARIAM_DRIVER: DriverConfig = {
  id: 'mariam',
  name: 'Mariam Samy',
  code: 'MAR',
  number: 19,
  country: 'Egypt',
  countryCode: 'EGY',
  flag: '🇪🇬',
  teamId: 'mclaren',
  playable: true,
  isFlexStar: true,
  flexTeams: ['mercedes', 'redbull', 'mclaren'],
  points2026: 0,
  wins2026: 0,
  standing2026: 1,
  pace: 96,
  overtaking: 96,
  tireManagement: 95,
  consistency: 96,
  helmet: {
    shell: '#141722',
    stripe: '#FF66C4',
    visor: '#FFD700',
  },
  portraitBase: 'mariam',
  tagline: 'Egyptian Rising Star • Flex Star Seat (#19)',
};

export const REAL_DRIVERS: DriverConfig[] = [
  {
    id: 'antonelli',
    name: 'Kimi Antonelli',
    code: 'ANT',
    number: 12,
    country: 'Italy',
    countryCode: 'ITA',
    flag: '🇮🇹',
    teamId: 'mercedes',
    playable: true,
    points2026: 390,
    wins2026: 9,
    standing2026: 1,
    pace: 98,
    overtaking: 95,
    tireManagement: 95,
    consistency: 97,
    helmet: {
      shell: '#0E2438',
      stripe: '#00D2BE',
      visor: '#1E88E5',
    },
    portraitBase: 'antonelli',
    tagline: '2026 World Champion — Youngest champion in F1 history',
  },
  {
    id: 'verstappen',
    name: 'Max Verstappen',
    code: 'VER',
    number: 3,
    country: 'Netherlands',
    countryCode: 'NED',
    flag: '🇳🇱',
    teamId: 'redbull',
    playable: true,
    points2026: 279,
    wins2026: 3,
    standing2026: 2,
    pace: 97,
    overtaking: 98,
    tireManagement: 96,
    consistency: 96,
    helmet: {
      shell: '#F4F6FA',
      stripe: '#FF1E1E',
      visor: '#FFD700',
    },
    portraitBase: 'verstappen',
    tagline: '4x Champion fighting P2 in the #3 Red Bull',
  },
  {
    id: 'russell',
    name: 'George Russell',
    code: 'RUS',
    number: 63,
    country: 'United Kingdom',
    countryCode: 'GBR',
    flag: '🇬🇧',
    teamId: 'mercedes',
    playable: true,
    points2026: 262,
    wins2026: 3,
    standing2026: 3,
    pace: 95,
    overtaking: 93,
    tireManagement: 94,
    consistency: 95,
    helmet: {
      shell: '#101418',
      stripe: '#00F5DF',
      visor: '#00D2BE',
    },
    portraitBase: 'russell',
    tagline: 'Blistering Vegas & qualifying pace for Mercedes',
  },
  {
    id: 'norris',
    name: 'Lando Norris',
    code: 'NOR',
    number: 1,
    country: 'United Kingdom',
    countryCode: 'GBR',
    flag: '🇬🇧',
    teamId: 'mclaren',
    playable: true,
    points2026: 246,
    wins2026: 3,
    standing2026: 6,
    pace: 95,
    overtaking: 93,
    tireManagement: 94,
    consistency: 93,
    helmet: {
      shell: '#D9FF00',
      stripe: '#141518',
      visor: '#FF8000',
    },
    portraitBase: 'norris',
    tagline: 'Carrying #1 into the 2026 regulation era',
  },
  {
    id: 'piastri',
    name: 'Oscar Piastri',
    code: 'PIA',
    number: 81,
    country: 'Australia',
    countryCode: 'AUS',
    flag: '🇦🇺',
    teamId: 'mclaren',
    playable: true,
    points2026: 152,
    wins2026: 0,
    standing2026: 7,
    pace: 91,
    overtaking: 92,
    tireManagement: 93,
    consistency: 92,
    helmet: {
      shell: '#161A22',
      stripe: '#FF8000',
      visor: '#47C7FC',
    },
    portraitBase: 'piastri',
    tagline: 'Ice-cool wheel-to-wheel racer in McLaren Papaya',
  },
  {
    id: 'hadjar',
    name: 'Isack Hadjar',
    code: 'HAD',
    number: 6,
    country: 'France',
    countryCode: 'FRA',
    flag: '🇫🇷',
    teamId: 'redbull',
    playable: true,
    points2026: 122,
    wins2026: 0,
    standing2026: 8,
    pace: 88,
    overtaking: 90,
    tireManagement: 87,
    consistency: 87,
    helmet: {
      shell: '#1A2454',
      stripe: '#FFD700',
      visor: '#FF1E1E',
    },
    portraitBase: 'hadjar',
    tagline: 'Explosive 2026 Red Bull Racing promotion',
  },
  {
    id: 'hamilton',
    name: 'Lewis Hamilton',
    code: 'HAM',
    number: 44,
    country: 'United Kingdom',
    countryCode: 'GBR',
    flag: '🇬🇧',
    teamId: 'ferrari',
    playable: true,
    points2026: 261,
    wins2026: 1,
    standing2026: 4,
    pace: 94,
    overtaking: 95,
    tireManagement: 96,
    consistency: 94,
    helmet: {
      shell: '#F3E500',
      stripe: '#9E00FF',
      visor: '#E8002D',
    },
    portraitBase: 'hamilton',
    tagline: '7x World Champion hunting Ferrari glory',
  },
  {
    id: 'leclerc',
    name: 'Charles Leclerc',
    code: 'LEC',
    number: 16,
    country: 'Monaco',
    countryCode: 'MON',
    flag: '🇲🇨',
    teamId: 'ferrari',
    playable: true,
    points2026: 251,
    wins2026: 1,
    standing2026: 5,
    pace: 94,
    overtaking: 93,
    tireManagement: 91,
    consistency: 92,
    helmet: {
      shell: '#E8002D',
      stripe: '#FFFFFF',
      visor: '#FFD700',
    },
    portraitBase: 'leclerc',
    tagline: 'Qualifying specialist in the #16 Ferrari',
  },
  {
    id: 'lawson',
    name: 'Liam Lawson',
    code: 'LAW',
    number: 30,
    country: 'New Zealand',
    countryCode: 'NZL',
    flag: '🇳🇿',
    teamId: 'racingbulls',
    playable: true,
    points2026: 87,
    wins2026: 0,
    standing2026: 9,
    pace: 85,
    overtaking: 87,
    tireManagement: 86,
    consistency: 85,
    helmet: {
      shell: '#1D2951',
      stripe: '#FF2A4D',
      visor: '#47C7FC',
    },
    portraitBase: 'lawson',
    tagline: 'Tenacious Racing Bulls points leader',
  },
  {
    id: 'gasly',
    name: 'Pierre Gasly',
    code: 'GAS',
    number: 10,
    country: 'France',
    countryCode: 'FRA',
    flag: '🇫🇷',
    teamId: 'alpine',
    playable: true,
    points2026: 42,
    wins2026: 0,
    standing2026: 10,
    pace: 83,
    overtaking: 85,
    tireManagement: 86,
    consistency: 85,
    helmet: {
      shell: '#0068A5',
      stripe: '#FF87BC',
      visor: '#00D2BE',
    },
    portraitBase: 'gasly',
    tagline: 'Smooth Alpine racecraft inside the top 10',
  },
];

export const ALL_DRIVERS: DriverConfig[] = [YAHIA_DRIVER, MARIAM_DRIVER, ...REAL_DRIVERS];

export const PLAYABLE_DRIVERS: DriverConfig[] = ALL_DRIVERS.filter((d) => d.playable);

export type DriverPortraitPose = 'grid' | 'victory' | 'podium';

export function getDriverPortraitPath(
  driver: DriverConfig,
  selectedTeamId?: TeamId,
  pose: DriverPortraitPose = 'grid',
): string {
  if (driver.isFlexStar) {
    if (pose === 'victory') return `./assets/drivers/${driver.portraitBase}-victory.png`;
    if (pose === 'podium') return `./assets/drivers/${driver.portraitBase}-podium.png`;
    const team = selectedTeamId && driver.flexTeams?.includes(selectedTeamId)
      ? selectedTeamId
      : driver.teamId;
    return `./assets/drivers/${driver.portraitBase}-${team}.png`;
  }
  return `./assets/drivers/${driver.portraitBase}.png`;
}

export function resolveDriverTeam(driver: DriverConfig, flexTeam?: TeamId): TeamConfig {
  const teamId =
    driver.isFlexStar && flexTeam && driver.flexTeams?.includes(flexTeam)
      ? flexTeam
      : driver.teamId;
  return TEAMS[teamId];
}

export function resolveDriverHelmet(driver: DriverConfig, flexTeam?: TeamId): HelmetPalette {
  if (!driver.isFlexStar || !flexTeam) {
    return driver.helmet;
  }
  if (flexTeam === 'mercedes') {
    return { shell: '#11161C', stripe: '#00D2BE', visor: '#00F5DF' };
  }
  if (flexTeam === 'redbull') {
    return { shell: '#141933', stripe: '#FFD700', visor: '#FF1E1E' };
  }
  return { shell: '#18191D', stripe: '#FF8000', visor: '#47C7FC' };
}

export const SEASON_2026_TICKER = [
  '2026 WORLD CHAMPION: Kimi Antonelli (#12 Mercedes) clinches title at age 20',
  '2026 CONSTRUCTORS CHAMPIONS: Mercedes-AMG Petronas (652 pts • 12 wins)',
  'LAS VEGAS GP WEEKEND: Max Verstappen (#3 Red Bull) & George Russell (#63 Mercedes) fight for P2',
  '2026 TECH ERA: Active Aerodynamics (X/Z Mode) + 350 kW MGU-K Boost & 1s Overtake Mode live',
  'BREAKING SIGNING: #17 Yahia Samy & #19 Mariam Samy (Egypt) cleared as Flex Stars for Mercedes, Red Bull & McLaren',
];
