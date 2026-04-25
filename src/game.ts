import { GameState } from './types';
import { generateGrid, getLevelConfig } from './grid';
import { Renderer } from './renderer';
import { InputHandler, Direction } from './input';
import { AudioManager } from './audio';

const COUNTDOWN_STEPS = 3;
const LS_BEST      = 'mh_best_level';
const LS_TUTORIALS = 'mh_tutorials_seen'; // JSON array of level numbers already shown

// ── Tutorial messages ────────────────────────────────────────────────────────
// Each entry shown exactly once, at the level where its mechanic first appears.
const TUTORIALS: Record<number, { title: string; desc: string }> = {
  3:  {
    title: 'Uncertain Memory',
    desc:  'Not everything you see is reliable.\nTraps may vanish before the timer runs out.',
  },
  5:  {
    title: 'False Exits',
    desc:  'Not all exits lead out.\nOne is real — the rest are decoys.',
  },
  7:  {
    title: 'Peek Ability',
    desc:  'Press SPACE to briefly reveal the full map.\nLimited uses — spend them wisely.',
  },
  9:  {
    title: 'Limited Vision',
    desc:  'You can only see tiles within 2 steps.\nNavigate from memory in the dark.',
  },
  11: {
    title: 'Traps Move',
    desc:  'Some traps patrol the vault.\nThey shift position each time you move.',
  },
};

export class Game {
  private state!: GameState;
  private renderer: Renderer;
  private input:    InputHandler;
  private audio:    AudioManager;
  private animId   = 0;
  private memorizeStartTime = 0;
  private countdownTimeout  = 0;
  private loseOverlayTimeout = 0;
  private lastTickSecond    = -1;
  private bestLevel: number;

  // DOM refs
  private overlay:       HTMLElement;
  private overlayTitle:  HTMLElement;
  private overlaySub:    HTMLElement;
  private overlayStats:  HTMLElement;
  private btnStart:      HTMLButtonElement;
  private btnRetry:      HTMLButtonElement;
  private btnNext:       HTMLButtonElement;
  private hudLevel:      HTMLElement;
  private hudTimer:      HTMLElement;
  private hudBest:       HTMLElement;
  private phaseBadge:    HTMLElement;
  private deathFlashEl:  HTMLElement;
  private winFlashEl:    HTMLElement;
  private peekRow:       HTMLElement;
  private peekDots:      HTMLElement;
  private canvasContainer: HTMLElement;
  // Tutorial overlay refs
  private tutOverlay:  HTMLElement;
  private tutTitle:    HTMLElement;
  private tutDesc:     HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input    = new InputHandler();
    this.audio    = new AudioManager();

    this.bestLevel = parseInt(localStorage.getItem(LS_BEST) || '0', 10);

    this.overlay      = document.getElementById('overlay')!;
    this.overlayTitle = this.overlay.querySelector('.overlay-title')!;
    this.overlaySub   = this.overlay.querySelector('.overlay-sub')!;
    this.overlayStats = this.overlay.querySelector('.overlay-stats')!;
    this.btnStart     = document.getElementById('btn-start')  as HTMLButtonElement;
    this.btnRetry     = document.getElementById('btn-retry')  as HTMLButtonElement;
    this.btnNext      = document.getElementById('btn-next')   as HTMLButtonElement;
    this.hudLevel     = document.getElementById('hud-level')!;
    this.hudTimer     = document.getElementById('hud-timer')!;
    this.hudBest      = document.getElementById('hud-best')!;
    this.phaseBadge   = document.getElementById('phase-badge')!;
    this.deathFlashEl = document.getElementById('death-flash')!;
    this.winFlashEl   = document.getElementById('win-flash')!;
    this.peekRow      = document.getElementById('peek-row')!;
    this.peekDots     = document.getElementById('peek-dots')!;
    this.canvasContainer = document.getElementById('canvas-container')!;
    this.tutOverlay   = document.getElementById('tutorial-overlay')!;
    this.tutTitle     = document.getElementById('tut-title')!;
    this.tutDesc      = document.getElementById('tut-desc')!;

    this.btnStart.addEventListener('click', () => this.startLevel(1));
    this.btnRetry.addEventListener('click', () => this.startLevel(this.state.level));
    this.btnNext.addEventListener('click',  () => this.startLevel(this.state.level + 1));

