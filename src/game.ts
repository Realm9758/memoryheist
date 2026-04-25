import { GameState } from './types';
import { generateGrid, getLevelConfig } from './grid';
import { Renderer } from './renderer';
import { InputHandler, Direction } from './input';
import { AudioManager } from './audio';

const COUNTDOWN_STEPS = 3;

export class Game {
  private state!: GameState;
  private renderer: Renderer;
  private input: InputHandler;
  private audio: AudioManager;
  private animId = 0;
  private memorizeStartTime = 0;
  private countdownTimeout = 0;

  // DOM refs
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySub: HTMLElement;
  private overlayStats: HTMLElement;
  private btnStart: HTMLButtonElement;
  private btnRetry: HTMLButtonElement;
  private btnNext: HTMLButtonElement;
  private hudLevel: HTMLElement;
  private hudTimer: HTMLElement;
  private phaseBadge: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler();
    this.audio = new AudioManager();

    this.overlay     = document.getElementById('overlay')!;
    this.overlayTitle = this.overlay.querySelector('.overlay-title')!;
    this.overlaySub   = this.overlay.querySelector('.overlay-sub')!;
    this.overlayStats = this.overlay.querySelector('.overlay-stats')!;
    this.btnStart  = document.getElementById('btn-start') as HTMLButtonElement;
    this.btnRetry  = document.getElementById('btn-retry') as HTMLButtonElement;
    this.btnNext   = document.getElementById('btn-next') as HTMLButtonElement;
    this.hudLevel  = document.getElementById('hud-level')!;
    this.hudTimer  = document.getElementById('hud-timer')!;
    this.phaseBadge = document.getElementById('phase-badge')!;

    this.btnStart.addEventListener('click', () => this.startLevel(1));
    this.btnRetry.addEventListener('click', () => this.startLevel(this.state.level));
    this.btnNext.addEventListener('click',  () => this.startLevel(this.state.level + 1));

    this.input.onAction(() => {
      if (this.state?.phase === 'title') this.startLevel(1);
      else if (this.state?.phase === 'lose') this.startLevel(this.state.level);
      else if (this.state?.phase === 'win')  this.startLevel(this.state.level + 1);
    });

