export type TileType = 'empty' | 'wall' | 'trap' | 'exit' | 'start' | 'decoy' | 'fake_trap';

export interface Tile {
  type: TileType;
  revealed: boolean;
  flickering?: boolean; // real trap that flickers during memorize
  moving?: boolean;     // trap that moves one step each time the player moves (level 11+)
}

export interface Position {
  x: number;
  y: number;
}

export type GamePhase =
  | 'title'
  | 'tutorial'   // paused intro screen shown before memorize starts
  | 'memorize'
  | 'countdown'
  | 'escape'
  | 'win'
  | 'lose';

export interface LevelConfig {
  gridSize: number;
  memorizeTime: number;
  trapFadeStart: number;
  trapFadeDuration: number;
  trapCount: number;
  wallCount: number;
  decoyCount: number;
  fakeTrapCount: number;
  flickerChance: number;
  escapeTimeLimit: number;
  // ── New mechanics ──────────────────────────────────
  visionRadius: number;    // tiles visible around player during escape (999 = unlimited)
  peekCount: number;       // full-map reveals available per level (Space key)
  peekDuration: number;    // ms each peek lasts
  movingTrapCount: number; // traps that shuffle one step on each player move
}

export interface GameState {
  phase: GamePhase;
  level: number;
  grid: Tile[][];
  playerPos: Position;
  exitPos: Position;
  config: LevelConfig;
  memorizeTimer: number;
  escapeTimeRemaining: number;
  escapeStartTime: number;
  wrongMoves: number;
  score: number;
  perfectRun: boolean;
  // ── New mechanics ──────────────────────────────────
  peeksRemaining: number;
  peekEndTime: number; // performance.now() timestamp when current peek expires (0 = off)
}