    // Space during escape = peek; otherwise standard action (title/win/lose)
    this.input.onAction(() => {
      const phase = this.state?.phase;
      if (phase === 'escape')  { this.usePeek(); }
      else if (phase === 'title') { this.startLevel(1); }
      else if (phase === 'win')   { this.startLevel(this.state.level + 1); }
      else if (phase === 'lose')  { this.startLevel(this.state.level); }
    });

    this.updateBestDisplay();
    this.initTitleState();
  }

  // ─── Level lifecycle ───────────────────────────────────────────────────────

  private initTitleState() {
    const config = getLevelConfig(1);
    this.renderer.resize(config.gridSize);
    const { grid, start, exit } = generateGrid(config);
    this.state = {
      phase: 'title', level: 1,
      grid, playerPos: { ...start }, exitPos: exit, config,
      memorizeTimer: 0, escapeTimeRemaining: 0, escapeStartTime: 0,
      wrongMoves: 0, score: 0, perfectRun: true,
      peeksRemaining: 0, peekEndTime: 0,
    };
    this.animId = requestAnimationFrame(this.loop.bind(this));
  }

  private startLevel(level: number) {
    cancelAnimationFrame(this.animId);
    clearTimeout(this.countdownTimeout);
    clearTimeout(this.loseOverlayTimeout);
    this.input.clearMove();
    this.input.onAnyKey(null);
    this.lastTickSecond = -1;
    this.resetTimerColor();
    this.canvasContainer.classList.remove('peeking');

    const config = getLevelConfig(level);
    this.renderer.resize(config.gridSize);
    const { grid, start, exit } = generateGrid(config);
    grid[start.y][start.x].revealed = true;

    this.state = {
      phase: 'memorize', level,
      grid, playerPos: { ...start }, exitPos: exit, config,
      memorizeTimer: config.memorizeTime,
      escapeTimeRemaining: config.escapeTimeLimit,
      escapeStartTime: 0,
      wrongMoves: 0, score: 0, perfectRun: true,
      peeksRemaining: config.peekCount,
      peekEndTime: 0,
    };

    this.hideOverlay();
    this.hideTutorialOverlay();
    this.updatePeekHUD();
    this.hudLevel.textContent = String(level);
    this.hudTimer.textContent = '--';

    this.animId = requestAnimationFrame(this.loop.bind(this));

    // Show tutorial first if this level introduces a mechanic (once ever)
    const tut = this.getPendingTutorial(level);
    if (tut) {
      this.state.phase = 'tutorial';
      this.showTutorialOverlay(tut.title, tut.desc, level);
    } else {
      this.beginMemorize();
    }
  }

  // Extracted so tutorial can call it after dismissal
  private beginMemorize() {
    this.state.phase = 'memorize';
    this.memorizeStartTime = performance.now();
    this.setPhaseBadge('memorize');
    this.countdownTimeout = window.setTimeout(
      () => this.runCountdown(COUNTDOWN_STEPS),
      this.state.config.memorizeTime
    );
  }

  private runCountdown(step: number) {
    this.state.phase = 'countdown';
    this.audio.playCountdown(step);
    this.renderer.flashCountdown(step);

    if (step > 0) {
      this.countdownTimeout = window.setTimeout(() => this.runCountdown(step - 1), 700);
    } else {
      this.countdownTimeout = window.setTimeout(() => this.beginEscape(), 580);
    }
  }

  private beginEscape() {
    this.state.phase = 'escape';
    this.state.escapeStartTime     = performance.now();
    this.state.escapeTimeRemaining = this.state.config.escapeTimeLimit;
    this.setPhaseBadge('escape');
    this.input.onMove(this.handleMove.bind(this));
  }

  // ─── Tutorial system ───────────────────────────────────────────────────────

  private getPendingTutorial(level: number): { title: string; desc: string } | null {
    const tut = TUTORIALS[level];
    if (!tut) return null;
    const seen: number[] = JSON.parse(localStorage.getItem(LS_TUTORIALS) || '[]');
    if (seen.includes(level)) return null;
    // Mark as seen immediately so a hard refresh doesn't re-show
    seen.push(level);
    localStorage.setItem(LS_TUTORIALS, JSON.stringify(seen));
    return tut;
  }

  private showTutorialOverlay(title: string, desc: string, _level: number) {
    this.tutTitle.textContent = title;
    this.tutDesc.textContent  = desc;
    this.tutOverlay.classList.remove('hidden');

    // Any key dismisses and begins memorize
    this.input.onAnyKey(() => {
      if (this.state?.phase === 'tutorial') this.dismissTutorial();
    });

    // Also allow clicking the overlay itself
    const onClick = () => {
      if (this.state?.phase === 'tutorial') {
        this.dismissTutorial();
        this.tutOverlay.removeEventListener('click', onClick);
      }
    };
    this.tutOverlay.addEventListener('click', onClick);
  }

  private hideTutorialOverlay() {
    this.tutOverlay.classList.add('hidden');
  }

  private dismissTutorial() {
    this.input.onAnyKey(null);
    this.hideTutorialOverlay();
    this.beginMemorize();
  }

  // ─── Move handling ─────────────────────────────────────────────────────────

  private handleMove(dir: Direction) {
    if (this.state.phase !== 'escape') return;

    const { playerPos, grid, config } = this.state;
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dy = dir === 'up'   ? -1 : dir === 'down'  ? 1 : 0;
    const nx = playerPos.x + dx;
    const ny = playerPos.y + dy;

    if (nx < 0 || ny < 0 || nx >= config.gridSize || ny >= config.gridSize) return;

    const tile = grid[ny][nx];
    if (tile.type === 'wall') {
      this.state.wrongMoves++;
      this.state.perfectRun = false;
      this.shakeCanvas(false);
      return;
    }

    // Trail + pop animation — must fire before updating playerPos
    this.renderer.notifyPlayerMoved(playerPos, { x: nx, y: ny }, performance.now());
    this.state.playerPos = { x: nx, y: ny };
    this.audio.playStep();

    if (!tile.revealed) {
      tile.revealed = true;
      this.renderer.triggerReveal(nx, ny);
    }

    if (tile.type === 'trap') {
      this.state.phase = 'lose';
      this.audio.playTrap();
      this.input.clearMove();
      this.shakeCanvas(true);
      this.showLoseScreen();
      return;
    }

    if (tile.type === 'fake_trap') {
      this.audio.playFakeTrap();
      // Tile stays as fake_trap (revealed = true), shows safe ghost-X
    } else if (tile.type === 'decoy') {
      tile.type = 'empty';
    } else if (tile.type === 'exit') {
      const elapsed      = (performance.now() - this.state.escapeStartTime) / 1000;
      const timeBonus    = Math.max(0, Math.floor(500 - elapsed * 20));
      const perfectBonus = this.state.perfectRun ? 300 : 0;
      this.state.score   = 1000 + timeBonus + perfectBonus;
      this.state.phase   = 'win';
      this.audio.playWin();
      this.input.clearMove();
      this.renderer.triggerWinEffect(this.state.exitPos, performance.now());
      this.triggerWinFlash();
      this.showWinScreen(elapsed);
      return;
    }

    // Moving traps shift on every player step (level 11+)
    this.updateMovingTraps();
  }

  // ─── Peek mechanic ─────────────────────────────────────────────────────────

  private usePeek() {
    if (this.state.phase !== 'escape') return;
    if (this.state.peeksRemaining <= 0) return;
    if (this.state.peekEndTime > performance.now()) return; // already peeking

    this.state.peeksRemaining--;
    this.state.peekEndTime = performance.now() + this.state.config.peekDuration;
    this.audio.playPeek();
    this.updatePeekHUD(true);

    this.canvasContainer.classList.add('peeking');
    setTimeout(() => {
      this.canvasContainer.classList.remove('peeking');
      this.updatePeekHUD(false);
    }, this.state.config.peekDuration);
  }

  private updatePeekHUD(activePeek = false) {
    const { peeksRemaining, config } = this.state;
    if (config.peekCount === 0 || config.peekCount === undefined) {
      this.peekRow.classList.remove('visible');
      return;
    }
    this.peekRow.classList.add('visible');
    this.peekDots.textContent = '●'.repeat(peeksRemaining) + '○'.repeat(config.peekCount - peeksRemaining);
    if (activePeek) {
      this.peekDots.classList.add('is-peeking');
    } else {
      this.peekDots.classList.remove('is-peeking');
    }
  }

  // ─── Moving traps ──────────────────────────────────────────────────────────

  private updateMovingTraps() {
    const { grid, config, playerPos } = this.state;
    const size = config.gridSize;
    if (!config.movingTrapCount) return;

    // Snapshot positions first to avoid processing a trap twice in one step
    const movingTraps: { x: number; y: number }[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (grid[y][x].type === 'trap' && grid[y][x].moving)
          movingTraps.push({ x, y });

    for (const pos of movingTraps) {
      if (grid[pos.y][pos.x].type !== 'trap') continue; // already moved this step
      if (Math.random() > 0.5) continue;                // 50% chance to move

      const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
      const valid = dirs.filter(d => {
        const nx = pos.x + d.x, ny = pos.y + d.y;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) return false;
        const t = grid[ny][nx];
        // Only move onto unrevealed empty/start cells; never onto the player
        return (t.type === 'empty' || t.type === 'start') &&
               !t.revealed &&
               !(nx === playerPos.x && ny === playerPos.y);
      });

      if (!valid.length) continue;

      const dir = valid[Math.floor(Math.random() * valid.length)];
      const nx  = pos.x + dir.x, ny = pos.y + dir.y;

      grid[ny][nx] = { type: 'trap', revealed: false, moving: true };
      grid[pos.y][pos.x] = { type: 'empty', revealed: false };
    }
  }

  // ─── Game loop ──────────────────────────────────────────────────────────────

  private loop(timestamp: number) {
    this.animId = requestAnimationFrame(this.loop.bind(this));
    const { phase } = this.state;

    if (phase === 'memorize') {
      const elapsed   = timestamp - this.memorizeStartTime;
      const remaining = Math.max(0, this.state.config.memorizeTime - elapsed);
      this.state.memorizeTimer = remaining;
      this.hudTimer.textContent = (remaining / 1000).toFixed(1) + 's';
      this.hudTimer.style.color = '#c8a84b';
    } else if (phase === 'escape') {
      this.updateEscapeTimer(timestamp);
    }
    // title / tutorial / countdown / win / lose: no timer update needed

    this.renderer.render(this.state, timestamp);
  }

  private updateEscapeTimer(timestamp: number) {
    const elapsed = timestamp - this.state.escapeStartTime;
    const { escapeTimeLimit } = this.state.config;

    if (escapeTimeLimit > 0) {
      const remaining = Math.max(0, escapeTimeLimit - elapsed);
      this.state.escapeTimeRemaining = remaining;
      const ratio = remaining / escapeTimeLimit;

      this.hudTimer.textContent = (remaining / 1000).toFixed(1) + 's';
      if (ratio > 0.5)       { this.hudTimer.style.color = '#c8a84b'; this.hudTimer.classList.remove('timer-pulse'); }
      else if (ratio > 0.25) { this.hudTimer.style.color = '#ffd000'; this.hudTimer.classList.remove('timer-pulse'); }
      else if (ratio > 0.1)  { this.hudTimer.style.color = '#ff8800'; this.hudTimer.classList.remove('timer-pulse'); }
      else                   { this.hudTimer.style.color = '#ff3333'; this.hudTimer.classList.add('timer-pulse'); }

      if (remaining > 0 && remaining <= 5000) {
        const s = Math.ceil(remaining / 1000);
        if (s !== this.lastTickSecond) { this.lastTickSecond = s; this.audio.playTick(); }
      }

      if (remaining <= 0 && this.state.phase === 'escape') this.handleTimeExpired();
    } else {
      this.hudTimer.textContent = (elapsed / 1000).toFixed(1) + 's';
      this.hudTimer.style.color = '#c8a84b';
    }
  }

  private handleTimeExpired() {
    this.state.phase = 'lose';
    this.audio.playTrap();
    this.input.clearMove();
    this.shakeCanvas(true);
    this.showLoseScreen("TIME'S UP");
  }

  // ─── Screens ───────────────────────────────────────────────────────────────

  private showLoseScreen(title = 'CAUGHT') {
    this.triggerDeathFlash();
    clearTimeout(this.loseOverlayTimeout);
    this.loseOverlayTimeout = window.setTimeout(() => {
      if (this.state.phase !== 'lose') return;
      this.overlayTitle.textContent = title;
      this.overlayTitle.className   = 'overlay-title red';
      this.overlaySub.textContent   = title === "TIME'S UP"
        ? 'You ran out of time.' : 'You triggered a trap.';
      this.overlayStats.innerHTML =
        `Level <span>${this.state.level}</span> &nbsp;|&nbsp; Wrong moves <span>${this.state.wrongMoves}</span>`;
      this.showOverlay();
      this.btnRetry.style.display = 'block';
      this.btnNext.style.display  = 'none';
      this.btnStart.style.display = 'none';
      this.input.onAnyKey(() => {
        if (this.state?.phase === 'lose') this.startLevel(this.state.level);
      });
    }, 380);
  }

  private showWinScreen(elapsed: number) {
    const perfect    = this.state.perfectRun;
    const isNewBest  = this.state.level > this.bestLevel;
    if (isNewBest) {
      this.bestLevel = this.state.level;
      localStorage.setItem(LS_BEST, String(this.bestLevel));
      this.updateBestDisplay();
    }
    this.overlayTitle.textContent = perfect ? 'PERFECT' : 'ESCAPED';
    this.overlayTitle.className   = `overlay-title ${perfect ? 'gold' : 'cyan'}`;
    this.overlaySub.textContent   = perfect
      ? 'No wrong moves. Impressive.'
      : isNewBest ? '★ New best level!' : 'Vault breached.';
    this.overlayStats.innerHTML =
      `Score <span>${this.state.score}</span><br/>` +
      `Time <span>${elapsed.toFixed(1)}s</span> &nbsp;|&nbsp; Level <span>${this.state.level}</span>`;
    this.showOverlay();
    this.btnRetry.style.display = 'none';
    this.btnNext.style.display  = 'block';
    this.btnStart.style.display = 'none';
  }

  private showOverlay() { this.overlay.classList.remove('hidden'); }
  private hideOverlay() {
    this.btnStart.style.display = 'none';
    this.btnRetry.style.display = 'none';
    this.btnNext.style.display  = 'none';
    this.overlay.classList.add('hidden');
  }

  // ─── Visual effects ─────────────────────────────────────────────────────────

  private triggerDeathFlash() {
    const el = this.deathFlashEl;
    el.style.transition = 'none';
    el.style.opacity    = '0.72';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.5s ease-out';
      el.style.opacity    = '0';
    }));
  }

  private triggerWinFlash() {
    const el = this.winFlashEl;
    el.style.transition = 'none';
    el.style.opacity    = '0.45';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.65s ease-out';
      el.style.opacity    = '0';
    }));
  }

  private shakeCanvas(intense: boolean) {
    const container = this.canvasContainer;
    const d = intense ? 9 : 4;
    container.style.transition = 'none';
    container.style.transform  = `translateX(-${d}px)`;
    setTimeout(() => { container.style.transform = `translateX(${d}px)`;          }, 55);
    setTimeout(() => { container.style.transform = `translateX(-${d * 0.5}px)`;   }, 110);
    setTimeout(() => { container.style.transform = `translateX(${d * 0.5}px)`;    }, 160);
    setTimeout(() => { container.style.transform = 'translateX(0)';               }, 210);
  }

  // ─── HUD helpers ────────────────────────────────────────────────────────────

  private setPhaseBadge(phase: 'memorize' | 'escape' | 'standby') {
    const b = this.phaseBadge;
    b.className = '';
    if (phase === 'memorize')     { b.textContent = 'Memorize'; b.classList.add('memorize'); }
    else if (phase === 'escape')  { b.textContent = 'Escape';   b.classList.add('escape'); }
    else                          { b.textContent = 'Standby'; }
  }

  private resetTimerColor() {
    this.hudTimer.style.color = '#c8a84b';
    this.hudTimer.classList.remove('timer-pulse');
    this.peekRow.classList.remove('visible');
    this.peekDots.classList.remove('is-peeking');
  }

  private updateBestDisplay() {
    this.hudBest.textContent = this.bestLevel > 0 ? String(this.bestLevel) : '--';
  }
}
