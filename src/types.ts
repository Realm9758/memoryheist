export type TileType = 'empty' | 'wall' | 'trap' | 'exit' | 'start' | 'decoy';

export interface Tile {
  type: TileType;
  revealed: boolean;
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
  memorizeTime: number; // ms
  trapCount: number;
  wallCount: number;
  decoyCount: number;
}

export interface GameState {
  phase: GamePhase;
  level: number;
  grid: Tile[][];
  playerPos: Position;
  exitPos: Position;
  config: LevelConfig;
  memorizeTimer: number;
  escapeTimer: number;
  escapeStartTime: number;
  wrongMoves: number;
  score: number;
  perfectRun: boolean;
}
