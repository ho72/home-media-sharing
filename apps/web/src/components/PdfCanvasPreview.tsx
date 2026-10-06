import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import Icon from './ui/Icon';

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy?: () => Promise<void>;
};

type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel: () => void };
};

type PdfLoadingTask = {
  promise: Promise<unknown>;
  destroy: () => Promise<void>;
};

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.25;

type ZoomAnchor = {
  frame: HTMLElement | null;
  anchorX: number;
  anchorY: number;
  localX: number;
  localY: number;
  fallbackScrollLeft: number;
  fallbackScrollTop: number;
};

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function findZoomAnchorFrame(node: HTMLElement, anchorX: number, anchorY: number) {
  const frames = node.querySelectorAll<HTMLElement>('.pdf-canvas-sheet-frame');
  let verticalCandidate: HTMLElement | null = null;
  let verticalCandidateDistance = Number.POSITIVE_INFINITY;
  let closest: HTMLElement | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const frame of frames) {
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const insideY = anchorY >= rect.top && anchorY <= rect.bottom;
    const insideX = anchorX >= rect.left && anchorX <= rect.right;
    if (insideX && insideY) return frame;

    if (insideY) {
      const distanceX = anchorX < rect.left ? rect.left - anchorX : anchorX - rect.right;
      if (distanceX < verticalCandidateDistance) {
        verticalCandidate = frame;
        verticalCandidateDistance = distanceX;
      }
      continue;
    }

    const distanceY = anchorY < rect.top ? rect.top - anchorY : anchorY - rect.bottom;
    if (distanceY < closestDistance) {
      closest = frame;
      closestDistance = distanceY;
    }
  }

  return verticalCandidate ?? closest;
}

function captureZoomAnchor(
  node: HTMLElement,
  anchorX: number,
  anchorY: number,
  nextZoom: number,
  previousZoom: number,
): ZoomAnchor {
  const nodeRect = node.getBoundingClientRect();
  const offsetX = anchorX - nodeRect.left;
  const offsetY = anchorY - nodeRect.top;
  const ratio = nextZoom / previousZoom;
  const frame = findZoomAnchorFrame(node, anchorX, anchorY);

  if (!frame) {
    return {
      frame: null,
      anchorX,
      anchorY,
      localX: 0.5,
      localY: 0.5,
      fallbackScrollLeft: (node.scrollLeft + offsetX) * ratio - offsetX,
      fallbackScrollTop: (node.scrollTop + offsetY) * ratio - offsetY,
    };
  }

  const frameRect = frame.getBoundingClientRect();
  return {
    frame,
    anchorX,
    anchorY,
    localX: frameRect.width > 0 ? clampRatio((anchorX - frameRect.left) / frameRect.width) : 0.5,
    localY: frameRect.height > 0 ? clampRatio((anchorY - frameRect.top) / frameRect.height) : 0.5,
    fallbackScrollLeft: (node.scrollLeft + offsetX) * ratio - offsetX,
    fallbackScrollTop: (node.scrollTop + offsetY) * ratio - offsetY,
  };
}

function restoreZoomAnchor(node: HTMLElement, anchor: ZoomAnchor) {
  if (!anchor.frame?.isConnected) {
    node.scrollLeft = anchor.fallbackScrollLeft;
    node.scrollTop = anchor.fallbackScrollTop;
    return;
  }

  const rect = anchor.frame.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    node.scrollLeft = anchor.fallbackScrollLeft;
    node.scrollTop = anchor.fallbackScrollTop;
    return;
  }

  const pointX = rect.left + rect.width * anchor.localX;
  const pointY = rect.top + rect.height * anchor.localY;
  node.scrollLeft += pointX - anchor.anchorX;
  node.scrollTop += pointY - anchor.anchorY;
}

