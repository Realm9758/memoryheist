import { GameState, Tile, TileType, Position } from './types';

const COLORS = {
  bg:         '#0a0a0f',
  empty:      '#131320',
  wall:       '#1a1a2e',
  wallBorder: '#252540',
  trap:       '#3d0f0f',
  trapBorder: '#8b1a1a',
  exit:       '#0d3320',
  exitBorder: '#1a8b50',
  decoy:      '#1a2a0d',
  decoyBorder:'#3a6b1a',
  start:      '#0d1a33',
  startBorder:'#1a4b8b',
  fog:        '#0d0d14',
  fogBorder:  '#15151f',
  player:     '#c8a84b',
  fakeTrap:   '#141422',
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tileSize = 64;
  private padding  = 4;

  private revealAnimations: Map<string, number> = new Map();
  private playerTrail: { x: number; y: number; time: number }[] = [];
  private playerMoveTime = 0;
  private winRippleStart  = 0;
  private winRippleCenter = { x: 0, y: 0 };

  // Set once per frame at top of render()
  private currentTimestamp = 0;
  private isRevealPhase    = false;
  private currentTrapAlpha = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(gridSize: number) {
    const maxCanvas = Math.min(window.innerWidth - 40, window.innerHeight - 180, 600);
    this.tileSize = Math.floor((maxCanvas - this.padding * 2) / gridSize);
    const canvasSize = this.tileSize * gridSize + this.padding * 2;
    this.canvas.width  = canvasSize;
    this.canvas.height = canvasSize;
    (document.getElementById('canvas-container') as HTMLElement).style.width = canvasSize + 'px';
    this.playerTrail   = [];
    this.winRippleStart = 0;
  }

  private tx(x: number) { return this.padding + x * this.tileSize; }
  private ty(y: number) { return this.padding + y * this.tileSize; }

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

  // ─── Main render ──────────────────────────────────────────────────────────────

  render(state: GameState, timestamp: number) {
    this.currentTimestamp = timestamp;
    this.isRevealPhase    = state.phase === 'memorize' || state.phase === 'countdown';
    this.currentTrapAlpha = this.computeTrapAlpha(state);

    const ctx = this.ctx;
    const { grid, playerPos, config, phase } = state;
    const size = config.gridSize;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawGridGlow();

    // Vision radius logic (only during escape)
    const isEscape       = phase === 'escape';
    const visionLimited  = isEscape && config.visionRadius < 999;
    const isPeeking      = isEscape && state.peekEndTime > 0 && timestamp <= state.peekEndTime;
    const px             = playerPos.x;
    const py             = playerPos.y;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = grid[y][x];
        const ptx  = this.tx(x);
        const pty  = this.ty(y);
        const ts   = this.tileSize - 2;

        if (this.isRevealPhase) {
          // Memorize / countdown: full grid visible with trap-fade/flicker
          this.drawRevealPhaseTile(ctx, tile, ptx, pty, ts);

        } else if (visionLimited) {
          // ── Limited vision mode ────────────────────────────────────────────
          const dist    = Math.abs(x - px) + Math.abs(y - py);
          const inRange = isPeeking || dist <= config.visionRadius;

          if (!inRange) {
            this.drawFog(ctx, ptx, pty, ts);
          } else {
            const revKey  = `${x},${y}`;
            const revTime = this.revealAnimations.get(revKey);
            const revProg = revTime ? clamp((timestamp - revTime) / 280, 0, 1) : 0;

            if (tile.revealed) {
              if (revProg < 1) {
                this.drawRevealAnimation(ctx, tile, ptx, pty, ts, revProg);
              } else {
                this.drawTileRevealed(ctx, tile, ptx, pty, ts);
                this.revealAnimations.delete(revKey);
              }
            } else {
              // In vision range but not yet stepped — preview at reduced brightness
              this.drawTilePreview(ctx, tile, ptx, pty, ts);
            }
          }

        } else {
          // ── Standard fog-of-war (unlimited vision levels) ──────────────────
          const revKey  = `${x},${y}`;
          const revTime = this.revealAnimations.get(revKey);
          const revProg = revTime ? clamp((timestamp - revTime) / 280, 0, 1) : 0;

          if (tile.revealed) {
            if (revProg < 1) {
              this.drawRevealAnimation(ctx, tile, ptx, pty, ts, revProg);
            } else {
              this.drawTileRevealed(ctx, tile, ptx, pty, ts);
              this.revealAnimations.delete(revKey);
            }
          } else {
            this.drawFog(ctx, ptx, pty, ts);
          }
        }
      }
    }

    // Spotlight vignette when limited vision is active (not peeking)
    if (visionLimited && !isPeeking) this.drawSpotlight(playerPos, config.visionRadius);

    if (this.winRippleStart > 0) this.drawWinRipple(timestamp);

    this.drawPlayer(ctx, playerPos, timestamp);
  }

  // ─── Tile drawing ──────────────────────────────────────────────────────────

  // During the memorize phase — handles trap-fade/flicker and fake_trap disguise
  private drawRevealPhaseTile(ctx: CanvasRenderingContext2D, tile: Tile, px: number, py: number, ts: number) {
    const isTrapLike = tile.type === 'trap' || tile.type === 'fake_trap';

    if (isTrapLike) {
      // Underlay: fade reveals empty tile beneath
      this.drawTileRevealed(ctx, { type: 'empty', revealed: false }, px, py, ts);

      let alpha = this.currentTrapAlpha;
      if (tile.flickering) {
        const hash    = px * 0.0037 + py * 0.0071;
        const flicker = 0.25 + 0.75 * Math.max(0, Math.sin(this.currentTimestamp * 0.013 + hash));
        alpha *= flicker;
      }

      if (alpha > 0.02) {
        ctx.globalAlpha = alpha;
        // fake_trap looks identical to a real trap until stepped on
        this.drawTileRevealed(ctx, { ...tile, type: 'trap' }, px, py, ts);
        ctx.globalAlpha = 1;
      }
    } else {
      this.drawTileRevealed(ctx, tile, px, py, ts);
    }
  }

  // In-range but not yet stepped — shows tile type dimmed so player can "feel around"
  private drawTilePreview(ctx: CanvasRenderingContext2D, tile: Tile, px: number, py: number, ts: number) {
    // fake_trap looks like real trap until stepped on (same as memorize phase)
    const displayTile: Tile = tile.type === 'fake_trap' ? { ...tile, type: 'trap' as TileType } : tile;
    this.drawTileRevealed(ctx, displayTile, px, py, ts);
    // Dim overlay — visually distinct from stepped tiles
    ctx.fillStyle = 'rgba(5, 5, 15, 0.5)';
    this.roundRect(ctx, px + 1, py + 1, ts, ts, 3);
    ctx.fill();
  }

  // Scale-pop + gold flash on step
  private drawRevealAnimation(ctx: CanvasRenderingContext2D, tile: Tile, px: number, py: number, ts: number, revProg: number) {
    const scale = 1 + (1 - revProg) * 0.18;
    const cx    = px + ts / 2 + 1;
    const cy    = py + ts / 2 + 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    this.drawTileRevealed(ctx, tile, px, py, ts);
    ctx.restore();
    ctx.fillStyle = `rgba(200,168,75,${(1 - revProg) * 0.45})`;
    this.roundRect(ctx, px + 1, py + 1, ts, ts, 3);
    ctx.fill();
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
        // Revealed state: player stepped on it and found it safe
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

  // ─── Player ────────────────────────────────────────────────────────────────

  private drawPlayer(ctx: CanvasRenderingContext2D, pos: Position, timestamp: number) {
    const ptx = this.tx(pos.x);
    const pty = this.ty(pos.y);
    const ts  = this.tileSize;
    const cx  = ptx + ts / 2;
    const cy  = pty + ts / 2;

    // Fading trail
    const trailDur = 380;
    for (const point of this.playerTrail) {
      const age   = timestamp - point.time;
      if (age > trailDur) continue;
      const frac  = 1 - age / trailDur;
      const pcx   = this.tx(point.x) + ts / 2;
      const pcy   = this.ty(point.y) + ts / 2;
      ctx.fillStyle = `rgba(200,168,75,${frac * 0.25})`;
      ctx.beginPath();
      ctx.arc(pcx, pcy, Math.max(1, ts * 0.1 * frac), 0, Math.PI * 2);
      ctx.fill();
    }

    // Pop scale on move (200ms)
    const sinceMove = this.playerMoveTime > 0 ? timestamp - this.playerMoveTime : 9999;
    const popScale  = sinceMove < 200 ? 1 + 0.32 * Math.sin((sinceMove / 200) * Math.PI) : 1;
    const r         = ts * 0.22 * popScale;
    const pulse     = 0.82 + 0.18 * Math.sin(timestamp * 0.0035);

    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.3 * pulse);
    grd.addColorStop(0, 'rgba(200,168,75,0.38)');
    grd.addColorStop(1, 'rgba(200,168,75,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.3 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.33, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Atmospheric effects ──────────────────────────────────────────────────

  private drawGridGlow() {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;
    const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    grd.addColorStop(0, 'rgba(35,35,75,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }

  // Darkens toward the edges of the player's vision bubble
  private drawSpotlight(playerPos: Position, radius: number) {
    const ctx = this.ctx;
    const cx  = this.tx(playerPos.x) + this.tileSize / 2;
    const cy  = this.ty(playerPos.y) + this.tileSize / 2;
    const r1  = (radius + 0.8) * this.tileSize;
    const r2  = r1 * 1.6;
    const grd = ctx.createRadialGradient(cx, cy, r1, cx, cy, r2);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,10,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawExitPulse(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number) {
    const pulse  = 0.45 + 0.55 * Math.sin(this.currentTimestamp * 0.0028);
    const cx     = px + ts / 2 + 1;
    const cy     = py + ts / 2 + 1;
    const rInner = ts * 0.22;
    const rOuter = ts * 0.55 + pulse * ts * 0.22;
    const grd    = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
    grd.addColorStop(0, `rgba(50,200,100,${0.18 * pulse})`);
    grd.addColorStop(1, 'rgba(50,200,100,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(px - ts * 0.15, py - ts * 0.15, ts * 1.3, ts * 1.3);
  }

  private drawWinRipple(timestamp: number) {
    const elapsed  = timestamp - this.winRippleStart;
    const duration = 1400;
    if (elapsed > duration) { this.winRippleStart = 0; return; }

    const ctx  = this.ctx;
    const maxR = Math.max(this.canvas.width, this.canvas.height) * 1.1;
    const { x: cx, y: cy } = this.winRippleCenter;

    ([0, 0.28] as const).forEach(delay => {
      const t = clamp((elapsed / duration) - delay, 0, 1);
      if (t <= 0) return;
      ctx.beginPath();
      ctx.arc(cx, cy, t * maxR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(50,200,100,${(1 - t) * 0.55})`;
      ctx.lineWidth   = 2.5 - t * 1.5;
      ctx.stroke();
    });
  }

  // ─── Icon helpers ────────────────────────────────────────────────────────

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
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx + s * 0.4, cy - s * 0.6); ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx + s * 0.4, cy + s * 0.6);
    ctx.stroke();
  }

  private drawStartIcon(ctx: CanvasRenderingContext2D, px: number, py: number) {
    ctx.strokeStyle = '#4b8bc8';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(px + this.tileSize / 2, py + this.tileSize / 2, this.tileSize * 0.15, 0, Math.PI * 2);
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
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── Trap fade logic ──────────────────────────────────────────────────────

  private computeTrapAlpha(state: GameState): number {
    if (!this.isRevealPhase) return 1;
    if (state.phase === 'countdown') return 0;

    const { memorizeTime, trapFadeStart, trapFadeDuration } = state.config;
    const elapsed      = memorizeTime - state.memorizeTimer;
    const fadeProgress = clamp((elapsed - trapFadeStart) / (trapFadeDuration || 1), 0, 1);
    return 1 - fadeProgress;
  }

  // ─── Countdown flash ──────────────────────────────────────────────────────

  flashCountdown(num: number) {
    const el            = document.getElementById('countdown-flash')!;
    el.textContent      = num > 0 ? String(num) : 'GO!';
    el.style.transition = 'none';
    el.style.opacity    = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.45s ease';
      el.style.opacity    = '0';
    }));
  }
}
