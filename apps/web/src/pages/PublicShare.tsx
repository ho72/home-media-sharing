import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, uploadApiUrl } from '../api/client';
import Icon from '../components/ui/Icon';
import PdfCanvasPreview from '../components/PdfCanvasPreview';

type FileKind = 'pdf' | 'document' | 'presentation' | 'image' | 'video' | 'sheet' | 'archive' | 'other';
type PublicItemType = 'folder' | 'file';
type PublicTargetType = 'space' | 'folder' | 'file';

interface PublicTarget {
  id: string;
  type: PublicTargetType;
  name: string;
  color?: string | null;
  kind?: FileKind;
  mime?: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  expiresAt: string;
  ownerName: string;
}

interface PublicItem {
  id: string;
  type: PublicItemType;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  color?: string | null;
  size?: number;
  kind?: FileKind;
  mime?: string;
}

interface PublicShareResponse {
  target: PublicTarget;
  currentFolder: { id: string; name: string; color?: string | null } | null;
  breadcrumbs: Array<{ id: string; name: string; color?: string | null }>;
  items: PublicItem[];
}

interface FolderTheme {
  base: string;
  tab: string;
  body: string;
}

const FOLDER_THEMES: FolderTheme[] = [
  { base: '#F2B8BC', tab: '#DE9AA0', body: '#F6C8CB' },
  { base: '#F8CD8F', tab: '#E7B66D', body: '#FAD9A8' },
  { base: '#BFCF9F', tab: '#A7BC7E', body: '#CDDDB3' },
  { base: '#D8C6A4', tab: '#BFA77C', body: '#E3D3B6' },
  { base: '#DE8F70', tab: '#C87556', body: '#EBA98E' },
  { base: '#8FA9D6', tab: '#6F8FC6', body: '#A8BFE4' },
  { base: '#93D9BB', tab: '#6FC8A4', body: '#AFE5CF' },
  { base: '#BE97E8', tab: '#A77BD9', body: '#CFB1F0' },
];

const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  document: '문서',
  presentation: 'PPT',
  image: '이미지',
  video: '영상',
  sheet: '시트',
  archive: '압축',
  other: '파일',
};

const KIND_COLORS: Record<FileKind, string> = {
  pdf: '#E88B94',
  document: '#8FA9D6',
  presentation: '#DE8F70',
  image: '#93D9BB',
  video: '#BE97E8',
  sheet: '#93D9BB',
  archive: '#D8C6A4',
  other: '#C9C4BA',
};

function folderTheme(color?: string | null): FolderTheme {
  return FOLDER_THEMES.find((theme) => theme.base === color) ?? FOLDER_THEMES[5];
}

function fileKind(item: Pick<PublicItem, 'kind'>): FileKind {
  return item.kind ?? 'other';
}

function hasFileThumbnail(item: PublicItem) {
  const kind = fileKind(item);
  return kind === 'image'
    || kind === 'video'
    || kind === 'pdf'
    || kind === 'document'
    || kind === 'presentation'
    || kind === 'sheet';
}

function isTextPreviewFile(item: Pick<PublicItem, 'name' | 'mime'>) {
  const name = item.name.toLowerCase();
  const mime = item.mime?.toLowerCase() ?? '';
  return mime.startsWith('text/')
    || /\.(txt|md|markdown|csv|log|json)$/i.test(name);
}

