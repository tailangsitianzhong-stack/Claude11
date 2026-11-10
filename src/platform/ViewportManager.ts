/**
 * 描画領域のサイズを監視する。
 * アドレスバーの出し入れ・画面回転・ウィンドウサイズの変更を ResizeObserver でまとめて扱う。
 * （画面の向きの表示や安全領域に合わせたUI配置はチェックポイントBで追加する）
 */
export interface ViewportSize {
  /** CSSピクセル */
  width: number;
  height: number;
}

export type ViewportListener = (size: ViewportSize) => void;

export class ViewportManager {
  private size: ViewportSize;
  private readonly listeners = new Set<ViewportListener>();
  private readonly observer: ResizeObserver;
  private pending = false;

  constructor(private readonly element: HTMLElement) {
    this.size = this.measure();
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(element);
    // iOS Safari では回転直後にサイズが確定しないことがあるため、念のため再計測する
    window.addEventListener('orientationchange', () => {
      this.schedule();
      setTimeout(() => this.schedule(), 300);
    });
  }

  get current(): ViewportSize {
    return this.size;
  }

  get devicePixelRatio(): number {
    return window.devicePixelRatio || 1;
  }

  subscribe(listener: ViewportListener): () => void {
    this.listeners.add(listener);
    listener(this.size);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.observer.disconnect();
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const next = this.measure();
      if (next.width === this.size.width && next.height === this.size.height) return;
      this.size = next;
      for (const l of this.listeners) l(next);
    });
  }

  private measure(): ViewportSize {
    const rect = this.element.getBoundingClientRect();
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }
}
