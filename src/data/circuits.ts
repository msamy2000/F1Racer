export type CircuitId = 'red-bull-ring' | 'monza' | 'silverstone' | 'las-vegas';

export type AtmospherePreset = 'alpine-day' | 'golden-park' | 'british-day' | 'vegas-night';

export interface ActiveAeroZone {
  name: string;
  startS: number; // normalized [0, 1]
  endS: number;   // normalized [0, 1]
}

export interface CornerMarker {
  name: string;
  s: number;
}

export interface CircuitConfig {
  id: CircuitId;
  name: string;
  grandPrixName: string;
  country: string;
  flag: string;
  city: string;
  realLengthMeters: number;
  turns: number;
  lapRecord: {
    time: string;
    timeMs: number;
    driver: string;
    year: number;
  };
  defaultLaps: number;
  atmosphere: AtmospherePreset;
  trackWidth: number;
  kerbPrimary: string;
  kerbSecondary: string;
  pitSide: -1 | 1; // -1 = left of tangent, 1 = right of tangent
  pitEntryS: number;
  pitExitS: number;
  sector1End: number;
  sector2End: number;
  overtakeDetectionS: number;
  activeAeroZones: ActiveAeroZone[];
  corners: CornerMarker[];
  controlPoints: [number, number, number][];
  description: string;
  landmarkCenter?: [number, number, number];
}

