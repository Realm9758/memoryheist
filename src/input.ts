export type Direction = 'up' | 'down' | 'left' | 'right';

type InputCallback = (dir: Direction) => void;
type ActionCallback = () => void;

const DIR_KEYS: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

export class InputHandler {
  private moveCallback: InputCallback | null = null;
  private actionCallback: ActionCallback | null = null;
  private lastMoveTime = 0;
  private moveDelay = 120; // ms between moves

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
      return;
    }

    if ((e.key === 'Enter' || e.key === ' ') && this.actionCallback) {
      this.actionCallback();
      e.preventDefault();
    }
  }

  onMove(cb: InputCallback) {
    this.moveCallback = cb;
  }

  onAction(cb: ActionCallback) {
    this.actionCallback = cb;
  }

  clearMove() {
    this.moveCallback = null;
  }
}