    this.initTitleState();
  }

  private initTitleState() {
    const config = getLevelConfig(1);
    this.renderer.resize(config.gridSize);
    const { grid, start, exit } = generateGrid(config);
    this.state = {
      phase: 'title',
      level: 1,
      grid,
      playerPos: { ...start },
      exitPos: exit,
      config,
      memorizeTimer: 0,
      escapeTimer: 0,
      escapeStartTime: 0,
      wrongMoves: 0,
      score: 0,
      perfectRun: true,
    };
    this.loop(performance.now());
  }

  private startLevel(level: number) {
    cancelAnimationFrame(this.animId);
    clearTimeout(this.countdownTimeout);

    const config = getLevelConfig(level);
    this.renderer.resize(config.gridSize);
    const { grid, start, exit } = generateGrid(config);

    // Reveal start tile immediately
    grid[start.y][start.x].revealed = true;

    this.state = {
      phase: 'memorize',
      level,
      grid,
      playerPos: { ...start },
      exitPos: exit,
      config,
      memorizeTimer: config.memorizeTime,
      escapeTimer: 0,
      escapeStartTime: 0,
      wrongMoves: 0,
      score: 0,
      perfectRun: true,
    };

    this.hideOverlay();
    this.updateHUD();
    this.setPhaseBadge('memorize');
    this.memorizeStartTime = performance.now();
    this.input.clearMove();

    this.animId = requestAnimationFrame(this.loop.bind(this));
    this.scheduleCountdown(config.memorizeTime);
  }

  private scheduleCountdown(memorizeMs: number) {
    // After memorize time, run countdown 3-2-1-GO
    this.countdownTimeout = window.setTimeout(() => {
      this.runCountdown(COUNTDOWN_STEPS);
    }, memorizeMs);
  }

  private runCountdown(step: number) {
    this.state.phase = 'countdown';
    this.audio.playCountdown(step);
    this.renderer.flashCountdown(step);
    this.updateHUD();

    if (step > 0) {
      this.countdownTimeout = window.setTimeout(() => this.runCountdown(step - 1), 700);
    } else {
      // Flash "GO" then start escape phase
      this.countdownTimeout = window.setTimeout(() => this.beginEscape(), 600);
    }
  }

  private beginEscape() {
    this.state.phase = 'escape';
    this.state.escapeStartTime = performance.now();
    this.setPhaseBadge('escape');
    this.input.onMove(this.handleMove.bind(this));
  }

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
      // Shake canvas slightly
      this.shakeCanvas();
      return;
    }

    // Move player
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
      this.showLoseScreen();
      return;
    }

    if (tile.type === 'exit') {
      const elapsed = (performance.now() - this.state.escapeStartTime) / 1000;
      const baseScore = 1000;
      const timeBonus = Math.max(0, Math.floor(500 - elapsed * 20));
      const perfectBonus = this.state.perfectRun ? 300 : 0;
      this.state.score = baseScore + timeBonus + perfectBonus;
      this.state.phase = 'win';
      this.audio.playWin();
      this.input.clearMove();
      this.showWinScreen(elapsed);
      return;
    }

    // Decoy tile: treat as empty
    if (tile.type === 'decoy') {
      tile.type = 'empty';
    }
  }

  private shakeCanvas() {
    const container = document.getElementById('canvas-container')!;
    container.style.transition = 'none';
    container.style.transform = 'translateX(-4px)';
    setTimeout(() => { container.style.transform = 'translateX(4px)'; }, 60);
    setTimeout(() => { container.style.transform = 'translateX(-2px)'; }, 120);
    setTimeout(() => { container.style.transform = 'translateX(0)'; }, 180);
  }

  private showLoseScreen() {
    this.overlayTitle.textContent = 'CAUGHT';
    this.overlayTitle.className = 'overlay-title red';
    this.overlaySub.textContent = 'You triggered a trap.';
    this.overlayStats.innerHTML = `Level <span>${this.state.level}</span> &nbsp;|&nbsp; Wrong moves <span>${this.state.wrongMoves}</span>`;
    this.showOverlay();
    this.btnRetry.style.display = 'block';
    this.btnNext.style.display = 'none';
    this.btnStart.style.display = 'none';
  }

  private showWinScreen(elapsed: number) {
    const perfect = this.state.perfectRun;
    this.overlayTitle.textContent = perfect ? 'PERFECT' : 'ESCAPED';
    this.overlayTitle.className = `overlay-title ${perfect ? 'gold' : 'cyan'}`;
    this.overlaySub.textContent = perfect ? 'No wrong moves. Impressive.' : 'Vault breached.';
    this.overlayStats.innerHTML =
      `Score <span>${this.state.score}</span><br/>` +
      `Time <span>${elapsed.toFixed(1)}s</span> &nbsp;|&nbsp; Level <span>${this.state.level}</span>`;
    this.showOverlay();
    this.btnRetry.style.display = 'none';
    this.btnNext.style.display = 'block';
    this.btnStart.style.display = 'none';
  }

  private showOverlay() {
    this.overlay.classList.remove('hidden');
  }

  private hideOverlay() {
    this.btnStart.style.display = 'none';
    this.btnRetry.style.display = 'none';
    this.btnNext.style.display = 'none';
    this.overlay.classList.add('hidden');
  }

  private updateHUD() {
    this.hudLevel.textContent = String(this.state.level);
    if (this.state.phase === 'memorize' || this.state.phase === 'countdown') {
      const remaining = Math.max(0, this.state.config.memorizeTime - (performance.now() - this.memorizeStartTime));
      this.hudTimer.textContent = (remaining / 1000).toFixed(1) + 's';
    } else if (this.state.phase === 'escape') {
      const elapsed = (performance.now() - this.state.escapeStartTime) / 1000;
      this.hudTimer.textContent = elapsed.toFixed(1) + 's';
    } else {
      this.hudTimer.textContent = '--';
    }
  }

  private setPhaseBadge(phase: 'memorize' | 'escape' | 'standby') {
    const badge = this.phaseBadge;
    badge.className = '';
    if (phase === 'memorize') {
      badge.textContent = 'Memorize';
      badge.classList.add('memorize');
    } else if (phase === 'escape') {
      badge.textContent = 'Escape';
      badge.classList.add('escape');
    } else {
      badge.textContent = 'Standby';
    }
  }

  private loop(timestamp: number) {
    this.animId = requestAnimationFrame(this.loop.bind(this));

    const { phase } = this.state;
    if (phase === 'win' || phase === 'lose' || phase === 'title') {
      // Still render for background effect
      this.renderer.render(this.state, timestamp);
      return;
    }

    if (phase === 'memorize') {
      const elapsed = timestamp - this.memorizeStartTime;
      const remaining = Math.max(0, this.state.config.memorizeTime - elapsed);
      this.state.memorizeTimer = remaining;
      this.hudTimer.textContent = (remaining / 1000).toFixed(1) + 's';
    } else if (phase === 'escape') {
      const elapsed = (timestamp - this.state.escapeStartTime) / 1000;
      this.hudTimer.textContent = elapsed.toFixed(1) + 's';
    }

    this.renderer.render(this.state, timestamp);
  }
}
