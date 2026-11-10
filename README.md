# Arena Battle

ブラウザで動く 3D アリーナ対戦アクションゲーム（Three.js / TypeScript / Vite）。

現在は **Phase 1（キャラクターの土台とアリーナ）** の開発中です。

## 必要なもの

- Node.js 22.12 以上（LTS 推奨）

## 使い方

```bash
npm install       # 初回・更新後
npm run dev       # 開発サーバー（同じ Wi-Fi のスマホからも開けます）
npm run build     # 型チェック + 本番ビルド（dist/）
npm run preview   # 本番ビルドの確認
npm test          # 単体テスト
npm run typecheck # 型チェックのみ
```

Windows PC で起動してスマートフォンから確認する手順は
[docs/LOCAL_TESTING_WINDOWS.md](docs/LOCAL_TESTING_WINDOWS.md) を参照してください。

### URL パラメータ

| パラメータ | 内容 |
|---|---|
| `?quality=high` / `medium` / `low` / `0`〜`9` | 画質の段階（0が最高） |
| `?fps=30` | 30fps モード |
| `?stats=0` | 統計表示を消す |
| `?debug=1` | 本番ビルドでも開発パネルを表示する |

## フォルダ構成（A1 時点）

```
src/
  main.ts                 起動処理（WebGL2 の確認・開発パネルの読み込み）
  core/Game.ts            全体の組み立て
  core/GameLoop.ts        固定60Hzのゲーム処理と可変フレームの描画
  platform/               画質（QualitySettings / QualityManager）、画面サイズ、保存
  render/                 描画パイプライン（MSAA・Bloom・トーンマッピング）、影
  debug/                  仮シーン（A2で置き換え）、統計表示、開発パネル
tests/                    Vitest の単体テスト
docs/                     手順書・設計の決定事項
```

## 進捗

| チェックポイント | 工程 | 状態 |
|---|---|---|
| A：3Dビジュアル | A1 雛形・描画パイプライン・画質の手動切り替え | 完了（確認待ち） |
| | A2 アリーナ / A3 キャラクター / A4 ビューアー | 未着手 |
| B：基本操作 | B1〜B3 | 未着手 |
| C：アニメーション | C1〜C3 | 未着手 |
| D：最終確認 | D1〜D3 | 未着手 |
