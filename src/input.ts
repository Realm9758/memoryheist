export type Direction = 'up' | 'down' | 'left' | 'right';

type InputCallback  = (dir: Direction) => void;
type ActionCallback = () => void;

const DIR_KEYS: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

export class InputHandler {
  private moveCallback:   InputCallback  | null = null;
  private actionCallback: ActionCallback | null = null;
  private anyKeyCallback: ActionCallback | null = null;
  private lastMoveTime = 0;
  private moveDelay    = 120;

  constructor() {
    window.addEventListener('keydown', this.handleKey.bind(this));
  }

  private handleKey(e: KeyboardEvent) {
    const dir = DIR_KEYS[e.key];

    if (dir && this.moveCallback) {
      const now = performance.now();
      if (now - this.lastMoveTime >= this.moveDelay) {
        this.lastMoveTime = now;
        this.moveCallback(dir);
      }
      e.preventDefault();
      // Any-key fires on direction keys too (for instant restart)
      this.anyKeyCallback?.();
      return;
    }

    if ((e.key === 'Enter' || e.key === ' ') && this.actionCallback) {
      this.actionCallback();
      e.preventDefault();
      this.anyKeyCallback?.();
      return;
    }

    // Any other key
    this.anyKeyCallback?.();
  }

  onMove(cb: InputCallback) { this.moveCallback = cb; }
  onAction(cb: ActionCallback) { this.actionCallback = cb; }

  // Fires on any keypress — used for instant restart after death
  onAnyKey(cb: ActionCallback | null) { this.anyKeyCallback = cb; }

  clearMove() { this.moveCallback = null; }
}