function touchDistance(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function touchCenter(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

export default function PdfCanvasPreview({
  fileUrl,
  title,
}: {
  fileUrl: string;
  title: string;
}) {
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const renderZoomTimerRef = useRef<number | null>(null);
  const viewZoomFrameRef = useRef<number | null>(null);
  const liveScaleFrameRef = useRef<number | null>(null);
  const pendingLiveZoomRef = useRef(1);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const gestureStartZoomRef = useRef(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewZoom, setViewZoom] = useState(1);
  const [renderZoom, setRenderZoom] = useState(1);

  const applyLiveScaleNow = (targetZoom: number) => {
    const node = pagesRef.current;
    if (!node) return;

    node.querySelectorAll<HTMLElement>('.pdf-canvas-page').forEach((page) => {
      const frame = page.querySelector<HTMLElement>('.pdf-canvas-sheet-frame');
      const sheet = page.querySelector<HTMLElement>('.pdf-canvas-sheet');
      if (!frame || !sheet) return;
      const width = Number(frame.dataset.renderWidth);
      const height = Number(frame.dataset.renderHeight);
      const pageRenderZoom = Number(frame.dataset.renderZoom) || 1;
      if (!width || !height) return;

      const scale = targetZoom / pageRenderZoom;
      const scaledWidth = Math.max(1, Math.round(width * scale));
      const scaledHeight = Math.max(1, Math.round(height * scale));
      page.style.width = `${scaledWidth}px`;
      frame.style.width = `${scaledWidth}px`;
      frame.style.height = `${scaledHeight}px`;
      sheet.style.transform = Math.abs(scale - 1) < 0.001 ? 'translateZ(0)' : `translateZ(0) scale(${scale})`;
    });
  };

  const scheduleLiveScaleUpdate = (targetZoom: number, anchor: ZoomAnchor) => {
    pendingLiveZoomRef.current = targetZoom;
    pendingZoomAnchorRef.current = anchor;
    if (liveScaleFrameRef.current !== null) return;
    liveScaleFrameRef.current = window.requestAnimationFrame(() => {
      liveScaleFrameRef.current = null;
      applyLiveScaleNow(pendingLiveZoomRef.current);
      const node = pagesRef.current;
      const pendingAnchor = pendingZoomAnchorRef.current;
      pendingZoomAnchorRef.current = null;
      if (node && pendingAnchor) restoreZoomAnchor(node, pendingAnchor);
    });
  };

  const scheduleViewZoomUpdate = () => {
    if (viewZoomFrameRef.current !== null) return;
    viewZoomFrameRef.current = window.requestAnimationFrame(() => {
      viewZoomFrameRef.current = null;
      setViewZoom(zoomRef.current);
    });
  };

  const scheduleRenderZoomUpdate = (delay = 360) => {
    if (renderZoomTimerRef.current) window.clearTimeout(renderZoomTimerRef.current);
    renderZoomTimerRef.current = window.setTimeout(() => {
      renderZoomTimerRef.current = null;
      setRenderZoom(zoomRef.current);
    }, delay);
  };

  const cancelScheduledRender = () => {
    if (!renderZoomTimerRef.current) return;
    window.clearTimeout(renderZoomTimerRef.current);
    renderZoomTimerRef.current = null;
  };

  const applyZoom = (
    nextZoom: number,
    clientX?: number,
    clientY?: number,
    commitRender = true,
  ) => {
    const node = pagesRef.current;
    const previousZoom = zoomRef.current;
    const clamped = clampZoom(nextZoom);
    if (!node || Math.abs(clamped - previousZoom) < 0.001) return;

    const rect = node.getBoundingClientRect();
    const anchorX = clientX ?? rect.left + rect.width / 2;
    const anchorY = clientY ?? rect.top + rect.height / 2;
    const zoomAnchor = captureZoomAnchor(node, anchorX, anchorY, clamped, previousZoom);

    zoomRef.current = clamped;
    scheduleLiveScaleUpdate(clamped, zoomAnchor);
    scheduleViewZoomUpdate();
    if (commitRender) scheduleRenderZoomUpdate();
  };

  useEffect(() => () => {
    if (renderZoomTimerRef.current) window.clearTimeout(renderZoomTimerRef.current);
    if (viewZoomFrameRef.current !== null) window.cancelAnimationFrame(viewZoomFrameRef.current);
    if (liveScaleFrameRef.current !== null) window.cancelAnimationFrame(liveScaleFrameRef.current);
    pendingZoomAnchorRef.current = null;
  }, []);

  const getCurrentZoom = useCallback(() => zoomRef.current, []);

  useEffect(() => {
    const node = pagesRef.current;
    if (!node) return undefined;

    const update = () => setContainerWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = pagesRef.current;
    if (!node) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const sensitivity = event.deltaMode === 1 ? 0.045 : 0.008;
      const factor = Math.exp(-event.deltaY * sensitivity);
      applyZoom(zoomRef.current * factor, event.clientX, event.clientY);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      cancelScheduledRender();
      pinchRef.current = {
        distance: touchDistance(event.touches),
        zoom: zoomRef.current,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const distance = touchDistance(event.touches);
      const center = touchCenter(event.touches);
      applyZoom(pinchRef.current.zoom * (distance / pinchRef.current.distance), center.x, center.y, false);
    };

    const handleTouchEnd = () => {
      if (pinchRef.current) scheduleRenderZoomUpdate(120);
      pinchRef.current = null;
    };

    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      cancelScheduledRender();
      gestureStartZoomRef.current = zoomRef.current;
    };

    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      const rect = node.getBoundingClientRect();
      applyZoom(
        gestureStartZoomRef.current * (gesture.scale ?? 1),
        gesture.clientX ?? rect.left + rect.width / 2,
        gesture.clientY ?? rect.top + rect.height / 2,
        false,
      );
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureStartZoomRef.current = zoomRef.current;
      scheduleRenderZoomUpdate(120);
    };

    const options = { passive: false };
    node.addEventListener('wheel', handleWheel, options);
    node.addEventListener('touchstart', handleTouchStart, options);
    node.addEventListener('touchmove', handleTouchMove, options);
    node.addEventListener('touchend', handleTouchEnd);
    node.addEventListener('touchcancel', handleTouchEnd);
    node.addEventListener('gesturestart', handleGestureStart, options);
    node.addEventListener('gesturechange', handleGestureChange, options);
    node.addEventListener('gestureend', handleGestureEnd, options);

    return () => {
      node.removeEventListener('wheel', handleWheel);
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('touchend', handleTouchEnd);
      node.removeEventListener('touchcancel', handleTouchEnd);
      node.removeEventListener('gesturestart', handleGestureStart);
      node.removeEventListener('gesturechange', handleGestureChange);
      node.removeEventListener('gestureend', handleGestureEnd);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    let loadingTask: PdfLoadingTask | null = null;
    setPdf(null);
    setError(null);
    zoomRef.current = 1;
    pendingLiveZoomRef.current = 1;
    pendingZoomAnchorRef.current = null;
    setViewZoom(1);
    setRenderZoom(1);

    import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((pdfjs) => {
        if (canceled) return null;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ url: fileUrl }) as unknown as PdfLoadingTask;
        return loadingTask.promise;
      })
      .then((loaded) => {
        if (!canceled && loaded) setPdf(loaded as PdfDocument);
      })
      .catch((err: unknown) => {
        if (canceled) return;
        setError(err instanceof Error ? err.message : 'PDF 미리보기를 불러오지 못했어요.');
      });

    return () => {
      canceled = true;
      void loadingTask?.destroy();
    };
  }, [fileUrl]);

  const pageNumbers = useMemo(
    () => (pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []),
    [pdf],
  );

  return (
    <div className="pdf-canvas-preview">
      <div className="pdf-canvas-toolbar">
        <div className="pdf-canvas-title">
          <Icon name="fileText" size={15} />
          <span>{pdf ? `${pdf.numPages}페이지` : title}</span>
        </div>
        <div className="pdf-canvas-zoom">
          <button
            type="button"
            onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}
            disabled={viewZoom <= MIN_ZOOM}
            aria-label="축소"
          >
            <Icon name="minus" size={14} />
          </button>
          <span>{Math.round(viewZoom * 100)}%</span>
          <button
            type="button"
            onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}
            disabled={viewZoom >= MAX_ZOOM}
            aria-label="확대"
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      <div ref={pagesRef} className="pdf-canvas-pages">
        {!pdf && !error && (
          <div className="files-preview-loading">
            <span className="fileshare-loading-ring" aria-hidden />
            <strong>문서를 불러오고 있어요</strong>
            <span>페이지를 모바일 화면에 맞게 준비하는 중이에요.</span>
          </div>
        )}
        {error && (
          <div className="files-preview-error">
            <Icon name="fileText" size={26} />
            <strong>문서를 열지 못했어요</strong>
            <span>{error}</span>
          </div>
        )}
        {pdf && pageNumbers.map((pageNumber) => (
          <PdfCanvasPage
            key={pageNumber}
            pdf={pdf}
            pageNumber={pageNumber}
            pageCount={pdf.numPages}
            containerWidth={containerWidth}
            renderZoom={renderZoom}
            getCurrentZoom={getCurrentZoom}
          />
        ))}
      </div>
    </div>
  );
}

