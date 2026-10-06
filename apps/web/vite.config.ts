import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PWA(서비스 워커·매니페스트)는 vite-plugin-pwa의 ESM/CJS 호환 이슈가 잡힐 때까지 잠시 비활성화.
// 앱 자체 동작에는 영향 없음 (홈 화면 추가, 오프라인 쉘 등 일부 기능만 빠짐).
// 다시 켤 땐 vite-plugin-pwa를 안정 버전(>= 0.21)으로 올리고 아래 import + plugin 추가.

export default defineConfig({
  plugins: [react()],
  // .env 는 워크스페이스 루트에 한 벌 — 서버/웹 공통. VITE_ 접두사만 클라이언트 번들에 노출됨.
  envDir: '../../',
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
