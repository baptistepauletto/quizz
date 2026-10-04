import type { GameEvent, GameEventType } from '../../shared/types';

// Sound effects are not part of step 1: there are no audio files yet.
// Every game mutation already emits a typed event, so adding sound later only means
// dropping files in /public/sfx and filling in `play()` below. Nothing else changes.

export type SfxName =
  | 'join'
  | 'question'
  | 'buzz'
  | 'correct'
  | 'wrong'
  | 'tick'
  | 'flip'
  | 'reveal'
  | 'bet'
  | 'lock'
  | 'fanfare';

export const SFX_FOR_EVENT: Partial<Record<GameEventType, SfxName>> = {
  'player.joined': 'join',
  'phase.changed': 'fanfare',
  'sprint.question': 'question',
  'sprint.buzz_won': 'buzz',
  'sprint.pass': 'wrong',
  'sprint.resolved': 'reveal',
  'memory.preview': 'reveal',
  'memory.hidden': 'flip',
  'memory.flipped': 'flip',
  'memory.consumed': 'reveal',
  'memory.turn': 'tick',
  'climax.announce': 'fanfare',
  'climax.betting_open': 'bet',
  'climax.betting_locked': 'lock',
  'climax.revealed': 'reveal',
  'climax.judged': 'reveal',
  'climax.resolved': 'fanfare',
  'score.updated': 'tick',
};

function play(name: SfxName, _event: GameEvent) {
  if (import.meta.env.DEV) console.debug(`[sfx] ${name}`);
}

/** Subscribe this to useGame's onEvent on the TV (and later on phones). */
export function playSfx(event: GameEvent) {
  const name = SFX_FOR_EVENT[event.type];
  if (name) play(name, event);
}
