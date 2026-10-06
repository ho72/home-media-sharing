import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const rootEl = document.getElementById('root')!;

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            style: {
              fontFamily: 'inherit',
              borderRadius: '14px',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

// 스플래시 페이드 아웃 — 최소 표시시간을 보장한 뒤 부드럽게 사라짐
// no-splash 모드(메인/로그인/PWA 아닌 페이지 새로고침)에선 splash 자체가 안 보이므로 즉시 제거
{
  const MIN_SPLASH_MS = 2500;
  const FADE_MS = 1300;
  const splash = document.getElementById('app-splash');
  if (splash) {
    if (document.documentElement.classList.contains('no-splash')) {
      splash.remove();
    } else {
      const startedAt =
        (window as Window & { __splashStartedAt?: number }).__splashStartedAt ??
        Date.now();
      const hide = () => {
        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
        window.setTimeout(() => {
          splash.classList.add('splash-hide');
          window.setTimeout(() => splash.remove(), FADE_MS + 60);
        }, wait);
      };
      requestAnimationFrame(() => requestAnimationFrame(hide));
    }
  }
}
