import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスで出力（将来のアプリ化・任意のフォルダ配置に対応）
  base: './',
  server: {
    // 同じWi-Fi内のスマートフォンからアクセスできるよう、LANに公開する
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js 本体だけで約600KBあるため、警告の基準を引き上げる（gzip後は約150KB）
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
