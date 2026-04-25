import { GameState, Tile, Position } from './types';

const COLORS = {
  bg:           '#0a0a0f',
  empty:        '#131320',
  wall:         '#1a1a2e',
  wallBorder:   '#252540',
  trap:         '#3d0f0f',
  trapBorder:   '#8b1a1a',
  exit:         '#0d3320',
  exitBorder:   '#1a8b50',
  decoy:        '#1a2a0d',
  decoyBorder:  '#3a6b1a',
  start:        '#0d1a33',
  startBorder:  '#1a4b8b',
  fog:          '#0d0d14',
  fogBorder:    '#15151f',
  player:       '#c8a84b',
  fakeTrap:     '#141422',
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tileSize = 64;
  private padding  = 4;

  // Tile reveal animations
  private revealAnimations: Map<string, number> = new Map();

  // Player trail: stores old positions with timestamp
  private playerTrail: { x: number; y: number; time: number }[] = [];
  private playerMoveTime = 0;

  // Win ripple
  private winRippleStart  = 0;
  private winRippleCenter = { x: 0, y: 0 };

  // Per-frame context set at top of render()
  private currentTimestamp = 0;
  private isRevealPhase    = false;
  private currentTrapAlpha = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(gridSize: number) {
    const maxCanvas = Math.min(window.innerWidth - 40, window.innerHeight - 160, 600);
    this.tileSize = Math.floor((maxCanvas - this.padding * 2) / gridSize);
    const canvasSize = this.tileSize * gridSize + this.padding * 2;
    this.canvas.width  = canvasSize;
    this.canvas.height = canvasSize;
    (document.getElementById('canvas-container') as HTMLElement).style.width = canvasSize + 'px';
    this.playerTrail = [];
    this.winRippleStart = 0;
  }

  private tx(x: number) { return this.padding + x * this.tileSize; }
  private ty(y: number) { return this.padding + y * this.tileSize; }

  // Called by game before updating playerPos so old pos goes into trail
  notifyPlayerMoved(oldPos: Position, _newPos: Position, timestamp: number) {
    this.playerTrail.push({ x: oldPos.x, y: oldPos.y, time: timestamp });
    if (this.playerTrail.length > 5) this.playerTrail.shift();
    this.playerMoveTime = timestamp;
  }

  triggerReveal(x: number, y: number) {
    this.revealAnimations.set(`${x},${y}`, performance.now());
  }

  triggerWinEffect(exitPos: Position, timestamp: number) {
    this.winRippleStart  = timestamp;
    this.winRippleCenter = {
      x: this.tx(exitPos.x) + this.tileSize / 2,
      y: this.ty(exitPos.y) + this.tileSize / 2,
    };
  }

  // ─── Main render ────────────────────────────────────────────────────────────

  render(state: GameState, timestamp: number) {
    this.currentTimestamp = timestamp;
    this.isRevealPhase    = state.phase === 'memorize' || state.phase === 'countdown';
    this.currentTrapAlpha = this.computeTrapAlpha(state);

    const ctx  = this.ctx;
    const { grid, playerPos, config } = state;
    const size = config.gridSize;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawGridGlow();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = grid[y][x];
        const px   = this.tx(x);
        const py   = this.ty(y);
        const ts   = this.tileSize - 2;

        if (this.isRevealPhase) {
          this.drawRevealPhaseTile(ctx, tile, px, py, ts);
        } else {
          const revKey  = `${x},${y}`;
          const revTime = this.revealAnimations.get(revKey);
          const revProg = revTime ? clamp((timestamp - revTime) / 280, 0, 1) : 0;

          if (tile.revealed) {
            if (revProg < 1) {
              // Scale pop + gold flash on reveal
              const scale  = 1 + (1 - revProg) * 0.18;
              const cx = px + ts / 2 + 1;
              const cy = py + ts / 2 + 1;
              ctx.save();
              ctx.translate(cx, cy);
              ctx.scale(scale, scale);
              ctx.translate(-cx, -cy);
              this.drawTileRevealed(ctx, tile, px, py, ts);
              ctx.restore();

              ctx.fillStyle = `rgba(200,168,75,${(1 - revProg) * 0.45})`;
              this.roundRect(ctx, px + 1, py + 1, ts, ts, 3);
              ctx.fill();
            } else {
              this.drawTileRevealed(ctx, tile, px, py, ts);
              this.revealAnimations.delete(revKey);
            }
          } else {
            this.drawFog(ctx, px, py, ts);
          }
        }
      }
    }

    if (this.winRippleStart > 0) this.drawWinRipple(timestamp);

    this.drawPlayer(ctx, playerPos, timestamp);
  }

  // ─── Tile drawing ────────────────────────────────────────────────────────────

  // Handles the trap-fade and fake_trap disguise during the memorize phase
  private drawRevealPhaseTile(ctx: CanvasRenderingContext2D, tile: Tile, px: number, py: number, ts: number) {
    const isTrapLike = tile.type === 'trap' || tile.type === 'fake_trap';

    if (isTrapLike) {
      // Draw empty tile underneath so fade-out blends to empty (not black)
      this.drawTileRevealed(ctx, { type: 'empty', revealed: false }, px, py, ts);

      let alpha = this.currentTrapAlpha;

      // Flickering traps pulse in/out (only real traps are marked flickering)
      if (tile.flickering) {
        const hash    = px * 0.0037 + py * 0.0071;
        const flicker = 0.25 + 0.75 * Math.max(0, Math.sin(this.currentTimestamp * 0.013 + hash));
        alpha *= flicker;
      }

      if (alpha > 0.02) {
        ctx.globalAlpha = alpha;
        // fake_trap is drawn identically to a real trap — player can't tell the difference
        this.drawTileRevealed(ctx, { ...tile, type: 'trap' }, px, py, ts);
        ctx.globalAlpha = 1;
      }
    } else {
      this.drawTileRevealed(ctx, tile, px, py, ts);
    }
  }

  private drawTileRevealed(ctx: CanvasRenderingContext2D, tile: Tile, px: number, py: number, ts: number) {
    const r    = 3;
    const type = tile.type;

    switch (type) {
      case 'empty': {
        ctx.fillStyle = COLORS.empty;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        break;
      }

      case 'start': {
        ctx.fillStyle = COLORS.start;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.startBorder;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.stroke();
        this.drawStartIcon(ctx, px, py);
        break;
      }

      case 'wall': {
        ctx.fillStyle = COLORS.wall;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.wallBorder;
        ctx.lineWidth = 1;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.stroke();
        this.drawWallTexture(ctx, px, py, ts);
        break;
      }

      case 'trap': {
        ctx.fillStyle = COLORS.trap;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.trapBorder;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.stroke();
        this.drawTrapIcon(ctx, px, py);
        break;
      }

      case 'exit': {
        ctx.fillStyle = COLORS.exit;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.exitBorder;
        ctx.lineWidth = 2;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.stroke();
        this.drawExitIcon(ctx, px, py);
        // Pulsing glow on exit
        this.drawExitPulse(ctx, px, py, ts);
        break;
      }

      case 'decoy': {
        ctx.fillStyle = COLORS.decoy;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = COLORS.decoyBorder;
        ctx.lineWidth = 2;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.stroke();
        this.drawExitIcon(ctx, px, py, '#3a8b30');
        break;
      }

      case 'fake_trap': {
        // Revealed fake_trap: safe, shown with a muted greenish ghost-X
        ctx.fillStyle = COLORS.fakeTrap;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.fill();
        ctx.strokeStyle = 'rgba(60,90,60,0.25)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, px + 1, py + 1, ts, ts, r);
        ctx.stroke();
        const cx = px + ts / 2 + 1;
        const cy = py + ts / 2 + 1;
        const s  = ts * 0.14;
        ctx.strokeStyle = 'rgba(80,140,80,0.35)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke();
        break;
      }
    }
  }

  private drawFog(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number) {
    ctx.fillStyle = COLORS.fog;
    this.roundRect(ctx, px + 1, py + 1, ts, ts, 3);
    ctx.fill();
    ctx.strokeStyle = COLORS.fogBorder;
    ctx.lineWidth = 1;
    this.roundRect(ctx, px + 1, py + 1, ts, ts, 3);
    ctx.stroke();
  }

  // ─── Player ──────────────────────────────────────────────────────────────────

  private drawPlayer(ctx: CanvasRenderingContext2D, pos: Position, timestamp: number) {
    const ptx = this.tx(pos.x);
    const pty = this.ty(pos.y);
    const ts  = this.tileSize;
    const cx  = ptx + ts / 2;
    const cy  = pty + ts / 2;

    // Fading trail dots behind the player
    const trailDur = 380;
    for (const point of this.playerTrail) {
      const age = timestamp - point.time;
      if (age > trailDur) continue;
      const frac  = 1 - age / trailDur;
      const alpha = frac * 0.28;
      const pr    = ts * 0.1 * frac;
      const pcx   = this.tx(point.x) + ts / 2;
      const pcy   = this.ty(point.y) + ts / 2;
      ctx.fillStyle = `rgba(200,168,75,${alpha})`;
      ctx.beginPath();
      ctx.arc(pcx, pcy, Math.max(1, pr), 0, Math.PI * 2);
      ctx.fill();
    }

    // Pop scale on move (lasts 200ms, peaks at midpoint)
    const sinceMove  = this.playerMoveTime > 0 ? timestamp - this.playerMoveTime : 9999;
    const popDur     = 200;
    const popScale   = sinceMove < popDur ? 1 + 0.32 * Math.sin((sinceMove / popDur) * Math.PI) : 1;

    const baseR = ts * 0.22;
    const r     = baseR * popScale;

    // Outer glow (slow breathe)
    const pulse = 0.82 + 0.18 * Math.sin(timestamp * 0.0035);
    const glowR = r * 2.3 * pulse;
    const grd   = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grd.addColorStop(0, 'rgba(200,168,75,0.38)');
    grd.addColorStop(1, 'rgba(200,168,75,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Core dot
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // White highlight
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.33, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Effects ─────────────────────────────────────────────────────────────────

  private drawGridGlow() {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;
    const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    grd.addColorStop(0, 'rgba(35, 35, 75, 0.18)');
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }

  private drawExitPulse(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number) {
    const pulse = 0.45 + 0.55 * Math.sin(this.currentTimestamp * 0.0028);
    const cx    = px + ts / 2 + 1;
    const cy    = py + ts / 2 + 1;
    const rInner = ts * 0.22;
    const rOuter = ts * 0.55 + pulse * ts * 0.22;
    const grd = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
    grd.addColorStop(0, `rgba(50,200,100,${0.18 * pulse})`);
    grd.addColorStop(1, 'rgba(50,200,100,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(px - ts * 0.15, py - ts * 0.15, ts * 1.3, ts * 1.3);
  }

  private drawWinRipple(timestamp: number) {
    const elapsed  = timestamp - this.winRippleStart;
    const duration = 1400;
    if (elapsed > duration) { this.winRippleStart = 0; return; }

    const ctx    = this.ctx;
    const maxR   = Math.max(this.canvas.width, this.canvas.height) * 1.1;
    const { x: cx, y: cy } = this.winRippleCenter;

    // Two offset rings
    ([0, 0.28] as const).forEach(delay => {
      const t = clamp((elapsed / duration) - delay, 0, 1);
      if (t <= 0) return;
      const radius = t * maxR;
      const alpha  = (1 - t) * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(50,200,100,${alpha})`;
      ctx.lineWidth   = 2.5 - t * 1.5;
      ctx.stroke();
    });
  }

  // ─── Icon helpers ─────────────────────────────────────────────────────────────

  private drawTrapIcon(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const ts = this.tileSize;
    const cx = px + ts / 2;
    const cy = py + ts / 2;
    const s  = ts * 0.22;
    ctx.strokeStyle = '#c83232';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke();
  }

  private drawExitIcon(ctx: CanvasRenderingContext2D, px: number, py: number, color = '#32c864') {
    const ts = this.tileSize;
    const cx = px + ts / 2;
    const cy = py + ts / 2;
    const s  = ts * 0.2;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx + s * 0.4, cy - s * 0.6);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx + s * 0.4, cy + s * 0.6);
    ctx.stroke();
  }

  private drawStartIcon(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const ts = this.tileSize;
    const cx = px + ts / 2;
    const cy = py + ts / 2;
    ctx.strokeStyle = '#4b8bc8';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.15, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawWallTexture(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number) {
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    const brickH = Math.floor(ts / 3);
    for (let row = 0; row < 3; row++) {
      const offset = row % 2 === 0 ? 0 : ts / 4;
      ctx.fillRect(px + offset + 3, py + row * brickH + 3, ts / 2 - 5, brickH - 2);
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

  // ─── Trap fade logic ─────────────────────────────────────────────────────────

  private computeTrapAlpha(state: GameState): number {
    if (!this.isRevealPhase) return 1;
    if (state.phase === 'countdown') return 0; // Fully hidden during countdown

    const { memorizeTime, trapFadeStart, trapFadeDuration } = state.config;
    const elapsed      = memorizeTime - state.memorizeTimer;
    const fadeProgress = clamp((elapsed - trapFadeStart) / trapFadeDuration, 0, 1);
    return 1 - fadeProgress;
  }

  // ─── Countdown flash ─────────────────────────────────────────────────────────

  flashCountdown(num: number) {
    const el = document.getElementById('countdown-flash')!;
    el.textContent      = num > 0 ? String(num) : 'GO!';
    el.style.transition = 'none';
    el.style.opacity    = '1';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'opacity 0.45s ease';
        el.style.opacity    = '0';
      });
    });
  }
}
