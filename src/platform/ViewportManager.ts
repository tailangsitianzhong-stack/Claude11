/**
 * 描画領域のサイズと、端末のピクセル倍率（devicePixelRatio）を監視する。
 *
 * - サイズ：ResizeObserver（ウィンドウサイズ変更・アドレスバーの出し入れ・画面回転）。
 *   iOS Safari では回転直後にサイズが確定しないことがあるため、orientationchange 後に再計測する。
 * - ピクセル倍率：`(resolution: Xdppx)` のメディアクエリの変化
 *   （ブラウザの拡大・縮小、DPIの異なるモニターへのウィンドウ移動）。
 *   イベントが発生しない環境に備え、`pollDevicePixelRatio()`（描画ループから0.5秒ごと）でも値を確認する。
 *
 * 描画倍率の上限（画質設定）はここでは扱わない。利用側で min(devicePixelRatio, 上限) を取る。
 * （安全領域に合わせたUI配置や「横向き推奨」の表示は B1 で実装する）
 */
export interface ViewportSize {
  /** CSSピクセル */
  width: number;
  height: number;
  /** 端末のピクセル倍率（画質設定による上限を適用する前の値） */
  devicePixelRatio: number;
}

export type ViewportListener = (size: ViewportSize) => void;

/** devicePixelRatio を安全に読む（0・NaN・未定義なら 1） */
export function readDevicePixelRatio(raw: number | undefined): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export class ViewportManager {
  private size: ViewportSize;
  private readonly listeners = new Set<ViewportListener>();
  private readonly observer: ResizeObserver;
  private pending = false;
  private pollElapsed = 0;
  private dprQuery: MediaQueryList | null = null;
  private readonly onDprChange = (): void => {
    this.watchDevicePixelRatio();
    this.schedule();
  };
  private readonly onOrientationChange = (): void => {
    this.schedule();
    setTimeout(() => this.schedule(), 300);
  };

  constructor(private readonly element: HTMLElement) {
    this.size = this.measure();
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(element);
    window.addEventListener('orientationchange', this.onOrientationChange);
    this.watchDevicePixelRatio();
  }

  get current(): ViewportSize {
    return this.size;
  }

  subscribe(listener: ViewportListener): () => void {
    this.listeners.add(listener);
    listener(this.size);
    return () => this.listeners.delete(listener);
  }

  /**
   * 予備の確認：イベントが発生しない環境のため、一定間隔で devicePixelRatio を読み比べる。
   * 描画ループから毎フレーム呼んでよい（実際の確認は intervalSec ごと。読み取りは数値1つだけ）。
   */
  pollDevicePixelRatio(frameDt: number, intervalSec = 0.5): void {
    this.pollElapsed += frameDt;
    if (this.pollElapsed < intervalSec) return;
    this.pollElapsed = 0;
    if (readDevicePixelRatio(window.devicePixelRatio) !== this.size.devicePixelRatio) this.onDprChange();
  }

  dispose(): void {
    this.observer.disconnect();
    window.removeEventListener('orientationchange', this.onOrientationChange);
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    this.listeners.clear();
  }

  /**
   * 現在の倍率に一致するメディアクエリを登録し直す。
   * 倍率が変わると一度だけ change が発生するので、そのたびに新しい倍率で登録し直す。
   */
  private watchDevicePixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (typeof window.matchMedia !== 'function') return;
    const dpr = readDevicePixelRatio(window.devicePixelRatio);
    this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const next = this.measure();
      const cur = this.size;
      if (
        next.width === cur.width &&
        next.height === cur.height &&
        next.devicePixelRatio === cur.devicePixelRatio
      ) {
        return;
      }
      this.size = next;
      for (const l of this.listeners) l(next);
    });
  }

  private measure(): ViewportSize {
    const rect = this.element.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      devicePixelRatio: readDevicePixelRatio(window.devicePixelRatio),
    };
  }
}
