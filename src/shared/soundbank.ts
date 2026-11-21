// Catalogue for the rendered sound bank: five sound palettes for the same game moments,
// plus an adaptive score made of stems. `npm run sounds` renders the files into
// public/audio; /sound-lab auditions them.

import type { Phase } from './types';

export type CueId =
  | 'join'
  | 'phase'
  | 'question'
  | 'buzz'
  | 'tick'
  | 'correct'
  | 'wrong'
  | 'flip'
  | 'chip'
  | 'lock'
  | 'drumroll'
  | 'reveal'
  | 'jackpot';

export interface CueInfo {
  id: CueId;
  label: string;
  /** When the game plays it. */
  when: string;
  /** Game events that would trigger it. */
  events: string[];
}

export const CUES: CueInfo[] = [
  { id: 'join', label: 'Arrivée', when: 'Un joueur rejoint la table depuis son téléphone.', events: ['player.joined'] },
  { id: 'phase', label: 'Nouvelle manche', when: 'La carte de manche apparaît (sprint, mémoire, climax…).', events: ['phase.changed'] },
  { id: 'question', label: 'Question', when: 'Une question de sprint est posée, les buzzers s’ouvrent.', events: ['sprint.question'] },
  { id: 'buzz', label: 'Buzz', when: 'Un joueur a gagné le buzz et doit répondre.', events: ['sprint.buzz_won'] },
  { id: 'tick', label: 'Le temps presse', when: 'Tic de compte à rebours, tour suivant à la mémoire, indice.', events: ['memory.turn', 'memory.hint', 'sprint.answer_timeout'] },
  { id: 'correct', label: 'Bonne réponse', when: 'Réponse validée : les points tombent.', events: ['sprint.resolved ✓', 'memory.consumed hit', 'climax.judged ✓'] },
  { id: 'wrong', label: 'Mauvaise réponse', when: 'Réponse refusée ou passe.', events: ['sprint.pass', 'memory.consumed miss', 'climax.judged ✗'] },
  { id: 'flip', label: 'Carte ouverte', when: 'Une case du plateau mémoire est ouverte.', events: ['memory.flipped'] },
  { id: 'chip', label: 'Mise', when: 'Un joueur mise au climax ou valide un pronostic.', events: ['climax.bet', 'predictions.pick', 'climax.betting_open'] },
  { id: 'lock', label: 'Rien ne va plus', when: 'Les mises ou pronostics sont verrouillés.', events: ['climax.betting_locked', 'predictions.locked', 'memory.leech_locked'] },
  { id: 'drumroll', label: 'Suspense', when: 'Réponses du climax verrouillées, avant le verdict.', events: ['climax.answers_locked'] },
  { id: 'reveal', label: 'Révélation', when: 'Une bonne réponse ou un pronostic est dévoilé.', events: ['reveal.next', 'climax.estimate_revealed', 'sprint.resolved ✗'] },
  { id: 'jackpot', label: 'Jackpot', when: 'Gains versés, fin de climax, podium.', events: ['reveal.awarded', 'climax.resolved'] },
];

export type PaletteId = 'salon' | 'jazz' | 'machine' | 'noir' | 'fievre';

export interface PaletteInfo {
  id: PaletteId;
  name: string;
  /** 1 = closest to a classic casino, 5 = furthest from it. */
  variance: 1 | 2 | 3 | 4 | 5;
  pitch: string;
  instruments: string;
}

export const PALETTES: PaletteInfo[] = [
  {
    id: 'salon',
    name: 'Salon Privé',
    variance: 1,
    pitch: 'Le vrai bruit d’une table de jeu, sans gadget : jetons d’argile, cartes sur le feutre, bille de roulette, cloche du croupier.',
    instruments: 'Jetons, cartes, râteau en bois, roulette, sonnette de comptoir, piano à queue',
  },
  {
    id: 'jazz',
    name: 'Orchestre 1925',
    variance: 2,
    pitch: 'L’orchestre du casino ponctue chaque action : cuivres, clarinette, trompette bouchée, roulement de caisse claire.',
    instruments: 'Cuivres, trompette wah-wah, clarinette, banjo, xylophone, batterie aux balais',
  },
  {
    id: 'machine',
    name: 'La Machine',
    variance: 3,
    pitch: 'Tout est mécanique Art déco : rouleaux de bandit manchot, sonnerie électrique, tableau à palettes de gare, caisse enregistreuse, coffre-fort.',
    instruments: 'Rouleaux, leviers, cloches électriques, pièces, cliquets, palettes Solari',
  },
  {
    id: 'noir',
    name: 'Néon Noir',
    variance: 4,
    pitch: 'Le casino après minuit : bourdonnement du néon rose, briquet, verres qui trinquent, vibraphone et basses de cinéma.',
    instruments: 'Néons électriques, Rhodes, vibraphone, sub-basses, battement de cœur, montées de tension',
  },
  {
    id: 'fievre',
    name: 'Fièvre 78 tours',
    variance: 5,
    pitch: 'Un rêve fiévreux sur gramophone : disques rayés, ralentis, thérémine, chœur fantôme, orgue de manège. Tout passe dans le pavillon.',
    instruments: 'Gramophone, scratch, ralenti de disque, thérémine, boîte à musique, calliope, chœur',
  },
];

export const sfxUrl = (palette: PaletteId, cue: CueId) => `/audio/sfx/${palette}/${cue}.mp3`;

// --- music ------------------------------------------------------------------

export type StemId = 'bass' | 'drums' | 'piano' | 'lead' | 'tension';

export const STEMS: { id: StemId; label: string }[] = [
  { id: 'bass', label: 'Contrebasse' },
  { id: 'drums', label: 'Balais & ride' },
  { id: 'piano', label: 'Piano' },
  { id: 'lead', label: 'Clarinette' },
  { id: 'tension', label: 'Tension' },
];

export const MUSIC = {
  title: 'Riviera 1925',
  bpm: 120,
  bars: 32,
  /** Seconds of the loop's own audio padded before and after it in each file. */
  pad: 1,
  /** Length of the loop in seconds (bars × 4 beats). */
  get loop() {
    return (this.bars * 4 * 60) / this.bpm;
  },
};

export const stemUrl = (stem: StemId) => `/audio/music/${stem}.mp3`;

/** Gain (0–1) of each stem per game phase. Stems share tempo and key, so any mix stays in time. */
export const PHASE_MIX: Record<Phase, Record<StemId, number>> = {
  lobby: { bass: 1, drums: 1, piano: 1, lead: 1, tension: 0 },
  predictions: { bass: 1, drums: 0.8, piano: 1, lead: 0, tension: 0 },
  sprint: { bass: 0.9, drums: 0.7, piano: 0.45, lead: 0, tension: 0 },
  memory: { bass: 0.8, drums: 0, piano: 0.7, lead: 0, tension: 0 },
  climax: { bass: 0.8, drums: 0, piano: 0, lead: 0, tension: 1 },
  reveal: { bass: 0.6, drums: 0.6, piano: 0, lead: 0, tension: 0.8 },
  results: { bass: 1, drums: 1, piano: 1, lead: 1, tension: 0 },
};

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: 'Salon (lobby)',
  predictions: 'Pronostics',
  sprint: 'Sprint',
  memory: 'Mémoire',
  climax: 'Climax',
  reveal: 'Révélations',
  results: 'Résultats',
};
