import { GameState, Tile, Position } from './types';

const COLORS = {
  bg:           '#0a0a0f',
  gridBg:       '#0d0d14',
  gridLine:     '#111118',
  fog:          '#0d0d14',
  fogBorder:    '#15151f',
  empty:        '#131320',
  wall:         '#1a1a2e',
  wallBorder:   '#252540',
  trap:         '#3d0f0f',
  trapBorder:   '#8b1a1a',
  trapGlow:     'rgba(200,50,50,0.6)',
  exit:         '#0d3320',
  exitBorder:   '#1a8b50',
  exitGlow:     'rgba(50,200,100,0.6)',
  decoy:        '#1a2a0d',
  decoyBorder:  '#3a6b1a',
  start:        '#0d1a33',
  startBorder:  '#1a4b8b',
  player:       '#c8a84b',
  playerGlow:   'rgba(200,168,75,0.7)',
  revealedEmpty:'#161625',
  revealedWall: '#1e1e32',
  countdownText:'#c8a84b',
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tileSize = 64;
  private padding = 4;
  private playerPulse = 0;
  private revealAnimations: Map<string, number> = new Map();
  private lastFrameTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(gridSize: number) {
    const maxCanvas = Math.min(window.innerWidth - 40, window.innerHeight - 160, 600);
    this.tileSize = Math.floor((maxCanvas - this.padding * 2) / gridSize);
    const canvasSize = this.tileSize * gridSize + this.padding * 2;
    this.canvas.width = canvasSize;
    this.canvas.height = canvasSize;
    (document.getElementById('canvas-container') as HTMLElement).style.width = canvasSize + 'px';
  }

  private tileX(x: number): number {
    return this.padding + x * this.tileSize;
  }

  private tileY(y: number): number {
    return this.padding + y * this.tileSize;
  }

  triggerReveal(x: number, y: number) {
    this.revealAnimations.set(`${x},${y}`, performance.now());
  }

  render(state: GameState, timestamp: number) {
    const dt = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;
    this.playerPulse += dt * 0.004;

    const ctx = this.ctx;
    const { grid, playerPos, phase, config } = state;
    const size = config.gridSize;

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const revealing = phase === 'memorize' || phase === 'countdown';

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = grid[y][x];
        const tx = this.tileX(x);
        const ty = this.tileY(y);
        const ts = this.tileSize - 2;

        if (revealing) {
          this.drawTileRevealed(ctx, tile, tx, ty, ts);
        } else {
          const revKey = `${x},${y}`;
          const revTime = this.revealAnimations.get(revKey);
          const revProgress = revTime ? Math.min((timestamp - revTime) / 300, 1) : 0;

          if (tile.revealed) {
            if (revProgress < 1) {
              // Animate reveal: flash from bright to normal
              const alpha = lerp(1, 0, revProgress);
              this.drawTileRevealed(ctx, tile, tx, ty, ts);
              ctx.fillStyle = `rgba(200,168,75,${alpha * 0.3})`;
              ctx.fillRect(tx + 1, ty + 1, ts, ts);
            } else {
              this.drawTileRevealed(ctx, tile, tx, ty, ts);
              this.revealAnimations.delete(revKey);
            }
          } else {
            this.drawFog(ctx, tx, ty, ts);
          }
        }
      }
    }

    // Player
    this.drawPlayer(ctx, playerPos, timestamp);
  }

  private drawTileRevealed(ctx: CanvasRenderingContext2D, tile: Tile, tx: number, ty: number, ts: number) {
    const r = 3;
    const type = tile.type;

    switch (type) {
      case 'empty':
      case 'start':
        ctx.fillStyle = type === 'start' ? COLORS.start : COLORS.empty;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.fill();
        if (type === 'start') {
          ctx.strokeStyle = COLORS.startBorder;
          ctx.lineWidth = 1.5;
          this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
          ctx.stroke();
          this.drawStartIcon(ctx, tx, ty);
        }
        break;

      case 'wall':
        ctx.fillStyle = COLORS.wall;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.wallBorder;
        ctx.lineWidth = 1;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.stroke();
        this.drawWallTexture(ctx, tx, ty, ts);
        break;

      case 'trap':
        ctx.fillStyle = COLORS.trap;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.trapBorder;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.stroke();
        this.drawTrapIcon(ctx, tx, ty);
        break;

      case 'exit':
        ctx.fillStyle = COLORS.exit;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.exitBorder;
        ctx.lineWidth = 2;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.stroke();
        this.drawExitIcon(ctx, tx, ty);
        break;

      case 'decoy':
        // Looks like exit but different shade
        ctx.fillStyle = COLORS.decoy;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.decoyBorder;
        ctx.lineWidth = 2;
        this.roundRect(ctx, tx + 1, ty + 1, ts, ts, r);
        ctx.stroke();
        this.drawExitIcon(ctx, tx, ty, '#3a8b30');
        break;
    }
  }

  private drawFog(ctx: CanvasRenderingContext2D, tx: number, ty: number, ts: number) {
    ctx.fillStyle = COLORS.fog;
    this.roundRect(ctx, tx + 1, ty + 1, ts, ts, 3);
    ctx.fill();
    ctx.strokeStyle = COLORS.fogBorder;
    ctx.lineWidth = 1;
    this.roundRect(ctx, tx + 1, ty + 1, ts, ts, 3);
    ctx.stroke();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, pos: Position, timestamp: number) {
    const tx = this.tileX(pos.x);
    const ty = this.tileY(pos.y);
    const ts = this.tileSize;
    const cx = tx + ts / 2;
    const cy = ty + ts / 2;
    const pulse = Math.sin(timestamp * 0.004) * 0.15 + 0.85;
    const r = ts * 0.22 * pulse;

    // Outer glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
    grd.addColorStop(0, 'rgba(200,168,75,0.3)');
    grd.addColorStop(1, 'rgba(200,168,75,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Inner dot
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // White center
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawTrapIcon(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const ts = this.tileSize;
    const cx = tx + ts / 2;
    const cy = ty + ts / 2;
    const s = ts * 0.22;

    ctx.strokeStyle = '#c83232';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // X shape
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.lineTo(cx + s, cy + s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s, cy - s);
    ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
  }

  private drawExitIcon(ctx: CanvasRenderingContext2D, tx: number, ty: number, color = '#32c864') {
    const ts = this.tileSize;
    const cx = tx + ts / 2;
    const cy = ty + ts / 2;
    const s = ts * 0.2;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Arrow pointing right
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx + s * 0.4, cy - s * 0.6);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx + s * 0.4, cy + s * 0.6);
    ctx.stroke();
  }

  private drawStartIcon(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const ts = this.tileSize;
    const cx = tx + ts / 2;
    const cy = ty + ts / 2;
    const s = ts * 0.15;

    ctx.strokeStyle = '#4b8bc8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, s, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawWallTexture(ctx: CanvasRenderingContext2D, tx: number, ty: number, ts: number) {
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    const brickH = Math.floor(ts / 3);
    for (let row = 0; row < 3; row++) {
      const offset = row % 2 === 0 ? 0 : ts / 4;
      ctx.fillRect(tx + offset + 3, ty + row * brickH + 3, ts / 2 - 5, brickH - 2);
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  flashCountdown(num: number) {
    const el = document.getElementById('countdown-flash')!;
    el.textContent = num > 0 ? String(num) : 'GO!';
    el.style.opacity = '1';
    setTimeout(() => {
      el.style.transition = 'opacity 0.4s ease';
      el.style.opacity = '0';
    }, 500);
  }

  renderWinParticles(ctx: CanvasRenderingContext2D, timestamp: number, _exitPos: Position) {
    // Simple scanline effect on win
    ctx.fillStyle = 'rgba(50,200,100,0.03)';
    const scanY = (timestamp * 0.15) % this.canvas.height;
    ctx.fillRect(0, scanY, this.canvas.width, 2);
  }
}
