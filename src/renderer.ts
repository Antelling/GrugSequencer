// Canvas rendering infrastructure: HiDPI support, dirty flag, view dispatch.
// Tab bar is handled by the DOM — this only manages the canvas content area.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };

export type HitResult = { type: string; [key: string]: unknown };

export interface View {
  readonly id: string;
  readonly label: string;
  render(ctx: CanvasRenderingContext2D, rect: Rect): void;
  hitTest(x: number, y: number, rect: Rect): HitResult | null;
  activate?(): void;
  deactivate?(): void;
}

// ---------------------------------------------------------------------------
// Renderer singleton
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let dpr = 1;

let views: View[] = [];
let activeViewId: string | null = null;

let dirty = true;
let rafId = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cssSize(): { w: number; h: number } {
  if (!canvas) return { w: 0, h: 0 };
  return { w: canvas.clientWidth, h: canvas.clientHeight };
}

function contentRect(): Rect {
  const { w, h } = cssSize();
  return { x: 0, y: 0, w, h };
}

function activeView(): View | undefined {
  return views.find(v => v.id === activeViewId);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawFrame(): void {
  if (!ctx || !canvas) return;
  const { w, h } = cssSize();

  ctx.clearRect(0, 0, w, h);

  // Content background
  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, w, h);

  // Delegate to active view
  const view = activeView();
  if (view) {
    const rect = contentRect();
    view.render(ctx, rect);
  }
}

// ---------------------------------------------------------------------------
// rAF loop
// ---------------------------------------------------------------------------

function loop(): void {
  if (dirty) {
    dirty = false;
    drawFrame();
  }
  rafId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// HiDPI
// ---------------------------------------------------------------------------

function applyDpr(): void {
  if (!canvas || !ctx) return;
  dpr = window.devicePixelRatio || 1;
  const { w, h } = cssSize();
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function handleResize(): void {
  applyDpr();
  dirty = true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const Renderer = {
  init(c: HTMLCanvasElement): void {
    canvas = c;
    ctx = c.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context');

    applyDpr();
    window.addEventListener('resize', handleResize);

    dirty = true;
    rafId = requestAnimationFrame(loop);
  },

  registerView(view: View): void {
    views.push(view);
    if (views.length === 1) {
      activeViewId = view.id;
      view.activate?.();
    }
    dirty = true;
  },

  setActiveView(id: string): void {
    if (id === activeViewId) return;
    const prev = activeView();
    prev?.deactivate?.();

    activeViewId = id;

    const next = activeView();
    next?.activate?.();

    dirty = true;
  },

  activeViewId(): string | null {
    return activeViewId;
  },

  markDirty(): void {
    dirty = true;
  },

  resize(): void {
    handleResize();
  },

  handlePointer(x: number, y: number): HitResult | null {
    const view = activeView();
    if (view) {
      return view.hitTest(x, y, contentRect());
    }
    return null;
  },

  dispose(): void {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', handleResize);
    canvas = null;
    ctx = null;
    views = [];
    activeViewId = null;
    dirty = false;
  },
};
