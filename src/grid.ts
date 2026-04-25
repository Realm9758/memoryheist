import { Tile, TileType, Position, LevelConfig } from './types';

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bfs(grid: Tile[][], start: Position, end: Position): boolean {
  const size    = grid.length;
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  const queue: Position[] = [start];
  visited[start.y][start.x] = true;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.x === end.x && cur.y === end.y) return true;

    const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (visited[ny][nx]) continue;
      const t = grid[ny][nx].type;
      if (t === 'wall' || t === 'trap') continue; // fake_trap / decoy are walkable
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

export function getLevelConfig(level: number): LevelConfig {
  const baseSize   = 6;
  const gridSize   = Math.min(baseSize + Math.floor((level - 1) / 3), 12);
  const cellCount  = gridSize * gridSize;
  const trapDensity = 0.08 + (level - 1) * 0.015;
  const wallDensity = 0.12 + (level - 1) * 0.01;
  const memorizeTime = Math.max(1500, 3500 - (level - 1) * 150);

  // Traps fade only from level 3+ (levels 1-2 see everything for their full memorize time)
  const trapFadeStart    = level >= 3 ? memorizeTime * 0.45 : memorizeTime * 10;
  const trapFadeDuration = level >= 3 ? memorizeTime * 0.35 : 0;

  // Decoy exits: appear from level 5 (1 at lvl 5, increases slowly)
  const decoyCount = level >= 5 ? Math.min(Math.floor((level - 4) / 2), 3) : 0;

  // Fake traps (look like traps, safe to step): from level 5
  const fakeTrapCount = level >= 5 ? Math.min(1 + Math.floor((level - 5) / 2), 4) : 0;

  // Flickering real traps: level 6+
  const flickerChance = level >= 6 ? Math.min(0.3 + (level - 6) * 0.06, 0.65) : 0;

  // Escape countdown: level 3+, min 20 s
  const escapeTimeLimit = level >= 3 ? Math.max(20000, 75000 - (level - 3) * 3500) : 0;

  // ── New mechanics ──────────────────────────────────────────────────────────

  // Limited vision: unlimited for levels 1-8, radius 3 for 9-12, radius 2 for 13+
  const visionRadius = level >= 9
    ? (level >= 13 ? 2 : 3)
    : 999;

  // Peek (Space key): introduced at level 7; uses decrease with level
  const peekCount = level >= 7
    ? (level >= 13 ? 1 : level >= 10 ? 2 : 3)
    : 0;
  const peekDuration = 900; // ms

  // Moving traps: level 11+, max 3
  const movingTrapCount = level >= 11 ? Math.min(1 + Math.floor((level - 11) / 3), 3) : 0;

  return {
    gridSize,
    memorizeTime,
    trapFadeStart,
    trapFadeDuration,
    trapCount:       Math.floor(cellCount * Math.min(trapDensity, 0.22)),
    wallCount:       Math.floor(cellCount * Math.min(wallDensity, 0.20)),
    decoyCount,
    fakeTrapCount,
    flickerChance,
    escapeTimeLimit,
    visionRadius,
    peekCount,
    peekDuration,
    movingTrapCount,
  };
}

export function generateGrid(config: LevelConfig): { grid: Tile[][], start: Position, exit: Position } {
  const { gridSize, trapCount, wallCount, decoyCount, fakeTrapCount, flickerChance, movingTrapCount } = config;

  let attempts = 0;
  while (attempts < 200) {
    attempts++;
    const grid: Tile[][] = Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, () => ({ type: 'empty' as TileType, revealed: false }))
    );

    const startX = 0;
    const startY = Math.floor(Math.random() * gridSize);
    const exitX  = gridSize - 1;
    const exitY  = Math.floor(Math.random() * gridSize);

    grid[startY][startX].type = 'start';
    grid[exitY][exitX].type   = 'exit';

    const cells: Position[] = [];
    for (let y = 0; y < gridSize; y++)
      for (let x = 0; x < gridSize; x++)
        if (!(x === startX && y === startY) && !(x === exitX && y === exitY))
          cells.push({ x, y });
    shuffle(cells);

    let idx = 0;
    for (let i = 0; i < wallCount && idx < cells.length; i++, idx++)
      grid[cells[idx].y][cells[idx].x].type = 'wall';

    if (!bfs(grid, { x: startX, y: startY }, { x: exitX, y: exitY })) continue;

    const remaining: Position[] = [];
    for (let y = 0; y < gridSize; y++)
      for (let x = 0; x < gridSize; x++)
        if (grid[y][x].type === 'empty') remaining.push({ x, y });
    shuffle(remaining);

    let ri = 0;
    for (let i = 0; i < trapCount    && ri < remaining.length; i++, ri++)
      grid[remaining[ri].y][remaining[ri].x].type = 'trap';
    for (let i = 0; i < decoyCount   && ri < remaining.length; i++, ri++)
      grid[remaining[ri].y][remaining[ri].x].type = 'decoy';
    for (let i = 0; i < fakeTrapCount && ri < remaining.length; i++, ri++)
      grid[remaining[ri].y][remaining[ri].x].type = 'fake_trap';

    // Solvability: a trap-free path must exist (decoy/fake_trap are walkable)
    const solveGrid = grid.map(row => row.map(t => ({ ...t })));
    for (let y = 0; y < gridSize; y++)
      for (let x = 0; x < gridSize; x++)
        if (solveGrid[y][x].type === 'decoy' || solveGrid[y][x].type === 'fake_trap')
          solveGrid[y][x].type = 'empty';
    if (!bfs(solveGrid, { x: startX, y: startY }, { x: exitX, y: exitY })) continue;

    // Mark flickering real traps (visual tension — never fake)
    if (flickerChance > 0) {
      for (let y = 0; y < gridSize; y++)
        for (let x = 0; x < gridSize; x++)
          if (grid[y][x].type === 'trap' && Math.random() < flickerChance)
            grid[y][x].flickering = true;
    }

    // Mark some real traps as moving (level 11+)
    if (movingTrapCount > 0) {
      const traps: Position[] = [];
      for (let y = 0; y < gridSize; y++)
        for (let x = 0; x < gridSize; x++)
          if (grid[y][x].type === 'trap') traps.push({ x, y });
      shuffle(traps);
      for (let i = 0; i < Math.min(movingTrapCount, traps.length); i++)
        grid[traps[i].y][traps[i].x].moving = true;
    }

    return { grid, start: { x: startX, y: startY }, exit: { x: exitX, y: exitY } };
  }

  // Fallback (should rarely happen)
  const grid: Tile[][] = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => ({ type: 'empty' as TileType, revealed: false }))
  );
  grid[0][0].type = 'start';
  grid[gridSize - 1][gridSize - 1].type = 'exit';
  return { grid, start: { x: 0, y: 0 }, exit: { x: gridSize - 1, y: gridSize - 1 } };
}