export const CIRCUITS: Record<CircuitId, CircuitConfig> = {
  'red-bull-ring': {
    id: 'red-bull-ring',
    name: 'Red Bull Ring',
    grandPrixName: 'Austrian Grand Prix',
    country: 'Austria',
    flag: '🇦🇹',
    city: 'Spielberg',
    realLengthMeters: 4318,
    turns: 10,
    lapRecord: {
      time: '1:05.619',
      timeMs: 65619,
      driver: 'C. Sainz',
      year: 2020,
    },
    defaultLaps: 5,
    atmosphere: 'alpine-day',
    trackWidth: 14.5,
    kerbPrimary: '#E10600',
    kerbSecondary: '#F6F6F8',
    pitSide: 1,
    pitEntryS: 0.90,
    pitExitS: 0.11,
    sector1End: 0.34,
    sector2End: 0.69,
    overtakeDetectionS: 0.87,
    activeAeroZones: [
      { name: 'Main Pit Straight', startS: 0.94, endS: 0.12 },
      { name: 'Remus Uphill Straight', startS: 0.17, endS: 0.31 },
      { name: 'Schlossgold Straight', startS: 0.37, endS: 0.50 },
    ],
    corners: [
      { name: 'T1 Niki Lauda Kurve', s: 0.14 },
      { name: 'T3 Remus Hairpin', s: 0.33 },
      { name: 'T4 Schlossgold', s: 0.52 },
      { name: 'T6-T7 Rauch', s: 0.68 },
      { name: 'T9 Rindt', s: 0.84 },
    ],
    controlPoints: [
      [-230, 0, -185],
      [15, 6, -198],
      [195, 13, -205],
      [285, 22, -162],
      [425, 42, -92],
      [465, 44, -22],
      [392, 36, 42],
      [225, 20, 112],
      [148, 14, 176],
      [172, 12, 236],
      [58, 10, 268],
      [-65, 8, 226],
      [-192, 6, 260],
      [-305, 4, 205],
      [-362, 2, 92],
      [-356, 0, -45],
      [-318, 0, -152],
    ],
    description: 'High-elevation Styrian mountain rollercoaster with three big Active Aero zones & heavy braking hairpins.',
  },
  monza: {
    id: 'monza',
    name: 'Autodromo Nazionale Monza',
    grandPrixName: 'Italian Grand Prix',
    country: 'Italy',
    flag: '🇮🇹',
    city: 'Monza',
    realLengthMeters: 5793,
    turns: 11,
    lapRecord: {
      time: '1:20.901',
      timeMs: 80901,
      driver: 'L. Norris',
      year: 2025,
    },
    defaultLaps: 5,
    atmosphere: 'golden-park',
    trackWidth: 14.5,
    kerbPrimary: '#008C45',
    kerbSecondary: '#CD212A',
    pitSide: 1,
    pitEntryS: 0.91,
    pitExitS: 0.10,
    sector1End: 0.32,
    sector2End: 0.67,
    overtakeDetectionS: 0.84,
    activeAeroZones: [
      { name: 'Rettifilo Main Straight', startS: 0.93, endS: 0.12 },
      { name: 'Curva Grande – Roggia', startS: 0.21, endS: 0.34 },
      { name: 'Back Straight (Ascari – Parabolica)', startS: 0.72, endS: 0.86 },
    ],
    corners: [
      { name: 'T1-T2 Prima Variante', s: 0.15 },
      { name: 'T3 Curva Grande', s: 0.23 },
      { name: 'T4-T5 Variante Roggia', s: 0.36 },
      { name: 'T6-T7 Lesmo 1 & 2', s: 0.51 },
      { name: 'T8-T10 Ascari', s: 0.68 },
      { name: 'T11 Curva Alboreto', s: 0.88 },
    ],
    controlPoints: [
      [-355, 0, -242],
      [-15, 0, -245],
      [325, 0, -248],
      [388, 0, -246],
      [410, 0, -218],
      [454, 0, -214],
      [514, 0, -162],
      [524, 0, -68],
      [464, 0, 22],
      [412, 0, 48],
      [396, 0, 82],
      [364, 0, 98],
      [352, 0, 178],
      [272, 0, 238],
      [182, 0, 224],
      [112, 0, 276],
      [-24, 0, 282],
      [-142, 0, 256],
      [-188, 0, 278],
      [-254, 0, 250],
      [-412, 0, 194],
      [-504, 0, 108],
      [-532, 0, -24],
      [-492, 0, -166],
      [-442, 0, -230],
    ],
    description: 'The Temple of Speed — 345+ km/h slipstream battles through Italian parkland chicanes & Parabolica.',
  },
  silverstone: {
    id: 'silverstone',
    name: 'Silverstone Circuit',
    grandPrixName: 'British Grand Prix',
    country: 'United Kingdom',
    flag: '🇬🇧',
    city: 'Silverstone',
    realLengthMeters: 5891,
    turns: 18,
    lapRecord: {
      time: '1:27.097',
      timeMs: 87097,
      driver: 'M. Verstappen',
      year: 2020,
    },
    defaultLaps: 5,
    atmosphere: 'british-day',
    trackWidth: 15.0,
    kerbPrimary: '#00247D',
    kerbSecondary: '#CF142B',
    pitSide: 1,
    pitEntryS: 0.91,
    pitExitS: 0.09,
    sector1End: 0.34,
    sector2End: 0.70,
    overtakeDetectionS: 0.71,
    activeAeroZones: [
      { name: 'Hamilton Straight', startS: 0.94, endS: 0.08 },
      { name: 'Wellington Straight', startS: 0.21, endS: 0.32 },
      { name: 'Hangar Straight', startS: 0.70, endS: 0.82 },
    ],
    corners: [
      { name: 'T1 Abbey', s: 0.10 },
      { name: 'T3-T4 Village & Loop', s: 0.17 },
      { name: 'T6-T7 Brooklands & Luffield', s: 0.35 },
      { name: 'T9 Copse', s: 0.49 },
      { name: 'T10-T14 Maggotts–Becketts', s: 0.62 },
      { name: 'T15 Stowe', s: 0.84 },
      { name: 'T16-T18 Vale & Club', s: 0.91 },
    ],
    controlPoints: [
      [-260, 0, 240],
      [-35, 0, 250],
      [96, 0, 224],
      [168, 0, 174],
      [206, 0, 104],
      [122, 0, 62],
      [74, 0, 8],
      [-68, 0, -48],
      [-216, 0, -106],
      [-296, 0, -166],
      [-246, 0, -246],
      [-124, 0, -236],
      [22, 0, -256],
      [192, 0, -262],
      [308, 0, -210],
      [368, 0, -144],
      [340, 0, -70],
      [416, 0, -14],
      [452, 0, 68],
      [420, 0, 212],
      [322, 0, 324],
      [224, 0, 366],
      [108, 0, 350],
      [-32, 0, 332],
      [-172, 0, 314],
      [-286, 0, 274],
    ],
    description: 'Home of F1 speed — flat-out Copse, flowing Maggotts–Becketts–Chapel S-curves & Hangar Straight.',
  },
  'las-vegas': {
    id: 'las-vegas',
    name: 'Las Vegas Strip Circuit',
    grandPrixName: 'Las Vegas Grand Prix',
    country: 'United States',
    flag: '🇺🇸',
    city: 'Las Vegas, NV',
    realLengthMeters: 6201,
    turns: 17,
    lapRecord: {
      time: '1:33.365',
      timeMs: 93365,
      driver: 'M. Verstappen',
      year: 2025,
    },
    defaultLaps: 5,
    atmosphere: 'vegas-night',
    trackWidth: 14.5,
    kerbPrimary: '#E10600',
    kerbSecondary: '#F8F9FC',
    pitSide: -1,
    pitEntryS: 0.92,
    pitExitS: 0.08,
    sector1End: 0.33,
    sector2End: 0.67,
    overtakeDetectionS: 0.65,
    activeAeroZones: [
      { name: 'Harmon Pit Straight', startS: 0.94, endS: 0.09 },
      { name: 'Koval Straight', startS: 0.21, endS: 0.34 },
      { name: 'Las Vegas Blvd Strip', startS: 0.66, endS: 0.85 },
    ],
    corners: [
      { name: 'T1-T4 Pit Hairpin & Complex', s: 0.13 },
      { name: 'T5-T9 Vegas Sphere Sweep', s: 0.38 },
      { name: 'T12 Strip Entry', s: 0.64 },
      { name: 'T14-T16 Strip Chicane', s: 0.88 },
    ],
    controlPoints: [
      [-310, 0, 224],
      [35, 0, 222],
      [158, 0, 214],
      [206, 0, 152],
      [284, 0, 122],
      [434, 0, 96],
      [482, 0, -22],
      [432, 0, -156],
      [318, 0, -182],
      [266, 0, -256],
      [108, 0, -282],
      [-132, 0, -276],
      [-324, 0, -248],
      [-442, 0, -158],
      [-488, 0, 18],
      [-466, 0, 166],
      [-412, 0, 228],
      [-364, 0, 204],
    ],
    landmarkCenter: [350, 0, -78],
    description: 'November 2026 neon night race — blast past the glowing Vegas Sphere & down the 1.9 km Las Vegas Strip!',
  },
};

export const CIRCUIT_ORDER: CircuitId[] = [
  'red-bull-ring',
  'monza',
  'silverstone',
  'las-vegas',
];