const PdfCanvasPage = memo(function PdfCanvasPage({
  pdf,
  pageNumber,
  pageCount,
  containerWidth,
  renderZoom,
  getCurrentZoom,
}: {
  pdf: PdfDocument;
  pageNumber: number;
  pageCount: number;
  containerWidth: number;
  renderZoom: number;
  getCurrentZoom: () => number;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRendered, setHasRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyGeometry = useCallback((width: number, height: number, baseZoom: number) => {
    const page = pageRef.current;
    const frame = frameRef.current;
    const sheet = sheetRef.current;
    if (!page || !frame || !sheet) return;

    const visualScale = getCurrentZoom() / baseZoom;
    const visualWidth = Math.max(1, Math.round(width * visualScale));
    const visualHeight = Math.max(1, Math.round(height * visualScale));
    page.style.width = `${visualWidth}px`;
    frame.style.width = `${visualWidth}px`;
    frame.style.height = `${visualHeight}px`;
    frame.dataset.renderWidth = String(width);
    frame.dataset.renderHeight = String(height);
    frame.dataset.renderZoom = String(baseZoom);
    sheet.style.width = `${width}px`;
    sheet.style.height = `${height}px`;
    sheet.style.transform = Math.abs(visualScale - 1) >= 0.001
      ? `translateZ(0) scale(${visualScale})`
      : 'translateZ(0)';
  }, [getCurrentZoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0) return undefined;

    let canceled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    if (!hasRendered) setLoading(true);
    setError(null);

    pdf.getPage(pageNumber)
      .then((page) => {
        if (canceled) return null;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(180, containerWidth - 28);
        const fitScale = Math.min(1.25, Math.max(0.2, availableWidth / baseViewport.width));
        const viewport = page.getViewport({ scale: fitScale * renderZoom });
        const renderCanvas = document.createElement('canvas');
        const context = renderCanvas.getContext('2d');
        if (!context) throw new Error('Canvas context is not available');
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        renderCanvas.width = Math.floor(cssWidth * outputScale);
        renderCanvas.height = Math.floor(cssHeight * outputScale);
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        renderTask = page.render({ canvasContext: context, viewport });
        return renderTask.promise.then(() => ({ renderCanvas, cssWidth, cssHeight }));
      })
      .then((result) => {
        if (canceled || !result) return;
        const visibleContext = canvas.getContext('2d');
        if (!visibleContext) throw new Error('Canvas context is not available');
        applyGeometry(result.cssWidth, result.cssHeight, renderZoom);
        canvas.width = result.renderCanvas.width;
        canvas.height = result.renderCanvas.height;
        canvas.style.width = `${result.cssWidth}px`;
        canvas.style.height = `${result.cssHeight}px`;
        visibleContext.setTransform(1, 0, 0, 1, 0, 0);
        visibleContext.clearRect(0, 0, canvas.width, canvas.height);
        visibleContext.drawImage(result.renderCanvas, 0, 0);
        setHasRendered(true);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (canceled) return;
        if (err instanceof Error && err.name === 'RenderingCancelledException') return;
        setLoading(false);
        setError(err instanceof Error ? err.message : '페이지를 렌더링하지 못했어요.');
      });

    return () => {
      canceled = true;
      renderTask?.cancel();
    };
  }, [applyGeometry, containerWidth, pageNumber, pdf, renderZoom]);

  return (
    <div ref={pageRef} className="pdf-canvas-page">
      <div
        ref={frameRef}
        className="pdf-canvas-sheet-frame"
      >
        <div
          ref={sheetRef}
          className="pdf-canvas-sheet"
        >
          {loading && !hasRendered && (
            <div className="pdf-canvas-page-loading">
              <span className="fileshare-loading-ring" aria-hidden />
            </div>
          )}
          {error && (
            <div className="pdf-canvas-page-error">{error}</div>
          )}
          <canvas ref={canvasRef} aria-label={`${pageNumber}페이지`} />
        </div>
      </div>
      <span className="pdf-canvas-page-number">{pageNumber} / {pageCount}</span>
    </div>
  );
});