function formatSize(size?: number): string {
  if (size === undefined) return '-';
  if (size === 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function downloadUrl(token: string, item: PublicItem) {
  return uploadApiUrl(`/share/files/${encodeURIComponent(token)}/nodes/${item.id}/download`);
}

function previewUrl(token: string, item: PublicItem) {
  return uploadApiUrl(`/share/files/${encodeURIComponent(token)}/nodes/${item.id}/preview`);
}

function thumbUrl(token: string, item: PublicItem) {
  return uploadApiUrl(`/share/files/${encodeURIComponent(token)}/nodes/${item.id}/thumb`);
}

function openDownload(token: string, item: PublicItem) {
  window.location.href = downloadUrl(token, item);
}

export default function PublicShare() {
  const { token = '' } = useParams();
  const [parentId, setParentId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<PublicItem | null>(null);

  const shareQuery = useQuery({
    queryKey: ['public-file-share', token, parentId],
    enabled: Boolean(token),
    queryFn: () => api<PublicShareResponse>(
      `/share/files/${encodeURIComponent(token)}${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`,
    ),
    retry: false,
  });

  const targetFile = useMemo<PublicItem | null>(() => {
    const target = shareQuery.data?.target;
    if (!target || target.type !== 'file') return null;
    return {
      id: target.id,
      type: 'file',
      name: target.name,
      parentId: null,
      createdAt: target.createdAt ?? target.expiresAt,
      updatedAt: target.updatedAt ?? target.expiresAt,
      color: target.color,
      kind: target.kind,
      mime: target.mime,
      size: target.size,
    };
  }, [shareQuery.data]);

  const goBack = () => {
    const data = shareQuery.data;
    if (!data) return;
    if (data.target.type === 'space') {
      if (!data.currentFolder) return;
      const previous = data.breadcrumbs[data.breadcrumbs.length - 2];
      setParentId(previous?.id ?? null);
      return;
    }
    if (data.target.type === 'folder') {
      if (!data.currentFolder || data.currentFolder.id === data.target.id) return;
      const previous = data.breadcrumbs[data.breadcrumbs.length - 2];
      setParentId(previous?.id ?? data.target.id);
    }
  };

  const data = shareQuery.data;
  const canGoBack = Boolean(data && (
    data.target.type === 'space'
      ? data.currentFolder
      : data.target.type === 'folder'
        && data.currentFolder
        && data.currentFolder.id !== data.target.id
  ));

  const errorStatus = shareQuery.error instanceof ApiError ? shareQuery.error.status : undefined;

  return (
    <div className="public-share-page">
      <header className="public-share-header">
        <div className="public-share-brand">ouri</div>
        <div className="public-share-header-note">
          <Icon name="lock" size={14} />
          링크를 받은 사람만 볼 수 있어요
        </div>
      </header>

      <main className="public-share-shell">
        {shareQuery.isLoading && (
          <div className="public-share-card public-share-state">
            <span className="fileshare-loading-ring" aria-hidden />
            <strong>공유 파일을 불러오고 있어요</strong>
            <p>잠시만 기다려 주세요.</p>
          </div>
        )}

        {shareQuery.isError && (
          <div className="public-share-card public-share-state">
            <Icon name={errorStatus === 410 ? 'clock' : 'lock'} size={30} />
            <strong>{errorStatus === 410 ? '만료된 링크예요' : '공유 링크를 열 수 없어요'}</strong>
            <p>
              {errorStatus === 410
                ? '공유자가 설정한 만료일이 지났거나 링크 공유가 꺼졌어요.'
                : '링크가 잘못되었거나 공유된 항목을 찾을 수 없어요.'}
            </p>
          </div>
        )}

        {shareQuery.data && (
          <div className="public-share-card">
            <section className="public-share-titlebar">
              {targetFile ? (
                <FilePreview token={token} item={targetFile} compact />
              ) : (
                <FolderThumb color={shareQuery.data.target.color} />
              )}
              <div>
                <span>{shareQuery.data.target.ownerName}님이 공유</span>
                <h1>{shareQuery.data.target.name}</h1>
                <p>{formatDate(shareQuery.data.target.expiresAt)}까지 열람 가능</p>
              </div>
            </section>

            {targetFile ? (
              <PublicPreviewPanel
                token={token}
                item={targetFile}
                embedded
                onDownload={() => openDownload(token, targetFile)}
              />
            ) : (
              <>
                <section className="public-share-toolbar">
                  <button
                    type="button"
                    className="fileshare-back-btn"
                    disabled={!canGoBack}
                    onClick={goBack}
                    aria-label="뒤로"
                  >
                    <Icon name="chevronLeft" size={18} />
                  </button>
                  <nav className="public-share-breadcrumb" aria-label="공유 위치">
                    <button type="button" onClick={() => setParentId(shareQuery.data.target.type === 'folder' ? shareQuery.data.target.id : null)}>
                      {shareQuery.data.target.type === 'folder' ? shareQuery.data.target.name : '공유 공간'}
                    </button>
                    {shareQuery.data.breadcrumbs
                      .filter((crumb) => crumb.id !== shareQuery.data.target.id)
                      .map((crumb) => (
                        <button key={crumb.id} type="button" onClick={() => setParentId(crumb.id)}>
                          <Icon name="chevronRight" size={13} />
                          {crumb.name}
                        </button>
                      ))}
                  </nav>
                  <span className="public-share-count">{shareQuery.data.items.length}개 항목</span>
                </section>

                {shareQuery.data.items.length === 0 ? (
                  <div className="public-share-empty">
                    <FolderThumb color={shareQuery.data.target.color} />
                    <strong>비어 있는 위치예요</strong>
                    <p>공유된 폴더 안에 표시할 파일이나 폴더가 없어요.</p>
                  </div>
                ) : (
                  <div className="public-share-grid">
                    {shareQuery.data.items.map((item) => (
                      item.type === 'folder' ? (
                        <button
                          key={item.id}
                          type="button"
                          className="public-folder-tile"
                          onClick={() => setParentId(item.id)}
                        >
                          <FolderThumb color={item.color ?? shareQuery.data.target.color} />
                          <span>{item.name}</span>
                          <small>{formatDate(item.updatedAt)}</small>
                        </button>
                      ) : (
                        <button
                          key={item.id}
                          type="button"
                          className="public-file-tile"
                          onClick={() => setPreviewItem(item)}
                        >
                          <FilePreview token={token} item={item} />
                          <span>{item.name}</span>
                          <small>{KIND_LABEL[fileKind(item)]} · {formatSize(item.size)}</small>
                        </button>
                      )
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {previewItem && (
        <PublicPreviewPanel
          token={token}
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onDownload={() => openDownload(token, previewItem)}
        />
      )}
    </div>
  );
}

function FolderThumb({ color }: { color?: string | null }) {
  const theme = folderTheme(color);
  return (
    <div className="fileshare-folder-thumb public-folder-thumb">
      <svg className="fileshare-folder-bg" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden focusable="false">
        <path
          d="M8 0 H29 Q35.5 0 39 4.5 L44.5 11 H92 Q100 11 100 19 V72 Q100 80 92 80 H8 Q0 80 0 72 V8 Q0 0 8 0 Z"
          fill={theme.tab}
        />
      </svg>
      <svg className="fileshare-folder-body-svg" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden focusable="false">
        <path
          d="M9 21 H91 C96 21 100 25 100 30 V72 Q100 80 92 80 H8 Q0 80 0 72 V30 C0 25 4 21 9 21 Z"
          fill={theme.body}
        />
      </svg>
    </div>
  );
}

function FilePreview({
  token,
  item,
  compact = false,
}: {
  token: string;
  item: PublicItem;
  compact?: boolean;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const kind = fileKind(item);
  const color = KIND_COLORS[kind];
  const label = KIND_LABEL[kind];
  const showThumb = hasFileThumbnail(item) && !thumbFailed;

  return (
    <div
      className={`fileshare-file-preview public-file-preview ${compact ? 'is-compact' : ''} ${showThumb ? 'has-thumb' : ''}`}
      style={{ '--file-kind-color': color } as CSSProperties}
    >
      {showThumb ? (
        <>
          <img
            className="fileshare-file-thumb-img"
            src={thumbUrl(token, item)}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
          <span className="fileshare-file-thumb-label">{label}</span>
          {kind === 'video' && (
            <span className="fileshare-file-thumb-play"><Icon name="play" size={13} /></span>
          )}
        </>
      ) : kind === 'image' ? (
        <div className="fileshare-image-preview">
          <Icon name="image" size={22} />
          <span>{label}</span>
        </div>
      ) : kind === 'video' ? (
        <div className="fileshare-video-preview">
          <span className="fileshare-play-pill"><Icon name="play" size={11} /></span>
          <span>{label}</span>
        </div>
      ) : kind === 'archive' ? (
        <div className="fileshare-archive-preview">
          <span>{label}</span>
          <i />
          <i />
          <i />
        </div>
      ) : (
        <div className="fileshare-paper-preview">
          <span>{label}</span>
          {kind === 'sheet' ? (
            <div className="fileshare-sheet-grid" aria-hidden>
              {Array.from({ length: 12 }).map((_, index) => <i key={index} />)}
            </div>
          ) : (
            <div className="fileshare-paper-lines" aria-hidden>
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PublicPreviewPanel({
  token,
  item,
  embedded = false,
  onClose,
  onDownload,
}: {
  token: string;
  item: PublicItem;
  embedded?: boolean;
  onClose?: () => void;
  onDownload: () => void;
}) {
  const kind = fileKind(item);
  const url = previewUrl(token, item);
  const usesTextPreview = isTextPreviewFile(item);
  const usesPdfPreview = !usesTextPreview
    && (kind === 'pdf' || kind === 'document' || kind === 'presentation' || kind === 'sheet');
  const canPreview = kind === 'image' || kind === 'video' || usesPdfPreview || usesTextPreview;
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [textPreviewError, setTextPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!usesPdfPreview) return undefined;

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPdfPreviewUrl(null);
    setPdfPreviewError(null);

    fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/pdf' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('미리보기를 불러오지 못했어요');
        return res.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfPreviewUrl(objectUrl);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setPdfPreviewError(err instanceof Error ? err.message : '미리보기를 불러오지 못했어요');
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, usesPdfPreview]);

  useEffect(() => {
    if (!usesTextPreview) return undefined;

    const controller = new AbortController();
    setTextPreview(null);
    setTextPreviewError(null);

    fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/plain, text/*;q=0.9, */*;q=0.1' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('텍스트 미리보기를 불러오지 못했어요');
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (controller.signal.aborted) return;
        setTextPreview(new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, ''));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setTextPreviewError(err instanceof Error ? err.message : '텍스트 미리보기를 불러오지 못했어요');
      });

    return () => controller.abort();
  }, [url, usesTextPreview]);

  const content = (
    <div className={`public-preview-panel ${embedded ? 'is-embedded' : ''}`}>
      <div className="public-preview-head">
        <div>
          <strong>{item.name}</strong>
          <span>{KIND_LABEL[kind]} · {formatSize(item.size)}</span>
        </div>
        <div className="public-preview-actions">
          <button type="button" className="btn btn-secondary" onClick={onDownload}>
            <Icon name="download" size={15} />
            다운로드
          </button>
          {!embedded && onClose && (
            <button type="button" className="public-preview-close" onClick={onClose} aria-label="닫기">
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
      </div>

      <div className={`files-preview-stage public-preview-stage is-${usesTextPreview ? 'text' : usesPdfPreview ? 'pdf' : canPreview ? kind : 'unsupported'}`}>
        {kind === 'image' && <img src={url} alt={item.name} />}
        {kind === 'video' && <video src={url} controls playsInline preload="metadata" />}
        {usesTextPreview && textPreview !== null && (
          <pre className="files-preview-text">{textPreview}</pre>
        )}
        {usesTextPreview && textPreview === null && !textPreviewError && (
          <PreviewLoading title="텍스트를 불러오고 있어요" description="원문 그대로 미리보기를 준비하는 중이에요." />
        )}
        {usesTextPreview && textPreviewError && (
          <PreviewError title="텍스트를 열지 못했어요" description={textPreviewError} />
        )}
        {usesPdfPreview && pdfPreviewUrl && <PdfCanvasPreview title={item.name} fileUrl={pdfPreviewUrl} />}
        {usesPdfPreview && !pdfPreviewUrl && !pdfPreviewError && (
          <PreviewLoading title="미리보기를 준비하고 있어요" description={`${KIND_LABEL[kind]} 파일을 화면에 맞게 불러오는 중이에요.`} />
        )}
        {usesPdfPreview && pdfPreviewError && (
          <PreviewError title="미리보기를 열지 못했어요" description={pdfPreviewError} />
        )}
        {!canPreview && (
          <div className="files-preview-unsupported">
            <FilePreview token={token} item={item} />
            <div>
              <strong>{item.name}</strong>
              <span>{KIND_LABEL[kind]} · {formatSize(item.size)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return content;
  return (
    <div className="public-preview-backdrop" role="dialog" aria-modal="true">
      {content}
    </div>
  );
}

function PreviewLoading({ title, description }: { title: string; description: string }) {
  return (
    <div className="files-preview-loading">
      <span className="fileshare-loading-ring" aria-hidden />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function PreviewError({ title, description }: { title: string; description: string }) {
  return (
    <div className="files-preview-error">
      <Icon name="fileText" size={26} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
