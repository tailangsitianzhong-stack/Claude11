/**
 * localStorage の安全なラッパー。
 * プライベートブラウズや保存の無効化で例外が出ても、ゲームは保存なしで動き続ける。
 * 将来のアプリ化では、ここをネイティブの保存機能に差し替える。
 */
export const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* 保存できない環境では何もしない */
    }
  },
};
