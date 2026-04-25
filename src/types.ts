export type TileType = 'empty' | 'wall' | 'trap' | 'exit' | 'start' | 'decoy' | 'fake_trap';

export interface Tile {
  type: TileType;
  revealed: boolean;
  flickering?: boolean; // trap flickers during memorize phase (always real)
}

export interface Position {
  x: number;
  y: number;
}

export type GamePhase =
  | 'title'
  | 'memorize'
  | 'countdown'
  | 'escape'
  | 'win'
  | 'lose';

export interface LevelConfig {
  gridSize: number;
  memorizeTime: number;
  trapFadeStart: number;    // ms elapsed into memorize phase when fade begins
  trapFadeDuration: number; // ms over which traps fade from visible to invisible
  trapCount: number;
  wallCount: number;
  decoyCount: number;
  fakeTrapCount: number;    // look like traps, safe to step on
  flickerChance: number;    // 0-1 chance a real trap flickers during memorize
  escapeTimeLimit: number;  // ms countdown (0 = unlimited)
}

export interface GameState {
  phase: GamePhase;
  level: number;
  grid: Tile[][];
  playerPos: Position;
  exitPos: Position;
  config: LevelConfig;
  memorizeTimer: number;       // ms remaining in memorize phase
  escapeTimeRemaining: number; // ms remaining in escape countdown
  escapeStartTime: number;
  wrongMoves: number;
  score: number;
  perfectRun: boolean;
}
