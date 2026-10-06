import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, uploadApi, uploadApiUrl } from '../api/client';
import Avatar from '../components/ui/Avatar';
import Icon from '../components/ui/Icon';
import PdfCanvasPreview from '../components/PdfCanvasPreview';

interface UserHit {
  id: string;
  displayName: string;
  unipassAvatarUrl?: string | null;
}

interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  user: UserHit;
}

interface GroupMember {
  userId: string;
  status: 'pending' | 'active';
  user?: UserHit;
}

interface Group {
  id: string;
  name: string;
  ownerId?: string;
  members: GroupMember[];
}

type SpaceKind = 'personal' | 'group' | 'shared';
type FileKind = 'pdf' | 'document' | 'presentation' | 'image' | 'video' | 'sheet' | 'archive' | 'other';
type LibraryItemType = 'folder' | 'file';
type SettingsTargetState = { type: 'space' | 'folder' | 'file'; id: string };
type ContextTargetState = SettingsTargetState;
type SortMode = 'name' | 'updated' | 'created' | 'type' | 'size';
type ClipboardMode = 'copy' | 'move';

interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  deleteAfter?: string;
  groupId?: string;
  groupIds?: string[];
  friendIds?: string[];
  memberCount?: number;
  canDelete?: boolean;
}

interface LibraryItem {
  id: string;
  type: LibraryItemType;
  name: string;
  spaceId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName: string;
  groupIds: string[];
  friendIds: string[];
  color?: string;
  note?: string;
  size?: number;
  kind?: FileKind;
  mime?: string;
  trashedAt?: string;
  deleteAfter?: string;
}

interface ShareTarget {
  spaceId: string;
  groupIds: string[];
  friendIds: string[];
}

interface FileLibraryResponse {
  spaces: Space[];
  trashedSpaces: Space[];
  items: LibraryItem[];
  activeLinks?: ActiveLink[];
}

interface ActiveLink {
  targetType: ContextTargetState['type'];
  targetId: string;
  expiresAt: string;
  createdAt: string;
  accessCount: number;
}

type ShareSelection = Pick<ShareTarget, 'groupIds' | 'friendIds'>;

interface FolderTheme {
  base: string;
  tab: string;
  body: string;
}

interface SettingsModalTarget {
  id: string;
  type: ContextTargetState['type'];
  name: string;
  subtitle: string;
  color: string;
  kind: SpaceKind | 'folder' | 'file';
  shared: boolean;
  groupId?: string;
  groupIds?: string[];
  friendIds?: string[];
}

interface LinkShare {
  token?: string;
  expiresAt: string;
  createdAt: string;
  accessCount?: number;
}

interface LinkShareControls {
  share?: LinkShare;
  url?: string;
  expiresDate: string;
  onExpiresDateChange: (value: string) => void;
  onEnable: () => void;
  onCopy: () => void;
  onDisable: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: ContextTargetState;
  targets: ContextTargetState[];
}

interface BlankContextMenuState {
  x: number;
  y: number;
}

interface FileClipboard {
  mode: ClipboardMode;
  targets: ContextTargetState[];
}

interface SelectionBoxState {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

interface InfoModalTarget {
  type: 'space' | 'folder' | 'file';
  name: string;
  subtitle: string;
  color?: string;
  shared: boolean;
  fileKind?: FileKind;
  rows: Array<{ label: string; value: string }>;
}

interface ShareMember {
  id: string;
  name: string;
  label: string;
  color: string;
  role: 'owner' | 'edit' | 'view';
}

interface ShareAvatar {
  id: string;
  name: string;
  color: string;
}

interface FileUploadEntry {
  id: number;
  name: string;
  size: number;
  pct: number;
  done: boolean;
  canceled?: boolean;
  err?: string;
}

interface FileUploadRuntime {
  canceled: boolean;
  xhrs: Set<XMLHttpRequest>;
  retryTimers: Set<ReturnType<typeof setTimeout>>;
  uploadId: string | null;
  initAbort: AbortController | null;
  completeAbort: AbortController | null;
  cleaning: boolean;
}

const PERSONAL_SPACE_ID = 'personal';
const SHARED_SPACE_ID = 'shared';
const TRASH_RETENTION_DAYS = 30;
const MIB = 1024 * 1024;
const FILE_CHUNKED_UPLOAD_THRESHOLD_BYTES = 10 * MIB;
const FILE_UPLOAD_CHUNK_SIZE_BYTES = 16 * MIB;
const FILE_DIRECT_UPLOAD_CONCURRENCY = 2;
const FILE_CHUNKED_UPLOAD_CONCURRENCY = 1;
const FILE_CHUNK_UPLOAD_CONCURRENCY = 6;
const FILE_UPLOAD_MAX_RETRIES = 2;
const FILE_UPLOAD_RETRY_BASE_MS = 2000;

const SORT_LABELS: Record<SortMode, string> = {
  name: '이름순',
  updated: '최근 수정순',
  created: '생성일순',
  type: '종류순',
  size: '크기순',
};

const FOLDER_THEMES: FolderTheme[] = [
  { base: '#F2B8BC', tab: '#DE9AA0', body: '#F6C8CB' },
  { base: '#F8CD8F', tab: '#E7B66D', body: '#FAD9A8' },
  { base: '#BFCF9F', tab: '#A7BC7E', body: '#CDDDB3' },
  { base: '#D8C6A4', tab: '#BFA77C', body: '#E3D3B6' },
  { base: '#DE8F70', tab: '#C87556', body: '#EBA98E' },
  { base: '#D9B48F', tab: '#BE956F', body: '#E6C4A3' },
  { base: '#8FA9D6', tab: '#6F8FC6', body: '#A8BFE4' },
  { base: '#93D9BB', tab: '#6FC8A4', body: '#AFE5CF' },
  { base: '#BE97E8', tab: '#A77BD9', body: '#CFB1F0' },
  { base: '#E88B94', tab: '#D2696F', body: '#F1A8AE' },
  { base: '#9BDCE0', tab: '#74C7CC', body: '#B6E8EB' },
  { base: '#E8A0C0', tab: '#D57FA8', body: '#F1BAD3' },
  { base: '#CFC0B4', tab: '#B7A396', body: '#DED1C8' },
  { base: '#EFE49E', tab: '#D9CA75', body: '#F5ECB9' },
  { base: '#D6D6D9', tab: '#B9B9C0', body: '#E2E2E5' },
];

const INITIAL_ITEMS: LibraryItem[] = [
  {
    id: 'folder-family-docs',
    type: 'folder',
    name: '가족 서류',
    spaceId: SHARED_SPACE_ID,
    parentId: null,
    createdAt: '2026-07-01T09:15:00.000Z',
    updatedAt: '2026-07-05T10:20:00.000Z',
    ownerName: '나',
    groupIds: [],
    friendIds: [],
    color: '#F2B8BC',
    note: '등본, 보험, 병원 서류',
  },
  {
    id: 'folder-trip-docs',
    type: 'folder',
    name: '여행 계획',
    spaceId: PERSONAL_SPACE_ID,
    parentId: null,
    createdAt: '2026-07-02T14:05:00.000Z',
    updatedAt: '2026-07-04T09:10:00.000Z',
    ownerName: '나',
    groupIds: [],
    friendIds: [],
    color: '#8FA9D6',
    note: '일정표와 예약 서류',
  },
  {
    id: 'file-health-check',
    type: 'file',
    name: '건강검진 결과.pdf',
    spaceId: SHARED_SPACE_ID,
    parentId: 'folder-family-docs',
    createdAt: '2026-07-05T12:10:00.000Z',
    updatedAt: '2026-07-05T12:10:00.000Z',
    ownerName: '나',
    groupIds: [],
    friendIds: [],
    size: 1840000,
    kind: 'pdf',
  },
  {
    id: 'file-trip-list',
    type: 'file',
    name: '여행 준비물.pdf',
    spaceId: PERSONAL_SPACE_ID,
    parentId: null,
    createdAt: '2026-07-04T17:40:00.000Z',
    updatedAt: '2026-07-04T17:40:00.000Z',
    ownerName: '나',
    groupIds: [],
    friendIds: [],
    size: 612000,
    kind: 'pdf',
  },
  {
    id: 'file-school',
    type: 'file',
    name: '학교 제출 서류.docx',
    spaceId: PERSONAL_SPACE_ID,
    parentId: null,
    createdAt: '2026-07-03T08:30:00.000Z',
    updatedAt: '2026-07-03T08:30:00.000Z',
    ownerName: '나',
    groupIds: [],
    friendIds: [],
    size: 438000,
    kind: 'document',
  },
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

function detectKind(file: File): FileKind {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) return 'video';
  if (/\.(pptx?|ppsx?|odp|key)$/i.test(name)) return 'presentation';
  if (/\.(xlsx?|csv|numbers)$/i.test(name)) return 'sheet';
  if (/\.(docx?|hwp|hwpx|txt|rtf|pages|md)$/i.test(name)) return 'document';
  if (/\.(zip|7z|rar)$/i.test(name)) return 'archive';
  return 'other';
}

function formatSize(size?: number): string {
  if (size === undefined) return '-';
  if (size === 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}.${day}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoToDateInput(iso?: string): string {
  if (!iso) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return dateInputValue(d);
  }
  return dateInputValue(new Date(iso));
}

function dateInputToExpiryIso(value: string): string {
  return new Date(`${value}T23:59:59.000`).toISOString();
}

function groupSpaceId(groupId: string) {
  return `group:${groupId}`;
}

function activeMemberCount(group: Group) {
  return group.members.filter((m) => m.status === 'active').length;
}

function folderTheme(color?: string): FolderTheme {
  return FOLDER_THEMES.find((theme) => theme.base === color) ?? FOLDER_THEMES[6];
}

function themeAt(index: number): FolderTheme {
  return FOLDER_THEMES[index % FOLDER_THEMES.length];
}

function matchesQuery(name: string, query: string) {
  return !query || name.toLowerCase().includes(query);
}

function fileKind(item: LibraryItem): FileKind {
  return item.kind ?? 'other';
}

function hasFileThumbnail(item: LibraryItem) {
  const kind = fileKind(item);
  return kind === 'image'
    || kind === 'video'
    || kind === 'pdf'
    || kind === 'document'
    || kind === 'presentation'
    || kind === 'sheet';
}

function isTextPreviewFile(item: LibraryItem) {
  const name = item.name.toLowerCase();
  const mime = item.mime?.toLowerCase() ?? '';
  return mime.startsWith('text/')
    || /\.(txt|md|markdown|csv|log|json)$/i.test(name);
}

function targetKey(target: ContextTargetState) {
  return `${target.type}:${target.id}`;
}

function parseTargetKey(key: string): ContextTargetState | null {
  const divider = key.indexOf(':');
  if (divider < 0) return null;
  const type = key.slice(0, divider);
  const id = key.slice(divider + 1);
  if ((type === 'space' || type === 'folder' || type === 'file') && id) {
    return { type, id };
  }
  return null;
}

function trashedFields(nowIso: string) {
  const deleteAt = new Date(nowIso);
  deleteAt.setDate(deleteAt.getDate() + TRASH_RETENTION_DAYS);
  return {
    trashedAt: nowIso,
    deleteAfter: deleteAt.toISOString(),
  };
}

function clearTrashedFields<T extends { trashedAt?: string; deleteAfter?: string }>(entry: T): T {
  const { trashedAt, deleteAfter, ...rest } = entry;
  void trashedAt;
  void deleteAfter;
  return rest as T;
}

function linkShareUrl(share: LinkShare) {
  if (!share.token) return '';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/share/${share.token}`;
}

function uploadFailureMessage(xhr: XMLHttpRequest) {
  if (xhr.status === 413) return '파일이 업로드 가능한 크기보다 커요.';
  const fallback = xhr.status >= 500 ? '서버 오류' : '업로드 실패';
  const text = xhr.responseText?.trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    // Proxy/server HTML should not leak into the compact upload UI.
  }
  if (text.startsWith('<')) return fallback;
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function isRetryableUploadResponse(xhr: XMLHttpRequest) {
  if (xhr.status >= 500 || xhr.status === 408 || xhr.status === 429) return true;
  if (xhr.status !== 400) return false;
  const text = xhr.responseText?.trim().toLowerCase() ?? '';
  return (
    !text
    || text.includes('interrupted')
    || text.includes('premature')
    || text.includes('aborted')
    || text.includes('closed')
    || text.includes('network')
  );
}

const isAbortError = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError';

function FixedPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

function countFilesIn(items: LibraryItem[], spaceId: string, parentId?: string | null) {
  return items.filter((item) => (
    item.type === 'file'
    && !item.trashedAt
    && item.spaceId === spaceId
    && (parentId === undefined || item.parentId === parentId)
  )).length;
}

function folderDescendantIds(items: LibraryItem[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let changed = true;

  while (changed) {
    changed = false;
    items.forEach((item) => {
      if (item.type === 'folder' && item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    });
  }

  return ids;
}

function folderStats(items: LibraryItem[], spaceId: string, folderId: string) {
  const folderIds = folderDescendantIds(items, folderId);
  const nestedFolders = items.filter((item) => (
    item.type === 'folder'
    && !item.trashedAt
    && item.spaceId === spaceId
    && item.id !== folderId
    && folderIds.has(item.id)
  ));
  const files = items.filter((item) => (
    item.type === 'file'
    && !item.trashedAt
    && item.spaceId === spaceId
    && item.parentId
    && folderIds.has(item.parentId)
  ));

  return {
    folderCount: nestedFolders.length,
    fileCount: files.length,
    size: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
  };
}

function spaceStats(items: LibraryItem[], spaceId: string) {
  const spaceItems = items.filter((item) => item.spaceId === spaceId && !item.trashedAt);
  return {
    folderCount: spaceItems.filter((item) => item.type === 'folder').length,
    fileCount: spaceItems.filter((item) => item.type === 'file').length,
    size: spaceItems.reduce((sum, item) => sum + (item.type === 'file' ? item.size ?? 0 : 0), 0),
  };
}

function sortSpacesList(spaces: Space[], mode: SortMode) {
  return [...spaces].sort((a, b) => {
    if (mode === 'created') return b.createdAt.localeCompare(a.createdAt);
    if (mode === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
    if (mode === 'type') return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ko');
    return a.name.localeCompare(b.name, 'ko');
  });
}

function sortLibraryItems(items: LibraryItem[], mode: SortMode, allItems: LibraryItem[]) {
  return [...items].sort((a, b) => {
    if (mode === 'created') return b.createdAt.localeCompare(a.createdAt);
    if (mode === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
    if (mode === 'type') {
      const aType = a.type === 'folder' ? 'folder' : fileKind(a);
      const bType = b.type === 'folder' ? 'folder' : fileKind(b);
      return aType.localeCompare(bType) || a.name.localeCompare(b.name, 'ko');
    }
    if (mode === 'size') {
      const aSize = a.type === 'file' ? a.size ?? 0 : folderStats(allItems, a.spaceId, a.id).size;
      const bSize = b.type === 'file' ? b.size ?? 0 : folderStats(allItems, b.spaceId, b.id).size;
      return bSize - aSize || a.name.localeCompare(b.name, 'ko');
    }
    return a.name.localeCompare(b.name, 'ko');
  });
}

function keyboardActivate(e: React.KeyboardEvent, action: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action();
  }
}

export default function Files() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadCancelers = useRef<Map<number, () => void>>(new Map());
  const canceledUploadIds = useRef<Set<number>>(new Set());
  const uploadIdSeq = useRef(0);
  const viewLoadingTimer = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const [urlParams, setUrlParams] = useSearchParams();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(() => urlParams.get('space') || null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => urlParams.get('folder') || null);
  const [viewLoading, setViewLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [createModalMode, setCreateModalMode] = useState<'space' | 'folder' | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTargetState | null>(null);
  const [infoTarget, setInfoTarget] = useState<SettingsTargetState | null>(null);
  const [renameTarget, setRenameTarget] = useState<ContextTargetState | null>(null);
  const [linkShareTarget, setLinkShareTarget] = useState<ContextTargetState | null>(null);
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(() => urlParams.get('preview') || null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [blankContextMenu, setBlankContextMenu] = useState<BlankContextMenuState | null>(null);
  const [serverSpaces, setServerSpaces] = useState<Space[]>([]);
  const [trashedSpaces, setTrashedSpaces] = useState<Space[]>([]);
  const [spaceColorOverrides, setSpaceColorOverrides] = useState<Record<string, string>>({});
  const [linkShares, setLinkShares] = useState<Record<string, LinkShare>>({});
  const [linkExpiryDates, setLinkExpiryDates] = useState<Record<string, string>>({});
  const [trashOpen, setTrashOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [fileUploads, setFileUploads] = useState<FileUploadEntry[]>([]);
  const [fileUploadMin, setFileUploadMin] = useState(false);

  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<Group[]>('/groups'),
  });
  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: () => api<Friendship[]>('/friends'),
  });
  const fileLibrary = useQuery({
    queryKey: ['files'],
    queryFn: () => api<FileLibraryResponse>('/files'),
  });
  const libraryLoading = fileLibrary.isLoading || (!fileLibrary.data && fileLibrary.isFetching);

  const acceptedFriends = useMemo(
    () => (friends.data ?? []).filter((f) => f.status === 'accepted'),
    [friends.data],
  );

  useEffect(() => {
    if (!fileLibrary.data) return;
    setServerSpaces(fileLibrary.data.spaces);
    setTrashedSpaces(fileLibrary.data.trashedSpaces);
    setItems(fileLibrary.data.items);
    const serverShares: Record<string, LinkShare> = {};
    for (const link of fileLibrary.data.activeLinks ?? []) {
      serverShares[targetKey({ type: link.targetType, id: link.targetId })] = {
        expiresAt: link.expiresAt,
        createdAt: link.createdAt,
        accessCount: link.accessCount,
      };
    }
    const serverShareKeys = new Set(Object.keys(serverShares));
    setLinkShares((prev) => {
      const next = { ...serverShares };
      for (const [key, share] of Object.entries(prev)) {
        if (share.token && serverShareKeys.has(key)) {
          next[key] = { ...serverShares[key], token: share.token };
        }
      }
      return next;
    });
    setLinkExpiryDates((prev) => {
      const next = { ...prev };
      for (const [key, share] of Object.entries(serverShares)) {
        if (!next[key]) next[key] = isoToDateInput(share.expiresAt);
      }
      return next;
    });
  }, [fileLibrary.data]);

  useEffect(() => () => {
    if (viewLoadingTimer.current) window.clearTimeout(viewLoadingTimer.current);
  }, []);

  const refreshFiles = () => {
    void fileLibrary.refetch();
    void queryClient.invalidateQueries({ queryKey: ['files', 'usage'] });
  };

  const spaces = useMemo<Space[]>(() => (
    serverSpaces.map((space) => ({
      ...space,
      color: spaceColorOverrides[space.id] ?? space.color,
    }))
  ), [serverSpaces, spaceColorOverrides]);

  const normalizedQuery = query.trim().toLowerCase();
  const activeSpace = activeSpaceId
    ? spaces.find((space) => space.id === activeSpaceId) ?? null
    : null;
  const folderById = useMemo(() => {
    const folders = new Map<string, LibraryItem>();
    items.forEach((item) => {
      if (item.type === 'folder' && !item.trashedAt) folders.set(item.id, item);
    });
    return folders;
  }, [items]);
  const currentFolder = currentFolderId
    ? folderById.get(currentFolderId) ?? null
    : null;
  const folderPath = useMemo(() => {
    if (!activeSpace || !currentFolder) return [];
    const path: LibraryItem[] = [];
    const seen = new Set<string>();
    let folder: LibraryItem | null = currentFolder;
    while (folder && folder.spaceId === activeSpace.id && !seen.has(folder.id)) {
      path.unshift(folder);
      seen.add(folder.id);
      folder = folder.parentId ? folderById.get(folder.parentId) ?? null : null;
    }
    return path;
  }, [activeSpace, currentFolder, folderById]);
  const previewFile = previewTargetId
    ? items.find((item) => item.id === previewTargetId && item.type === 'file' && !item.trashedAt) ?? null
    : null;

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    if (activeSpaceId) next.set('space', activeSpaceId);
    else next.delete('space');
    if (currentFolderId) next.set('folder', currentFolderId);
    else next.delete('folder');
    if (previewTargetId) next.set('preview', previewTargetId);
    else next.delete('preview');

    const current = window.location.search.replace(/^\?/, '');
    const updated = next.toString();
    if (current !== updated) {
      setUrlParams(next, { replace: true });
    }
  }, [activeSpaceId, currentFolderId, previewTargetId, setUrlParams]);

  useEffect(() => {
    if (!fileLibrary.data) return;
    const sourceSpaces = fileLibrary.data.spaces;
    const sourceItems = fileLibrary.data.items;

    if (activeSpaceId && !sourceSpaces.some((space) => space.id === activeSpaceId && !space.trashedAt)) {
      setActiveSpaceId(null);
      setCurrentFolderId(null);
      return;
    }

    if (currentFolderId) {
      const folder = sourceItems.find((item) => (
        item.id === currentFolderId
        && item.type === 'folder'
        && !item.trashedAt
      ));
      if (!folder) {
        setCurrentFolderId(null);
        return;
      }
      if (!activeSpaceId) {
        setActiveSpaceId(folder.spaceId);
        return;
      }
      if (folder.spaceId !== activeSpaceId) {
        setCurrentFolderId(null);
        return;
      }
    }

    if (previewTargetId && !sourceItems.some((item) => (
      item.id === previewTargetId
      && item.type === 'file'
      && !item.trashedAt
    ))) {
      setPreviewTargetId(null);
    }
  }, [
    activeSpaceId,
    currentFolderId,
    fileLibrary.data,
    previewTargetId,
  ]);

  const isRoot = !activeSpace;
  const visibleSpaces = activeSpace
    ? []
    : sortSpacesList(
      spaces.filter((space) => !space.trashedAt && matchesQuery(space.name, normalizedQuery)),
      sortMode,
    );
  const visibleItems = activeSpace
    ? sortLibraryItems(
      items.filter((item) => (
        !item.trashedAt
        && item.spaceId === activeSpace.id
        && item.parentId === currentFolderId
        && matchesQuery(item.name, normalizedQuery)
      )),
      sortMode,
      items,
    )
    : [];
  const cardCount = isRoot ? visibleSpaces.length : visibleItems.length;
  const contentLoading = libraryLoading || viewLoading;
  const sectionTitle = isRoot ? '공간' : '항목';
  const createSpaceId = activeSpace?.id ?? spaces.find((space) => space.kind === 'personal')?.id ?? '';
  const defaultGroupIds = activeSpace?.kind === 'group' && activeSpace.groupId
    ? [activeSpace.groupId]
    : activeSpace?.groupIds ?? [];
  const defaultFriendIds = activeSpace?.friendIds ?? [];
  const canOpenCurrentSettings = Boolean(currentFolder || activeSpace);
  const canUploadInCurrent = Boolean(activeSpace);
  const createActionLabel = isRoot ? '새 공간' : '새 폴더';
  const trashedItemCount = trashedSpaces.length + items.filter((item) => item.trashedAt).length;
  const currentShareAvatars = activeSpace
    ? buildSpaceShareAvatars(activeSpace, groups.data ?? [], acceptedFriends)
    : [];
  const currentShareLabel = activeSpace?.kind === 'personal' ? '나만 보기' : '현재 공유중';
  const selectedTargets = useMemo(() => (
    Array.from(selectedKeys)
      .map(parseTargetKey)
      .filter((target): target is ContextTargetState => {
        if (!target) return false;
        if (target.type === 'space') return spaces.some((space) => space.id === target.id && !space.trashedAt);
        return items.some((item) => item.id === target.id && item.type === target.type && !item.trashedAt);
      })
  ), [items, selectedKeys, spaces]);
  const selectedItemTargets = selectedTargets.filter((target) => target.type !== 'space');

  const settingsModalTarget = useMemo<SettingsModalTarget | null>(() => {
    if (!settingsTarget) return null;

    if (settingsTarget.type === 'space') {
      const space = spaces.find((s) => s.id === settingsTarget.id);
      if (!space) return null;
      return {
        id: space.id,
        type: 'space',
        name: space.name,
        subtitle: space.kind === 'group'
          ? `${space.memberCount ?? 0}명 그룹 파일함`
          : space.description,
        color: space.color,
        kind: space.kind,
        shared: space.kind !== 'personal',
        groupId: space.groupId,
        groupIds: space.groupIds,
        friendIds: space.friendIds,
      };
    }

    const item = items.find((entry) => entry.id === settingsTarget.id);
    if (!item) return null;

    if (item.type === 'file') {
      const space = spaces.find((s) => s.id === item.spaceId);
      return {
        id: item.id,
        type: 'file',
        name: item.name,
        subtitle: shareLabel(item, groups.data ?? [], acceptedFriends, space),
        color: KIND_COLORS[fileKind(item)],
        kind: 'file',
        shared: item.groupIds.length > 0 || item.friendIds.length > 0 || space?.kind !== 'personal',
        groupIds: item.groupIds,
        friendIds: item.friendIds,
      };
    }

    const space = spaces.find((s) => s.id === item.spaceId);
    return {
      id: item.id,
      type: 'folder',
      name: item.name,
      subtitle: item.note ?? shareLabel(item, groups.data ?? [], acceptedFriends, space),
      color: item.color ?? activeSpace?.color ?? '#8FA9D6',
      kind: 'folder',
      shared: item.groupIds.length > 0 || item.friendIds.length > 0 || space?.kind !== 'personal',
      groupIds: item.groupIds,
      friendIds: item.friendIds,
    };
  }, [acceptedFriends, activeSpace?.color, groups.data, items, settingsTarget, spaces]);

  const contextMenuMeta = useMemo(() => {
    if (!contextMenu) return null;
    if (contextMenu.targets.length > 1) {
      const hasSpace = contextMenu.targets.some((target) => target.type === 'space');
      const blockedDefaultSpace = contextMenu.targets.some((target) => (
        target.type === 'space' && !spaces.find((space) => space.id === target.id)?.canDelete
      ));
      return {
        name: `${contextMenu.targets.length}개 항목`,
        settingsLabel: '설정',
        canDelete: !blockedDefaultSpace,
        canCopyMove: !hasSpace,
        targetType: 'multi' as const,
        count: contextMenu.targets.length,
      };
    }

    if (contextMenu.target.type === 'space') {
      const space = spaces.find((s) => s.id === contextMenu.target.id);
      if (!space) return null;
      return {
        name: space.name,
        settingsLabel: '설정',
        canDelete: Boolean(space.canDelete),
        canCopyMove: false,
        targetType: 'space' as const,
        count: 1,
      };
    }

    const item = items.find((entry) => entry.id === contextMenu.target.id);
    if (!item) return null;

    return {
      name: item.name,
      settingsLabel: '설정',
      canDelete: true,
      canCopyMove: true,
      targetType: item.type,
      count: 1,
    };
  }, [contextMenu, items, spaces]);

  const renameModalTarget = useMemo(() => {
    if (!renameTarget) return null;
    if (renameTarget.type === 'space') {
      const space = spaces.find((s) => s.id === renameTarget.id);
      if (!space) return null;
      return {
        id: space.id,
        type: 'space' as const,
        name: space.name,
        label: '공간 이름',
      };
    }

    const item = items.find((entry) => entry.id === renameTarget.id && entry.type === renameTarget.type);
    if (!item) return null;
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      label: item.type === 'folder' ? '폴더 이름' : '파일 이름',
    };
  }, [items, renameTarget, spaces]);

  const linkShareModalTarget = useMemo<SettingsModalTarget | null>(() => {
    if (!linkShareTarget) return null;

    if (linkShareTarget.type === 'space') {
      const space = spaces.find((s) => s.id === linkShareTarget.id);
      if (!space) return null;
      return {
        id: space.id,
        type: 'space',
        name: space.name,
        subtitle: space.kind === 'group'
          ? `${space.memberCount ?? 0}명 그룹 파일함`
          : space.description,
        color: space.color,
        kind: space.kind,
        shared: space.kind !== 'personal',
        groupId: space.groupId,
        groupIds: space.groupIds,
        friendIds: space.friendIds,
      };
    }

    const item = items.find((entry) => entry.id === linkShareTarget.id);
    if (!item) return null;
    if (item.type === 'file') {
      const space = spaces.find((s) => s.id === item.spaceId);
      return {
        id: item.id,
        type: 'file',
        name: item.name,
        subtitle: shareLabel(item, groups.data ?? [], acceptedFriends, space),
        color: KIND_COLORS[fileKind(item)],
        kind: 'file',
        shared: item.groupIds.length > 0 || item.friendIds.length > 0 || space?.kind !== 'personal',
        groupIds: item.groupIds,
        friendIds: item.friendIds,
      };
    }

    const space = spaces.find((s) => s.id === item.spaceId);
    return {
      id: item.id,
      type: 'folder',
      name: item.name,
      subtitle: item.note ?? shareLabel(item, groups.data ?? [], acceptedFriends, space),
      color: item.color ?? activeSpace?.color ?? '#8FA9D6',
      kind: 'folder',
      shared: item.groupIds.length > 0 || item.friendIds.length > 0 || space?.kind !== 'personal',
      groupIds: item.groupIds,
      friendIds: item.friendIds,
    };
  }, [acceptedFriends, activeSpace?.color, groups.data, items, linkShareTarget, spaces]);

  const infoModalTarget = useMemo<InfoModalTarget | null>(() => {
    if (!infoTarget) return null;

    if (infoTarget.type === 'space') {
      const space = spaces.find((s) => s.id === infoTarget.id);
      if (!space) return null;
      const stats = spaceStats(items, space.id);
      const shared = space.kind !== 'personal';
      const sharing = space.kind === 'group'
        ? space.description
        : shareSelectionLabel(
          { groupIds: space.groupIds ?? [], friendIds: space.friendIds ?? [] },
          groups.data ?? [],
          acceptedFriends,
        );

      return {
        type: 'space',
        name: space.name,
        subtitle: space.kind === 'group' ? '그룹 공간' : shared ? '공유 공간' : '개인 공간',
        color: space.color,
        shared,
        rows: [
          { label: '종류', value: space.kind === 'group' ? '그룹 공간' : shared ? '공유 공간' : '개인 공간' },
          { label: '위치', value: '내 파일' },
          { label: '크기', value: formatSize(stats.size) },
          { label: '포함 항목', value: `폴더 ${stats.folderCount}개 · 파일 ${stats.fileCount}개` },
          { label: '생성일', value: formatDateTime(space.createdAt) },
          { label: '수정일', value: formatDateTime(space.updatedAt) },
          { label: '공유 상태', value: sharing },
        ],
      };
    }

    const folder = items.find((item) => item.id === infoTarget.id && item.type === 'folder');
    if (!folder) {
      const file = items.find((item) => item.id === infoTarget.id && item.type === 'file');
      if (!file) return null;
      const space = spaces.find((s) => s.id === file.spaceId);
      const parent = file.parentId
        ? items.find((item) => item.id === file.parentId && item.type === 'folder')
        : null;
      const kind = fileKind(file);

      return {
        type: 'file',
        name: file.name,
        subtitle: KIND_LABEL[kind],
        color: KIND_COLORS[kind],
        shared: file.groupIds.length > 0 || file.friendIds.length > 0 || space?.kind !== 'personal',
        fileKind: kind,
        rows: [
          { label: '종류', value: KIND_LABEL[kind] },
          { label: '위치', value: parent ? `${space?.name ?? '파일함'} / ${parent.name}` : space?.name ?? '파일함' },
          { label: '크기', value: formatSize(file.size) },
          { label: '생성일', value: formatDateTime(file.createdAt) },
          { label: '수정일', value: formatDateTime(file.updatedAt) },
          { label: '공유 상태', value: shareLabel(file, groups.data ?? [], acceptedFriends, space) },
          { label: '소유자', value: file.ownerName },
        ],
      };
    }
    const space = spaces.find((s) => s.id === folder.spaceId);
    const stats = folderStats(items, folder.spaceId, folder.id);

    return {
      type: 'folder',
      name: folder.name,
      subtitle: '폴더',
      color: folder.color ?? space?.color,
      shared: folder.groupIds.length > 0 || folder.friendIds.length > 0 || space?.kind !== 'personal',
      rows: [
        { label: '종류', value: '폴더' },
        { label: '위치', value: space?.name ?? '파일함' },
        { label: '크기', value: formatSize(stats.size) },
        { label: '포함 항목', value: `폴더 ${stats.folderCount}개 · 파일 ${stats.fileCount}개` },
        { label: '생성일', value: formatDateTime(folder.createdAt) },
        { label: '수정일', value: formatDateTime(folder.updatedAt) },
        { label: '공유 상태', value: shareLabel(folder, groups.data ?? [], acceptedFriends, space) },
        { label: '소유자', value: folder.ownerName },
      ],
    };
  }, [acceptedFriends, groups.data, infoTarget, items, spaces]);

  useEffect(() => {
    if (!contextMenu && !blankContextMenu) return undefined;
    const close = () => {
      setContextMenu(null);
      setBlankContextMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [blankContextMenu, contextMenu]);

  useEffect(() => () => {
    document.body.classList.remove('fileshare-is-selecting');
  }, []);

  useEffect(() => {
    if (selectedKeys.size === 0) return undefined;
    const clearOnOutsidePointerDown = (event: PointerEvent) => {
      if (selectionBox || event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(
        '.fileshare-selectable, .fileshare-selection-toolbar, .fileshare-context-menu, .fileshare-share-modal, .files-preview-shell, .fileshare-upload-progress',
      )) {
        return;
      }
      setSelectedKeys(new Set());
    };

    document.addEventListener('pointerdown', clearOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', clearOnOutsidePointerDown, true);
  }, [selectedKeys.size, selectionBox]);

  const fileUploadsFinished = fileUploads.length > 0
    && fileUploads.every((entry) => entry.done || entry.err || entry.canceled);
  useEffect(() => {
    if (!fileUploadsFinished) return undefined;
    const timer = window.setTimeout(() => setFileUploads([]), 5000);
    return () => window.clearTimeout(timer);
  }, [fileUploadsFinished]);

  const beginViewLoading = () => {
    if (viewLoadingTimer.current) window.clearTimeout(viewLoadingTimer.current);
    setViewLoading(true);
    viewLoadingTimer.current = window.setTimeout(() => {
      setViewLoading(false);
      viewLoadingTimer.current = null;
    }, 220);
  };

  const selectSpace = (spaceId: string | null) => {
    if (activeSpaceId !== spaceId || currentFolderId !== null) beginViewLoading();
    setActiveSpaceId(spaceId);
    setCurrentFolderId(null);
    setQuery('');
    setSelectedKeys(new Set());
  };

  const openSpaceRoot = () => {
    if (currentFolderId !== null) beginViewLoading();
    setCurrentFolderId(null);
    setQuery('');
    setSelectedKeys(new Set());
  };

  const openFolder = (folderId: string) => {
    if (currentFolderId !== folderId) beginViewLoading();
    setCurrentFolderId(folderId);
    setQuery('');
    setSelectedKeys(new Set());
  };

  const openParent = () => {
    if (currentFolder) {
      beginViewLoading();
      setCurrentFolderId(currentFolder.parentId ?? null);
      setQuery('');
      setSelectedKeys(new Set());
      return;
    }
    selectSpace(null);
  };

  const markFileUploadCanceled = (entryId: number) => {
    uploadCancelers.current.delete(entryId);
    canceledUploadIds.current.add(entryId);
    setFileUploads((entries) => entries.map((entry) => (
      entry.id === entryId && !entry.done && !entry.err && !entry.canceled
        ? { ...entry, canceled: true, err: undefined }
        : entry
    )));
  };

  const cancelFileUpload = (entryId: number) => {
    canceledUploadIds.current.add(entryId);
    const cancel = uploadCancelers.current.get(entryId);
    if (cancel) cancel();
    else markFileUploadCanceled(entryId);
  };

  const markFileUploadProgress = (entryId: number, pct: number) => {
    const safePct = Math.max(0, Math.min(100, pct));
    setFileUploads((entries) => entries.map((entry) => (
      entry.id === entryId ? { ...entry, pct: safePct } : entry
    )));
  };

  const markFileUploadDone = (entryId: number) => {
    uploadCancelers.current.delete(entryId);
    setFileUploads((entries) => entries.map((entry) => (
      entry.id === entryId
        ? { ...entry, pct: 100, done: true, canceled: false, err: undefined }
        : entry
    )));
  };

  const markFileUploadFailed = (entryId: number, errMsg: string) => {
    uploadCancelers.current.delete(entryId);
    setFileUploads((entries) => entries.map((entry) => (
      entry.id === entryId ? { ...entry, canceled: false, err: errMsg } : entry
    )));
  };

  const handleUpload = async (files: File[], target: ShareTarget) => {
    if (!target.spaceId) return;
    const parentId = target.spaceId === activeSpaceId ? currentFolderId : null;
    type FileUploadResult = 'done' | 'failed' | 'canceled';
    type QueuedUpload = { file: File; entryId: number };

    const entries = files.map((file, index) => ({
      file,
      entryId: uploadIdSeq.current + index + 1,
    }));
    uploadIdSeq.current += files.length;
    entries.forEach((entry) => canceledUploadIds.current.delete(entry.entryId));
    setFileUploadMin(false);
    setFileUploads((prev) => [
      ...prev,
      ...entries.map(({ file, entryId }) => ({
        id: entryId,
        name: file.name,
        size: file.size,
        pct: 0,
        done: false,
      })),
    ]);

    const runtimes = new Map<number, FileUploadRuntime>();
    const cancelError = new Error('upload canceled');

    const cleanupChunkedSession = (runtime: FileUploadRuntime) => {
      if (!runtime.uploadId || runtime.cleaning) return;
      runtime.cleaning = true;
      void uploadApi(`/files/upload/chunked/${runtime.uploadId}`, { method: 'DELETE' }).catch(() => {});
    };

    const abortRuntimeRequests = (runtime: FileUploadRuntime) => {
      for (const timer of runtime.retryTimers) clearTimeout(timer);
      runtime.retryTimers.clear();
      runtime.initAbort?.abort();
      runtime.completeAbort?.abort();
      for (const xhr of runtime.xhrs) xhr.abort();
      runtime.xhrs.clear();
    };

    entries.forEach(({ entryId }) => {
      const runtime: FileUploadRuntime = {
        canceled: false,
        xhrs: new Set(),
        retryTimers: new Set(),
        uploadId: null,
        initAbort: null,
        completeAbort: null,
        cleaning: false,
      };
      runtimes.set(entryId, runtime);
      uploadCancelers.current.set(entryId, () => {
        if (runtime.canceled) return;
        runtime.canceled = true;
        canceledUploadIds.current.add(entryId);
        abortRuntimeRequests(runtime);
        cleanupChunkedSession(runtime);
        markFileUploadCanceled(entryId);
      });
    });

    const uploadDirectFile = (
      file: File,
      entryId: number,
      attempt = 0,
    ): Promise<FileUploadResult> => new Promise((resolve) => {
      const runtime = runtimes.get(entryId);
      if (!runtime || runtime.canceled) {
        markFileUploadCanceled(entryId);
        resolve('canceled');
        return;
      }

      const body = new FormData();
      body.append('spaceId', target.spaceId);
      if (parentId) body.append('parentId', parentId);
      body.append('files', file, file.name);

      const xhr = new XMLHttpRequest();
      runtime.xhrs.add(xhr);
      xhr.open('POST', uploadApiUrl('/files/upload'));
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) markFileUploadProgress(entryId, (e.loaded / e.total) * 100);
      };

      const retryOrFail = (errMsg: string) => {
        runtime.xhrs.delete(xhr);
        if (runtime.canceled) {
          markFileUploadCanceled(entryId);
          resolve('canceled');
          return;
        }
        if (attempt < FILE_UPLOAD_MAX_RETRIES) {
          const timer = setTimeout(() => {
            runtime.retryTimers.delete(timer);
            if (runtime.canceled) {
              markFileUploadCanceled(entryId);
              resolve('canceled');
              return;
            }
            uploadDirectFile(file, entryId, attempt + 1).then(resolve);
          }, FILE_UPLOAD_RETRY_BASE_MS * (attempt + 1));
          runtime.retryTimers.add(timer);
          return;
        }
        markFileUploadFailed(entryId, errMsg);
        resolve('failed');
      };

      xhr.onload = () => {
        runtime.xhrs.delete(xhr);
        if (runtime.canceled) {
          markFileUploadCanceled(entryId);
          resolve('canceled');
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          markFileUploadDone(entryId);
          resolve('done');
        } else if (isRetryableUploadResponse(xhr)) {
          retryOrFail(uploadFailureMessage(xhr));
        } else {
          markFileUploadFailed(entryId, uploadFailureMessage(xhr));
          resolve('failed');
        }
      };
      xhr.onerror = () => retryOrFail('네트워크 오류');
      xhr.ontimeout = () => retryOrFail('타임아웃');
      xhr.onabort = () => {
        runtime.xhrs.delete(xhr);
        if (runtime.canceled) {
          markFileUploadCanceled(entryId);
          resolve('canceled');
        } else {
          markFileUploadFailed(entryId, '업로드가 중단됐어요');
          resolve('failed');
        }
      };
      xhr.send(body);
    });

    const uploadChunk = (
      file: File,
      uploadId: string,
      chunkIndex: number,
      entryId: number,
      chunkLoaded: Map<number, number>,
      attempt = 0,
    ): Promise<void> => new Promise((resolve, reject) => {
      const runtime = runtimes.get(entryId);
      if (!runtime || runtime.canceled) {
        reject(cancelError);
        return;
      }
      const start = chunkIndex * FILE_UPLOAD_CHUNK_SIZE_BYTES;
      const end = Math.min(file.size, start + FILE_UPLOAD_CHUNK_SIZE_BYTES);
      const chunkBytes = end - start;
      const body = new FormData();
      body.append('chunk', file.slice(start, end), file.name);

      const xhr = new XMLHttpRequest();
      runtime.xhrs.add(xhr);
      xhr.open('POST', uploadApiUrl(`/files/upload/chunked/${uploadId}/chunks/${chunkIndex}`));
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        chunkLoaded.set(chunkIndex, Math.min(chunkBytes, e.loaded));
        const loaded = Array.from(chunkLoaded.values()).reduce((sum, value) => sum + value, 0);
        markFileUploadProgress(entryId, Math.min(99, (loaded / file.size) * 100));
      };

      const retryOrReject = (errMsg: string) => {
        runtime.xhrs.delete(xhr);
        if (runtime.canceled) {
          reject(cancelError);
          return;
        }
        if (attempt < FILE_UPLOAD_MAX_RETRIES) {
          const timer = setTimeout(() => {
            runtime.retryTimers.delete(timer);
            if (runtime.canceled) {
              reject(cancelError);
              return;
            }
            uploadChunk(file, uploadId, chunkIndex, entryId, chunkLoaded, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, FILE_UPLOAD_RETRY_BASE_MS * (attempt + 1));
          runtime.retryTimers.add(timer);
          return;
        }
        reject(new Error(errMsg));
      };

      xhr.onload = () => {
        runtime.xhrs.delete(xhr);
        if (runtime.canceled) {
          reject(cancelError);
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          chunkLoaded.set(chunkIndex, chunkBytes);
          const loaded = Array.from(chunkLoaded.values()).reduce((sum, value) => sum + value, 0);
          markFileUploadProgress(entryId, Math.min(99, (loaded / file.size) * 100));
          resolve();
        } else if (isRetryableUploadResponse(xhr)) {
          retryOrReject(uploadFailureMessage(xhr));
        } else {
          reject(new Error(uploadFailureMessage(xhr)));
        }
      };
      xhr.onerror = () => retryOrReject('네트워크 오류');
      xhr.ontimeout = () => retryOrReject('타임아웃');
      xhr.onabort = () => {
        runtime.xhrs.delete(xhr);
        if (runtime.canceled) reject(cancelError);
        else reject(new Error('업로드가 중단됐어요'));
      };
      xhr.send(body);
    });

    const uploadChunkedFile = async (file: File, entryId: number): Promise<FileUploadResult> => {
      const runtime = runtimes.get(entryId);
      if (!runtime || runtime.canceled) {
        markFileUploadCanceled(entryId);
        return 'canceled';
      }
      try {
        const totalChunks = Math.ceil(file.size / FILE_UPLOAD_CHUNK_SIZE_BYTES);
        runtime.initAbort = new AbortController();
        const init = await uploadApi<{ uploadId: string; chunkSize: number; totalChunks: number }>(
          '/files/upload/chunked/init',
          {
            method: 'POST',
            signal: runtime.initAbort.signal,
            body: JSON.stringify({
              spaceId: target.spaceId,
              parentId,
              filename: file.name,
              mime: file.type || '',
              size: file.size,
              chunkSize: FILE_UPLOAD_CHUNK_SIZE_BYTES,
              totalChunks,
            }),
          },
        );
        runtime.initAbort = null;
        if (runtime.canceled) throw cancelError;
        runtime.uploadId = init.uploadId;

        let nextChunkIndex = 0;
        const chunkLoaded = new Map<number, number>();
        const uploadNextChunk = async () => {
          while (nextChunkIndex < init.totalChunks) {
            if (runtime.canceled) throw cancelError;
            const chunkIndex = nextChunkIndex;
            nextChunkIndex += 1;
            await uploadChunk(file, init.uploadId, chunkIndex, entryId, chunkLoaded);
          }
        };
        await Promise.all(Array.from(
          { length: Math.min(FILE_CHUNK_UPLOAD_CONCURRENCY, init.totalChunks) },
          () => uploadNextChunk(),
        ));
        if (runtime.canceled) throw cancelError;
        markFileUploadProgress(entryId, 99);
        runtime.completeAbort = new AbortController();
        await uploadApi<{ created?: string[] }>(
          `/files/upload/chunked/${init.uploadId}/complete`,
          { method: 'POST', signal: runtime.completeAbort.signal },
        );
        runtime.completeAbort = null;
        if (runtime.canceled) throw cancelError;
        markFileUploadDone(entryId);
        return 'done';
      } catch (err) {
        runtime.initAbort = null;
        runtime.completeAbort = null;
        if (runtime.canceled || err === cancelError || isAbortError(err)) {
          markFileUploadCanceled(entryId);
          cleanupChunkedSession(runtime);
          return 'canceled';
        }
        abortRuntimeRequests(runtime);
        cleanupChunkedSession(runtime);
        markFileUploadFailed(entryId, err instanceof Error ? err.message : '업로드 실패');
        return 'failed';
      }
    };

    const directQueue = entries.filter(({ file }) => file.size <= FILE_CHUNKED_UPLOAD_THRESHOLD_BYTES);
    const chunkedQueue = entries.filter(({ file }) => file.size > FILE_CHUNKED_UPLOAD_THRESHOLD_BYTES);
    const results = new Map<number, FileUploadResult>();

    const pump = async (
      queue: QueuedUpload[],
      uploader: (file: File, entryId: number) => Promise<FileUploadResult>,
    ) => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        results.set(next.entryId, await uploader(next.file, next.entryId));
      }
    };

    const runQueue = async (
      queue: QueuedUpload[],
      uploader: (file: File, entryId: number) => Promise<FileUploadResult>,
      concurrency: number,
    ) => {
      await Promise.all(Array.from(
        { length: Math.min(concurrency, queue.length) },
        () => pump(queue, uploader),
      ));
    };

    await Promise.all([
      runQueue(directQueue, uploadDirectFile, FILE_DIRECT_UPLOAD_CONCURRENCY),
      runQueue(chunkedQueue, uploadChunkedFile, FILE_CHUNKED_UPLOAD_CONCURRENCY),
    ]);

    const finished = Array.from(results.values());
    const done = finished.filter((result) => result === 'done').length;
    const failed = finished.filter((result) => result === 'failed').length;
    const canceled = finished.filter((result) => result === 'canceled').length;
    if (done > 0) {
      setActiveSpaceId(target.spaceId);
      setCurrentFolderId(parentId);
      setSelectedKeys(new Set());
      refreshFiles();
    }
    if (failed > 0) {
      toast.error(`파일 ${failed}개 업로드에 실패했어요`);
    } else if (done > 0 && canceled === 0) {
      toast.success(`파일 ${done}개를 추가했어요`);
    }
  };

  const handlePickedFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!canUploadInCurrent) {
      toast('먼저 공간을 선택한 뒤 파일을 업로드하세요.');
      return;
    }
    void handleUpload(files, {
      spaceId: createSpaceId,
      groupIds: defaultGroupIds,
      friendIds: defaultFriendIds,
    });
  };

  const handleCreateSpace = async (name: string, sharing: ShareSelection) => {
    try {
      await api('/files/spaces', {
        method: 'POST',
        body: JSON.stringify({
          name,
          groupIds: sharing.groupIds,
          friendIds: sharing.friendIds,
          color: themeAt(spaces.length + 1).base,
        }),
      });
      setQuery('');
      refreshFiles();
      toast.success('공간을 만들었어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공간을 만들지 못했어요');
    }
  };

  const handleCreateFolder = async (name: string) => {
    if (!activeSpace) return;
    const parentId = currentFolderId;
    try {
      await api('/files/folders', {
        method: 'POST',
        body: JSON.stringify({
          spaceId: activeSpace.id,
          parentId,
          name,
          color: themeAt(items.filter((item) => item.type === 'folder').length + 6).base,
        }),
      });
      setCurrentFolderId(parentId);
      refreshFiles();
      toast.success('폴더를 만들었어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '폴더를 만들지 못했어요');
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length === 0) return;
    if (!canUploadInCurrent) {
      toast('먼저 내 보관함이나 그룹을 선택한 뒤 파일을 업로드하세요.');
      return;
    }
    void handleUpload(dropped, {
      spaceId: createSpaceId,
      groupIds: defaultGroupIds,
      friendIds: defaultFriendIds,
    });
  };

  const openFolderCreate = () => {
    setCreateModalMode(isRoot ? 'space' : 'folder');
  };

  const openUploadPicker = () => {
    if (!canUploadInCurrent) {
      toast('루트에서는 공간을 선택해야 파일을 업로드할 수 있어요.');
      return;
    }
    fileInputRef.current?.click();
  };

  const openShareSettings = () => {
    if (currentFolder) {
      setSettingsTarget({ type: 'folder', id: currentFolder.id });
      return;
    }
    if (activeSpace) {
      setSettingsTarget({ type: 'space', id: activeSpace.id });
    }
  };

  const openContextMenu = (e: React.MouseEvent, target: ContextTargetState) => {
    e.preventDefault();
    const width = 220;
    const key = targetKey(target);
    const targets = selectedKeys.has(key) && selectedTargets.length > 1
      ? selectedTargets
      : [target];
    if (targets.length === 1 && selectedKeys.size > 0 && !selectedKeys.has(key)) {
      setSelectedKeys(new Set([key]));
    }
    const height = targets.length > 1 ? 188 : target.type === 'file' ? 416 : target.type === 'space' ? 296 : 378;
    setBlankContextMenu(null);
    setContextMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - height - 8)),
      target,
      targets,
    });
  };

  const openBlankContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (contentLoading) return;
    const target = e.target as HTMLElement;
    if (target.closest('.fileshare-folder-tile, .fileshare-file-tile, button, input, select, a, .fileshare-context-menu')) {
      return;
    }
    e.preventDefault();
    const width = 220;
    const height = isRoot ? 142 : clipboard ? 222 : 178;
    setContextMenu(null);
    setBlankContextMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - height - 8)),
    });
  };

  const openFilePreview = (fileId: string) => {
    setContextMenu(null);
    setPreviewTargetId(fileId);
  };

  const openContextTarget = (target: ContextTargetState) => {
    setContextMenu(null);
    if (target.type === 'space') {
      selectSpace(target.id);
      return;
    }
    if (target.type === 'file') {
      openFilePreview(target.id);
      return;
    }
    openFolder(target.id);
  };

  const openContextSettings = (target: ContextTargetState) => {
    setContextMenu(null);
    setSettingsTarget(target);
  };

  const openContextRename = (target: ContextTargetState) => {
    setContextMenu(null);
    setRenameTarget(target);
  };

  const openContextLinkShare = (target: ContextTargetState) => {
    setContextMenu(null);
    setLinkShareTarget(target);
  };

  const openContextInfo = (target: ContextTargetState) => {
    setContextMenu(null);
    setInfoTarget(target);
  };

  const downloadContextTarget = (target: ContextTargetState) => {
    setContextMenu(null);
    if (target.type !== 'file') return;
    window.open(uploadApiUrl(`/files/nodes/${target.id}/download`), '_blank', 'noopener,noreferrer');
  };

  const toggleSelection = (target: ContextTargetState) => {
    const key = targetKey(target);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectOnly = (target: ContextTargetState) => {
    setSelectedKeys(new Set([targetKey(target)]));
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
  };

  const updateTargetColor = (target: ContextTargetState, color: string) => {
    if (target.type === 'space') {
      setSpaceColorOverrides((prev) => ({ ...prev, [target.id]: color }));
      void api(`/files/spaces/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ color }),
      })
        .then(() => {
          refreshFiles();
          toast.success('색상을 변경했어요');
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : '색상을 변경하지 못했어요'));
      return;
    }
    if (target.type === 'folder') {
      setItems((prev) => prev.map((item) => (
        item.id === target.id && item.type === 'folder'
          ? { ...item, color, updatedAt: new Date().toISOString() }
          : item
      )));
      void api(`/files/nodes/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ color }),
      })
        .then(() => {
          refreshFiles();
          toast.success('색상을 변경했어요');
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : '색상을 변경하지 못했어요'));
    }
  };

  const renameContextTarget = async (target: ContextTargetState, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (target.type === 'space') {
      setServerSpaces((prev) => prev.map((space) => (
        space.id === target.id ? { ...space, name: trimmed, updatedAt: new Date().toISOString() } : space
      )));
      try {
        await api(`/files/spaces/${target.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: trimmed }),
        });
        refreshFiles();
        toast.success('이름을 변경했어요');
      } catch (err) {
        refreshFiles();
        toast.error(err instanceof Error ? err.message : '이름을 변경하지 못했어요');
      }
      return;
    }

    setItems((prev) => prev.map((item) => (
      item.id === target.id && item.type === target.type
        ? { ...item, name: trimmed, updatedAt: new Date().toISOString() }
        : item
    )));
    try {
      await api(`/files/nodes/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      refreshFiles();
      toast.success('이름을 변경했어요');
    } catch (err) {
      refreshFiles();
      toast.error(err instanceof Error ? err.message : '이름을 변경하지 못했어요');
    }
  };

  const affectedTargetKeys = (targets: ContextTargetState[]) => {
    const keys = new Set(targets.map(targetKey));
    const spaceIds = new Set(targets.filter((target) => target.type === 'space').map((target) => target.id));
    const folderIds = new Set<string>();
    targets
      .filter((target) => target.type === 'folder')
      .forEach((target) => folderDescendantIds(items, target.id).forEach((id) => folderIds.add(id)));

    items.forEach((item) => {
      if (spaceIds.has(item.spaceId)) {
        keys.add(targetKey({ type: item.type, id: item.id }));
        return;
      }
      if (item.type === 'folder' && folderIds.has(item.id)) {
        keys.add(targetKey({ type: 'folder', id: item.id }));
        return;
      }
      if (item.type === 'file' && item.parentId && folderIds.has(item.parentId)) {
        keys.add(targetKey({ type: 'file', id: item.id }));
      }
    });

    return keys;
  };

  const moveTargetsToTrash = async (targets: ContextTargetState[]) => {
    const uniqueTargets = targets.filter((target, index, all) => (
      all.findIndex((entry) => targetKey(entry) === targetKey(target)) === index
    ));
    if (uniqueTargets.length === 0) return;

    const blockedDefaultSpace = uniqueTargets.find((target) => (
      target.type === 'space' && !spaces.find((space) => space.id === target.id)?.canDelete
    ));
    if (blockedDefaultSpace) {
      toast('기본 공간은 삭제할 수 없어요.');
      return;
    }

    const spaceIds = new Set(uniqueTargets.filter((target) => target.type === 'space').map((target) => target.id));
    const folderIds = new Set<string>();
    uniqueTargets
      .filter((target) => target.type === 'folder')
      .forEach((target) => folderDescendantIds(items, target.id).forEach((id) => folderIds.add(id)));
    const affectedKeys = affectedTargetKeys(uniqueTargets);

    try {
      await Promise.all(uniqueTargets.map((target) => (
        target.type === 'space'
          ? api(`/files/spaces/${target.id}/trash`, { method: 'POST' })
          : api(`/files/nodes/${target.id}/trash`, { method: 'POST' })
      )));

      setLinkShares((prev) => {
        const next = { ...prev };
        affectedKeys.forEach((key) => delete next[key]);
        return next;
      });
      setSelectedKeys(new Set());
      setContextMenu(null);
      setBlankContextMenu(null);

      if (activeSpaceId && spaceIds.has(activeSpaceId)) selectSpace(null);
      if (currentFolderId && folderIds.has(currentFolderId)) setCurrentFolderId(null);
      if (settingsTarget && affectedKeys.has(targetKey(settingsTarget))) setSettingsTarget(null);
      if (infoTarget && affectedKeys.has(targetKey(infoTarget))) setInfoTarget(null);
      if (linkShareTarget && affectedKeys.has(targetKey(linkShareTarget))) setLinkShareTarget(null);
      refreshFiles();
      toast.success(uniqueTargets.length > 1 ? `${uniqueTargets.length}개 항목을 휴지통으로 이동했어요` : '휴지통으로 이동했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '휴지통으로 이동하지 못했어요');
    }
  };

  const restoreTrashTarget = async (target: ContextTargetState) => {
    try {
      await api(
        target.type === 'space'
          ? `/files/spaces/${target.id}/restore`
          : `/files/nodes/${target.id}/restore`,
        { method: 'POST' },
      );
      refreshFiles();
      toast.success(target.type === 'space' ? '공간을 복원했어요' : target.type === 'file' ? '파일을 복원했어요' : '폴더를 복원했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복원하지 못했어요');
    }
  };

  const permanentlyDeleteTrashTarget = async (target: ContextTargetState) => {
    const affectedKeys = affectedTargetKeys([target]);

    try {
      await api(
        target.type === 'space'
          ? `/files/spaces/${target.id}`
          : `/files/nodes/${target.id}`,
        { method: 'DELETE' },
      );
      setLinkShares((prev) => {
        const next = { ...prev };
        affectedKeys.forEach((key) => delete next[key]);
        return next;
      });
      refreshFiles();
      toast.success('영구 삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '영구 삭제하지 못했어요');
    }
  };

  const copyTargetsToClipboard = (mode: ClipboardMode, targets = selectedItemTargets) => {
    const copyable = targets.filter((target) => target.type !== 'space');
    if (copyable.length === 0) {
      toast('파일이나 폴더를 먼저 선택하세요.');
      return;
    }
    setClipboard({ mode, targets: copyable });
    if (mode === 'copy') {
      toast.success(`${copyable.length}개 항목을 복사했어요`);
      return;
    }
    toast.success(`${copyable.length}개 항목을 이동할 준비를 했어요`, {
      description: '원하는 위치로 이동한 뒤 하단 바의 이동 붙여넣기 또는 빈 공간 우클릭 메뉴의 붙여넣기를 누르세요.',
    });
  };

  const pasteClipboard = async () => {
    if (!activeSpace) {
      toast('공간 안에서만 붙여넣을 수 있어요.');
      return;
    }
    if (!clipboard || clipboard.targets.length === 0) {
      toast('붙여넣을 항목이 없어요.');
      return;
    }

    if (clipboard.mode === 'move') {
      const blocked = clipboard.targets.some((target) => (
        target.type === 'folder'
        && currentFolderId
        && folderDescendantIds(items, target.id).has(currentFolderId)
      ));
      if (blocked) {
        toast('폴더를 자기 자신 안으로 이동할 수 없어요.');
        return;
      }
    }

    const nodeIds = clipboard.targets
      .filter((target) => target.type !== 'space')
      .map((target) => target.id);
    if (nodeIds.length === 0) {
      toast('붙여넣을 수 있는 항목이 없어요.');
      return;
    }

    try {
      const result = await api<{ copied?: string[] }>(
        clipboard.mode === 'move' ? '/files/nodes/move' : '/files/nodes/copy',
        {
          method: 'POST',
          body: JSON.stringify({
            nodeIds,
            targetSpaceId: activeSpace.id,
            targetParentId: currentFolderId,
          }),
        },
      );
      if (clipboard.mode === 'move') setClipboard(null);
      setSelectedKeys(new Set());
      refreshFiles();
      toast.success(clipboard.mode === 'move'
        ? '항목을 이동했어요'
        : `${result.copied?.length ?? nodeIds.length}개 항목을 붙여넣었어요`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '붙여넣지 못했어요');
    }
  };

  const handleSelectionPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (contentLoading) return;
    if (!activeSpace || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.fileshare-folder-tile, .fileshare-file-tile, button, input, select, a')) return;

    e.preventDefault();
    const area = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    document.body.classList.add('fileshare-is-selecting');
    setSelectionBox({ startX, startY, x: startX, y: startY });

    const onMove = (event: PointerEvent) => {
      if (Math.abs(event.clientX - startX) > 4 || Math.abs(event.clientY - startY) > 4) moved = true;
      setSelectionBox({ startX, startY, x: event.clientX, y: event.clientY });
    };
    const finishSelection = (event?: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finishSelection);
      window.removeEventListener('pointercancel', cancelSelection);
      document.body.classList.remove('fileshare-is-selecting');

      if (moved && event) {
        const left = Math.min(startX, event.clientX);
        const right = Math.max(startX, event.clientX);
        const top = Math.min(startY, event.clientY);
        const bottom = Math.max(startY, event.clientY);
        const next = new Set<string>();

        area.querySelectorAll<HTMLElement>('[data-select-key]').forEach((node) => {
          const rect = node.getBoundingClientRect();
          const intersects = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
          if (intersects) {
            const key = node.dataset.selectKey;
            if (key) next.add(key);
          }
        });
        setSelectedKeys(next);
      } else if (!moved) {
        setSelectedKeys(new Set());
      }
      setSelectionBox(null);
    };
    const cancelSelection = () => finishSelection();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finishSelection);
    window.addEventListener('pointercancel', cancelSelection);
  };

  const linkControlsFor = (target: ContextTargetState): LinkShareControls => {
    const key = targetKey(target);
    const share = linkShares[key];
    const expiresDate = linkExpiryDates[key] ?? isoToDateInput(share?.expiresAt);
    const url = share?.token ? linkShareUrl(share) : undefined;

    return {
      share,
      url,
      expiresDate,
      onExpiresDateChange: (value) => {
        setLinkExpiryDates((prev) => ({ ...prev, [key]: value }));
      },
      onEnable: () => {
        if (!expiresDate) {
          toast('링크 만료일을 선택하세요.');
          return;
        }
        const hadShare = Boolean(share);
        void api<LinkShare>('/files/links', {
          method: 'POST',
          body: JSON.stringify({
            targetType: target.type,
            targetId: target.id,
            expiresAt: dateInputToExpiryIso(expiresDate),
          }),
        }).then((nextShare) => {
          setLinkShares((prev) => ({
            ...prev,
            [key]: nextShare,
          }));
          toast.success(hadShare ? '링크를 새로 만들고 만료일을 저장했어요' : '링크 공유를 켰어요');
        }).catch((err) => {
          toast.error(err instanceof Error ? err.message : '링크 공유를 설정하지 못했어요');
        });
      },
      onCopy: () => {
        if (!share) return;
        if (navigator.clipboard) {
          void navigator.clipboard.writeText(linkShareUrl(share)).catch(() => undefined);
        }
        toast.success('링크를 복사했어요');
      },
      onDisable: () => {
        void api(`/files/links/${target.type}/${target.id}`, { method: 'DELETE' })
          .then(() => {
            setLinkShares((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            toast.success('링크 공유를 껐어요');
          })
          .catch((err) => {
            toast.error(err instanceof Error ? err.message : '링크 공유를 끄지 못했어요');
          });
      },
    };
  };

  const deleteContextTarget = (target: ContextTargetState) => {
    setContextMenu(null);

    if (target.type === 'space') {
      const space = spaces.find((s) => s.id === target.id);
      if (!space) return;
      if (!space.canDelete) {
        toast('기본 공간은 삭제할 수 없어요.');
        return;
      }
      if (!window.confirm(`${space.name} 공간을 휴지통으로 이동할까요? 안의 폴더와 파일도 함께 이동됩니다.`)) return;
      moveTargetsToTrash([target]);
      return;
    }

    if (target.type === 'file') {
      const file = items.find((item) => item.id === target.id && item.type === 'file');
      if (!file) return;
      if (!window.confirm(`${file.name} 파일을 휴지통으로 이동할까요?`)) return;
      moveTargetsToTrash([target]);
      return;
    }

    const folder = items.find((item) => item.id === target.id && item.type === 'folder');
    if (!folder) return;
    if (!window.confirm(`${folder.name} 폴더를 휴지통으로 이동할까요? 안의 폴더와 파일도 함께 이동됩니다.`)) return;
    moveTargetsToTrash([target]);
  };

  const totalFileUploads = fileUploads.length;
  const doneFileUploads = fileUploads.filter((entry) => entry.done).length;
  const canceledFileUploads = fileUploads.filter((entry) => entry.canceled).length;
  const failedFileUploads = fileUploads.filter((entry) => entry.err && !entry.canceled).length;
  const activeFileUploads = fileUploads.filter((entry) => !entry.done && !entry.err && !entry.canceled).length;
  const allFileUploadsFinished = totalFileUploads > 0 && activeFileUploads === 0;
  const fileUploadSummary = allFileUploadsFinished
    ? failedFileUploads === 0 && canceledFileUploads === 0
      ? '업로드 완료'
      : [
          doneFileUploads > 0 ? `${doneFileUploads} 완료` : null,
          failedFileUploads > 0 ? `${failedFileUploads} 실패` : null,
          canceledFileUploads > 0 ? `${canceledFileUploads} 중단` : null,
        ].filter(Boolean).join(' · ')
    : `${doneFileUploads}/${totalFileUploads} 업로드 중`;

  return (
    <div className="page-enter files-page">
      <div className="fileshare-shell">
        <header className="fileshare-topbar">
          <div className="fileshare-path-row">
            <div className="fileshare-back-slot">
              <button
                type="button"
                className="fileshare-back-btn"
                onClick={openParent}
                disabled={!(activeSpace || currentFolder)}
                aria-label={activeSpace || currentFolder ? '이전 위치로 이동' : '이전 위치 없음'}
              >
                <Icon name="chevronLeft" size={19} />
              </button>
            </div>
            <nav className="fileshare-breadcrumb" aria-label="파일 위치">
              <button
                type="button"
                className={`fileshare-crumb ${activeSpace || currentFolder ? '' : 'is-current'}`}
                onClick={() => selectSpace(null)}
              >
                내 파일
              </button>
              {activeSpace && (
                <>
                  <span className="fileshare-crumb-separator">›</span>
                  <button
                    type="button"
                    className={`fileshare-crumb ${folderPath.length > 0 ? '' : 'is-current'}`}
                    onClick={openSpaceRoot}
                  >
                    <span
                      className="fileshare-crumb-folder"
                      style={{ background: folderTheme(activeSpace.color).body }}
                      aria-hidden
                    />
                    {activeSpace.name}
                  </button>
                </>
              )}
              {folderPath.map((folder, index) => {
                const isLast = index === folderPath.length - 1;
                return (
                  <Fragment key={folder.id}>
                  <span className="fileshare-crumb-separator">›</span>
                    {isLast ? (
                      <span className="fileshare-crumb is-current">
                        <span
                          className="fileshare-crumb-folder"
                          style={{ background: folderTheme(folder.color ?? activeSpace?.color).body }}
                          aria-hidden
                        />
                        {folder.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="fileshare-crumb"
                        onClick={() => openFolder(folder.id)}
                      >
                        <span
                          className="fileshare-crumb-folder"
                          style={{ background: folderTheme(folder.color ?? activeSpace?.color).body }}
                          aria-hidden
                        />
                        {folder.name}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </nav>
          </div>

          <div className="fileshare-actions">
            <label className="fileshare-search">
              <Icon name="search" size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="파일, 폴더 검색"
              />
            </label>
            {canOpenCurrentSettings && (
              <button type="button" className="fileshare-toolbar-btn" onClick={openShareSettings}>
                <Icon name="settings" size={15} />
                설정
              </button>
            )}
            <button type="button" className="fileshare-toolbar-btn" onClick={() => setTrashOpen(true)}>
              <Icon name="trash" size={15} />
              휴지통
              {trashedItemCount > 0 && <span className="fileshare-toolbar-count">{trashedItemCount}</span>}
            </button>
            <button
              type="button"
              className="fileshare-toolbar-btn"
              onClick={openFolderCreate}
            >
              <Icon name="folder" size={15} />
              {createActionLabel}
            </button>
            <button
              type="button"
              className={`fileshare-upload-btn ${canUploadInCurrent ? '' : 'is-disabled'}`}
              onClick={openUploadPicker}
              aria-disabled={!canUploadInCurrent}
            >
              <Icon name="upload" size={15} />
              업로드
            </button>
            <input
              ref={fileInputRef}
              className="fileshare-hidden-input"
              type="file"
              multiple
              onChange={(e) => {
                handlePickedFiles(Array.from(e.currentTarget.files ?? []));
                e.currentTarget.value = '';
              }}
            />
          </div>
        </header>

        <main
          className={`fileshare-content ${selectedTargets.length > 0 ? 'has-selection-toolbar' : ''} ${contentLoading ? 'is-loading' : ''}`}
          aria-busy={contentLoading}
          onContextMenu={openBlankContextMenu}
          onPointerDown={handleSelectionPointerDown}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(canUploadInCurrent);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={handleDrop}
        >
          <section className="fileshare-section">
            <div className="fileshare-section-head">
              <div className="fileshare-section-title">
                <h2>{sectionTitle}</h2>
                <span>{cardCount}개</span>
              </div>
              <div className="fileshare-section-tools">
                {activeSpace && (
                  <ShareStatus
                    label={currentShareLabel}
                    avatars={currentShareAvatars}
                    shared={activeSpace.kind !== 'personal'}
                  />
                )}
                <label className="fileshare-sort-control">
                  <Icon name="sort" size={14} />
                  <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                    {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                      <option key={mode} value={mode}>{SORT_LABELS[mode]}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {contentLoading ? (
              <FilesLoadingState kind={isRoot ? 'spaces' : 'items'} />
            ) : cardCount > 0 && (
              <div className="fileshare-item-grid fileshare-content-enter">
                {isRoot
                  ? visibleSpaces.map((space) => (
                    <FolderTile
                      key={space.id}
                      name={space.name}
                      description={`${spaceStats(items, space.id).fileCount}개 · ${space.description}`}
                      color={space.color}
                      shared={space.kind !== 'personal'}
                      onOpen={() => selectSpace(space.id)}
                      onContextMenu={(e) => openContextMenu(e, { type: 'space', id: space.id })}
                    />
                  ))
                  : visibleItems.map((item) => (
                    item.type === 'folder' ? (
                      <FolderTile
                        key={item.id}
                        name={item.name}
                        description={`파일 ${countFilesIn(items, item.spaceId, item.id)}개`}
                        color={item.color ?? activeSpace?.color}
                        shared={false}
                        selectableKey={targetKey({ type: 'folder', id: item.id })}
                        selected={selectedKeys.has(targetKey({ type: 'folder', id: item.id }))}
                        selectionActive={selectedKeys.size > 0}
                        onOpen={() => openFolder(item.id)}
                        onSelect={() => toggleSelection({ type: 'folder', id: item.id })}
                        onContextMenu={(e) => openContextMenu(e, { type: 'folder', id: item.id })}
                      />
                    ) : (
                      <FileTile
                        key={item.id}
                        item={item}
                        space={activeSpace ?? undefined}
                        groups={groups.data ?? []}
                        friends={acceptedFriends}
                        selectableKey={targetKey({ type: 'file', id: item.id })}
                        selected={selectedKeys.has(targetKey({ type: 'file', id: item.id }))}
                        selectionActive={selectedKeys.size > 0}
                        onOpen={() => openFilePreview(item.id)}
                        onSelect={() => toggleSelection({ type: 'file', id: item.id })}
                        onContextMenu={(e) => openContextMenu(e, { type: 'file', id: item.id })}
                      />
                    )
                  ))}
              </div>
            )}
          </section>

          {!contentLoading && cardCount === 0 && (
            <div className="fileshare-empty fileshare-content-enter">
              <FolderThumb color={activeSpace?.color ?? currentFolder?.color ?? '#D6D6D9'} />
              <div>{normalizedQuery ? '검색 결과가 없어요' : '폴더가 비어 있어요'}</div>
              <p>
                {isRoot
                  ? '내 보관함이나 그룹을 선택하면 파일을 확인하고 업로드할 수 있어요.'
                  : '파일을 여기로 끌어다 놓거나 업로드를 눌러 문서를 추가하세요.'}
              </p>
            </div>
          )}

          {dragging && (
            <div className="fileshare-drag-overlay" aria-hidden>
              <div>여기에 놓아 업로드</div>
            </div>
          )}

          {selectionBox && <SelectionBoxOverlay box={selectionBox} />}
        </main>

        {selectedTargets.length > 0 && (
          <SelectionToolbar
            count={selectedTargets.length}
            canPaste={Boolean(clipboard && activeSpace)}
            clipboardMode={clipboard?.mode}
            onCopy={() => copyTargetsToClipboard('copy')}
            onMove={() => copyTargetsToClipboard('move')}
            onPaste={pasteClipboard}
            onDelete={() => moveTargetsToTrash(selectedTargets)}
            onClear={clearSelection}
          />
        )}
      </div>

      {createModalMode && (
        <FolderCreateModal
          mode={createModalMode}
          groups={groups.data ?? []}
          friends={acceptedFriends}
          groupsLoading={groups.isLoading}
          friendsLoading={friends.isLoading}
          onClose={() => setCreateModalMode(null)}
          onSubmit={(name, sharing) => {
            if (createModalMode === 'space') {
              handleCreateSpace(name, sharing);
              return;
            }
            handleCreateFolder(name);
          }}
        />
      )}

      {settingsModalTarget && (
        <FileSettingsModal
          target={settingsModalTarget}
          groups={groups.data ?? []}
          friends={acceptedFriends}
          linkControls={linkControlsFor(settingsTarget!)}
          onColorChange={(color) => updateTargetColor(settingsTarget!, color)}
          onDelete={() => deleteContextTarget(settingsTarget!)}
          onClose={() => setSettingsTarget(null)}
        />
      )}

      {linkShareTarget && linkShareModalTarget && (
        <LinkShareModal
          target={linkShareModalTarget}
          linkControls={linkControlsFor(linkShareTarget)}
          onClose={() => setLinkShareTarget(null)}
        />
      )}

      {renameTarget && renameModalTarget && (
        <RenameModal
          target={renameModalTarget}
          onSubmit={(name) => renameContextTarget(renameTarget, name)}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {infoModalTarget && (
        <FileInfoModal
          target={infoModalTarget}
          onClose={() => setInfoTarget(null)}
        />
      )}

      {previewFile && (
        <FilePreviewModal
          item={previewFile}
          onClose={() => setPreviewTargetId(null)}
          onDownload={() => window.open(uploadApiUrl(`/files/nodes/${previewFile.id}/download`), '_blank', 'noopener,noreferrer')}
        />
      )}

      {trashOpen && (
        <TrashModal
          spaces={spaces}
          trashedSpaces={trashedSpaces}
          items={items}
          onRestore={restoreTrashTarget}
          onDeletePermanently={permanentlyDeleteTrashTarget}
          onClose={() => setTrashOpen(false)}
        />
      )}

      {contextMenu && contextMenuMeta && (
        <FilesContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetName={contextMenuMeta.name}
          targetType={contextMenuMeta.targetType}
          count={contextMenuMeta.count}
          settingsLabel={contextMenuMeta.settingsLabel}
          canDelete={contextMenuMeta.canDelete}
          canCopyMove={contextMenuMeta.canCopyMove}
          onOpen={() => openContextTarget(contextMenu.target)}
          onDownload={() => downloadContextTarget(contextMenu.target)}
          onRename={() => openContextRename(contextMenu.target)}
          onCopy={() => copyTargetsToClipboard('copy', contextMenu.targets)}
          onMove={() => copyTargetsToClipboard('move', contextMenu.targets)}
          onLinkShare={() => openContextLinkShare(contextMenu.target)}
          onSettings={() => openContextSettings(contextMenu.target)}
          onInfo={() => openContextInfo(contextMenu.target)}
          onDelete={() => {
            if (contextMenu.targets.length > 1) {
              setContextMenu(null);
              moveTargetsToTrash(contextMenu.targets);
              return;
            }
            deleteContextTarget(contextMenu.target);
          }}
        />
      )}

      {blankContextMenu && (
        <FilesBlankContextMenu
          x={blankContextMenu.x}
          y={blankContextMenu.y}
          isRoot={isRoot}
          canPaste={Boolean(clipboard && activeSpace)}
          canUpload={canUploadInCurrent}
          clipboardMode={clipboard?.mode}
          onCreate={() => {
            setBlankContextMenu(null);
            openFolderCreate();
          }}
          onUpload={() => {
            setBlankContextMenu(null);
            openUploadPicker();
          }}
          onPaste={() => {
            setBlankContextMenu(null);
            pasteClipboard();
          }}
          onTrash={() => {
            setBlankContextMenu(null);
            setTrashOpen(true);
          }}
        />
      )}

      {totalFileUploads > 0 && (
        <FileUploadProgressPanel
          uploads={fileUploads}
          summary={fileUploadSummary}
          minimized={fileUploadMin}
          allFinished={allFileUploadsFinished}
          activeCount={activeFileUploads}
          onToggleMinimized={() => setFileUploadMin((minimized) => !minimized)}
          onCancel={cancelFileUpload}
          onCancelAll={() => {
            fileUploads.forEach((entry) => {
              if (!entry.done && !entry.err && !entry.canceled) cancelFileUpload(entry.id);
            });
          }}
          onClose={() => setFileUploads([])}
        />
      )}
    </div>
  );
}

function FolderTile({
  name,
  description,
  color,
  shared,
  selectableKey,
  selected = false,
  selectionActive = false,
  onOpen,
  onSelect,
  onContextMenu,
}: {
  name: string;
  description: string;
  color?: string;
  shared?: boolean;
  selectableKey?: string;
  selected?: boolean;
  selectionActive?: boolean;
  onOpen: () => void;
  onSelect?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const activate = (e?: React.MouseEvent) => {
    if (selectionActive || selected || e?.metaKey || e?.ctrlKey || e?.shiftKey) {
      onSelect?.();
      return;
    }
    onOpen();
  };

  return (
    <div
      className={`fileshare-folder-tile fileshare-selectable ${selected ? 'is-selected' : ''}`}
      data-select-key={selectableKey}
      onClick={activate}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => keyboardActivate(e, selectionActive || selected ? () => onSelect?.() : onOpen)}
    >
      {onSelect && (
        <span className="fileshare-select-check" aria-hidden>
          {selected && <Icon name="check" size={12} stroke={2.4} />}
        </span>
      )}
      <FolderThumb color={color} shared={shared} />
      <div className="fileshare-folder-meta">
        <span>{name}</span>
        <small>{description}</small>
      </div>
    </div>
  );
}

function FileUploadProgressPanel({
  uploads,
  summary,
  minimized,
  allFinished,
  activeCount,
  onToggleMinimized,
  onCancel,
  onCancelAll,
  onClose,
}: {
  uploads: FileUploadEntry[];
  summary: string;
  minimized: boolean;
  allFinished: boolean;
  activeCount: number;
  onToggleMinimized: () => void;
  onCancel: (id: number) => void;
  onCancelAll: () => void;
  onClose: () => void;
}) {
  return (
    <FixedPortal>
      <div className="fileshare-upload-progress" role="status" aria-live="polite">
        <div className="fileshare-upload-progress-card">
          <div className="fileshare-upload-progress-head">
            <div>
              <strong>{summary}</strong>
              <span>{uploads.length}개 파일</span>
            </div>
            <div className="fileshare-upload-progress-actions">
              {activeCount > 0 && (
                <button type="button" onClick={onCancelAll} aria-label="업로드 모두 중단" title="업로드 모두 중단">
                  <Icon name="x" size={13} />
                </button>
              )}
              <button type="button" onClick={onToggleMinimized} aria-label={minimized ? '업로드 목록 펼치기' : '업로드 목록 접기'}>
                <Icon name={minimized ? 'chevronUp' : 'chevronDown'} size={14} />
              </button>
              {allFinished && (
                <button type="button" onClick={onClose} aria-label="업로드 창 닫기">
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>
          </div>

          {!minimized && (
            <div className="fileshare-upload-progress-list">
              {uploads.map((upload) => {
                const status = upload.err
                  ? upload.err
                  : upload.canceled
                    ? '중단됨'
                    : upload.done
                      ? '완료'
                      : `${upload.pct.toFixed(0)}%`;
                return (
                  <div key={upload.id} className="fileshare-upload-progress-row">
                    <div className="fileshare-upload-progress-meta">
                      <span>{upload.name}</span>
                      <small>{formatSize(upload.size)}</small>
                    </div>
                    <div className="fileshare-upload-progress-state">
                      <span className={upload.err ? 'is-error' : upload.done ? 'is-done' : upload.canceled ? 'is-muted' : ''}>
                        {status}
                      </span>
                      {!upload.done && !upload.err && !upload.canceled && (
                        <button
                          type="button"
                          onClick={() => onCancel(upload.id)}
                          aria-label={`${upload.name} 업로드 중단`}
                          title="업로드 중단"
                        >
                          <Icon name="x" size={12} />
                        </button>
                      )}
                    </div>
                    {!upload.done && !upload.err && !upload.canceled && (
                      <div className="fileshare-upload-progress-bar" aria-hidden>
                        <span style={{ width: `${upload.pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </FixedPortal>
  );
}

function FilesContextMenu({
  x,
  y,
  targetName,
  targetType,
  count,
  settingsLabel,
  canDelete,
  canCopyMove,
  onOpen,
  onDownload,
  onRename,
  onCopy,
  onMove,
  onLinkShare,
  onSettings,
  onInfo,
  onDelete,
}: {
  x: number;
  y: number;
  targetName: string;
  targetType: ContextTargetState['type'] | 'multi';
  count: number;
  settingsLabel: string;
  canDelete: boolean;
  canCopyMove: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onCopy: () => void;
  onMove: () => void;
  onLinkShare: () => void;
  onSettings: () => void;
  onInfo: () => void;
  onDelete: () => void;
}) {
  const isFile = targetType === 'file';
  const isMulti = targetType === 'multi';

  return createPortal(
    <div
      className="fileshare-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label={`${targetName} 메뉴`}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isMulti && (
        <div className="fileshare-context-title">{count}개 선택됨</div>
      )}
      {!isMulti && (
        <>
          <button type="button" role="menuitem" onClick={onOpen}>
            <Icon name={isFile ? 'eye' : 'folder'} size={15} />
            {isFile ? '미리보기' : '열기'}
          </button>
          {isFile && (
            <button type="button" role="menuitem" onClick={onDownload}>
              <Icon name="download" size={15} />
              다운로드
            </button>
          )}
          <button type="button" role="menuitem" onClick={onRename}>
            <Icon name="pencil" size={15} />
            이름 바꾸기
          </button>
        </>
      )}
      {canCopyMove && (
        <>
          <button type="button" role="menuitem" onClick={onCopy}>
            <Icon name="copy" size={15} />
            복사
          </button>
          <button type="button" role="menuitem" onClick={onMove}>
            <Icon name="drag" size={15} />
            이동 준비
          </button>
        </>
      )}
      {!isMulti && (
        <>
          <button type="button" role="menuitem" onClick={onInfo}>
            <Icon name="info" size={15} />
            정보 가져오기
          </button>
          <button type="button" role="menuitem" onClick={onLinkShare}>
            <Icon name="share" size={15} />
            링크 공유
          </button>
          <div className="fileshare-context-divider" />
          <button type="button" role="menuitem" onClick={onSettings}>
            <Icon name="settings" size={15} />
            {settingsLabel}
          </button>
        </>
      )}
      <div className="fileshare-context-divider" />
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        disabled={!canDelete}
        onClick={onDelete}
      >
        <Icon name="trash" size={15} />
        삭제
      </button>
    </div>,
    document.body,
  );
}

function FilesBlankContextMenu({
  x,
  y,
  isRoot,
  canPaste,
  canUpload,
  clipboardMode,
  onCreate,
  onUpload,
  onPaste,
  onTrash,
}: {
  x: number;
  y: number;
  isRoot: boolean;
  canPaste: boolean;
  canUpload: boolean;
  clipboardMode?: ClipboardMode;
  onCreate: () => void;
  onUpload: () => void;
  onPaste: () => void;
  onTrash: () => void;
}) {
  return createPortal(
    <div
      className="fileshare-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label="파일함 메뉴"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={onCreate}>
        <Icon name="folder" size={15} />
        {isRoot ? '새 공간' : '새 폴더'}
      </button>
      {!isRoot && (
        <button type="button" role="menuitem" disabled={!canUpload} onClick={onUpload}>
          <Icon name="upload" size={15} />
          업로드
        </button>
      )}
      {!isRoot && (
        <button type="button" role="menuitem" disabled={!canPaste} onClick={onPaste}>
          <Icon name="copy" size={15} />
          {clipboardMode === 'move' ? '이동해서 붙여넣기' : '붙여넣기'}
        </button>
      )}
      <div className="fileshare-context-divider" />
      <button type="button" role="menuitem" onClick={onTrash}>
        <Icon name="trash" size={15} />
        휴지통 열기
      </button>
    </div>,
    document.body,
  );
}

function SelectionBoxOverlay({ box }: { box: SelectionBoxState }) {
  return createPortal(
    <div
      className="fileshare-selection-box"
      style={{
        left: Math.min(box.startX, box.x),
        top: Math.min(box.startY, box.y),
        width: Math.abs(box.x - box.startX),
        height: Math.abs(box.y - box.startY),
      }}
      aria-hidden
    />,
    document.body,
  );
}

function ShareStatus({
  label,
  avatars,
  shared,
}: {
  label: string;
  avatars: ShareAvatar[];
  shared: boolean;
}) {
  return (
    <div className={`fileshare-share-status ${shared ? 'is-shared' : ''}`}>
      <Icon name={shared ? 'users' : 'lock'} size={14} />
      <span>{label}</span>
      {shared && avatars.length > 0 && (
        <div className="fileshare-avatar-stack" aria-label={`${avatars.length}명과 공유 중`}>
          {avatars.slice(0, 4).map((avatar) => (
            <span key={avatar.id} style={{ background: avatar.color }} title={avatar.name}>
              {avatar.name.slice(0, 1)}
            </span>
          ))}
          {avatars.length > 4 && <em>+{avatars.length - 4}</em>}
        </div>
      )}
    </div>
  );
}

function SelectionToolbar({
  count,
  canPaste,
  clipboardMode,
  onCopy,
  onMove,
  onPaste,
  onDelete,
  onClear,
}: {
  count: number;
  canPaste: boolean;
  clipboardMode?: ClipboardMode;
  onCopy: () => void;
  onMove: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="fileshare-selection-toolbar">
      <strong>{count}개 선택됨</strong>
      <div>
        <button type="button" onClick={onCopy}>
          <Icon name="copy" size={14} />
          복사
        </button>
        <button type="button" onClick={onMove}>
          <Icon name="drag" size={14} />
          이동
        </button>
        <button type="button" disabled={!canPaste} onClick={onPaste}>
          <Icon name="copy" size={14} />
          {clipboardMode === 'move' ? '이동 붙여넣기' : '붙여넣기'}
        </button>
        <button type="button" className="is-danger" onClick={onDelete}>
          <Icon name="trash" size={14} />
          삭제
        </button>
        <button type="button" onClick={onClear}>
          <Icon name="x" size={14} />
          해제
        </button>
      </div>
    </div>
  );
}

function FilesLoadingState({ kind }: { kind: 'spaces' | 'items' }) {
  const label = kind === 'spaces' ? '공간을 불러오는 중' : '항목을 불러오는 중';

  return (
    <div
      className="fileshare-loading-state"
      role="status"
      aria-label={label}
    >
      <div className="fileshare-loading-indicator">
        <span className="fileshare-loading-ring" aria-hidden />
        <span className="fileshare-loading-label">{label}</span>
        <span className="fileshare-loading-bar" aria-hidden>
          <span />
        </span>
      </div>
    </div>
  );
}

function TrashModal({
  spaces,
  trashedSpaces,
  items,
  onRestore,
  onDeletePermanently,
  onClose,
}: {
  spaces: Space[];
  trashedSpaces: Space[];
  items: LibraryItem[];
  onRestore: (target: ContextTargetState) => void;
  onDeletePermanently: (target: ContextTargetState) => void;
  onClose: () => void;
}) {
  const trashedSpaceIds = new Set(trashedSpaces.map((space) => space.id));
  const trashedItems = items.filter((item) => item.trashedAt && !trashedSpaceIds.has(item.spaceId));
  const rows = [
    ...trashedSpaces.map((space) => ({
      key: targetKey({ type: 'space', id: space.id }),
      target: { type: 'space' as const, id: space.id },
      name: space.name,
      meta: space.description,
      color: space.color,
      deleteAfter: space.deleteAfter,
      itemType: 'space' as const,
    })),
    ...trashedItems.map((item) => ({
      key: targetKey({ type: item.type, id: item.id }),
      target: { type: item.type, id: item.id },
      name: item.name,
      meta: item.type === 'file'
        ? `${KIND_LABEL[fileKind(item)]} · ${formatSize(item.size)}`
        : `폴더 · ${spaces.find((space) => space.id === item.spaceId)?.name ?? '파일함'}`,
      color: item.type === 'folder' ? item.color : KIND_COLORS[fileKind(item)],
      deleteAfter: item.deleteAfter,
      itemType: item.type,
    })),
  ];

  return (
    <ModalShell title="휴지통" onClose={onClose}>
      <div className="files-trash-modal">
        <div className="files-trash-note">
          <Icon name="clock" size={15} />
          <span>휴지통의 항목은 30일 후 자동 삭제돼요.</span>
        </div>
        {rows.length === 0 ? (
          <div className="files-trash-empty">휴지통이 비어 있어요</div>
        ) : (
          <div className="files-trash-list">
            {rows.map((row) => (
              <div key={row.key} className="files-trash-row">
                {row.itemType === 'file' ? (
                  <span className="files-info-file-badge" style={{ background: row.color }}>
                    파일
                  </span>
                ) : (
                  <FolderThumb color={row.color} small shared={row.itemType === 'space'} />
                )}
                <div>
                  <strong>{row.name}</strong>
                  <small>{row.meta}</small>
                  <small>{row.deleteAfter ? `${formatDateTime(row.deleteAfter)} 자동 삭제` : '30일 후 자동 삭제'}</small>
                </div>
                <div className="files-trash-actions">
                  <button type="button" onClick={() => onRestore(row.target)}>복원</button>
                  <button type="button" className="is-danger" onClick={() => onDeletePermanently(row.target)}>영구 삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function FolderThumb({
  color,
  shared = false,
  small = false,
}: {
  color?: string;
  shared?: boolean;
  small?: boolean;
}) {
  const theme = folderTheme(color);
  return (
    <div className={`fileshare-folder-thumb ${small ? 'is-small' : ''}`}>
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
      {shared && (
        <div className="fileshare-shared-badge" aria-hidden>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={theme.tab}>
            <circle cx="9" cy="8.5" r="3.4" />
            <path d="M3.2 18.4c0-3 2.6-5 5.8-5s5.8 2 5.8 5c0 .9-.7 1.6-1.6 1.6H4.8c-.9 0-1.6-.7-1.6-1.6z" />
            <circle cx="16.6" cy="9" r="2.7" opacity=".55" />
            <path d="M16.2 13.6c2.7.1 4.8 1.9 4.8 4.4 0 .8-.6 1.4-1.4 1.4h-2.9c.3-.5.5-1 .5-1.6 0-1.7-.7-3.1-1.9-4.1.3 0 .6-.1.9-.1z" opacity=".55" />
          </svg>
        </div>
      )}
    </div>
  );
}

function FileInfoModal({
  target,
  onClose,
}: {
  target: InfoModalTarget;
  onClose: () => void;
}) {
  return (
    <ModalShell title="정보 가져오기" onClose={onClose}>
      <div className="files-info-panel">
        <div className="files-info-head">
          {target.type === 'file' ? (
            <span
              className="files-info-file-badge"
              style={{ background: target.color ?? KIND_COLORS.other }}
            >
              {KIND_LABEL[target.fileKind ?? 'other']}
            </span>
          ) : (
            <FolderThumb color={target.color} shared={target.shared} small />
          )}
          <div>
            <h4>{target.name}</h4>
            <p>{target.subtitle}</p>
          </div>
        </div>

        <div className="files-info-list">
          {target.rows.map((row) => (
            <div key={row.label} className="files-info-row">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

function FilePreviewModal({
  item,
  onClose,
  onDownload,
}: {
  item: LibraryItem;
  onClose: () => void;
  onDownload: () => void;
}) {
  const kind = fileKind(item);
  const previewUrl = uploadApiUrl(`/files/nodes/${item.id}/preview`);
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

    fetch(previewUrl, {
      credentials: 'include',
      signal: controller.signal,
      headers: { Accept: 'application/pdf' },
    })
      .then(async (res) => {
        if (!res.ok) {
          let message = '미리보기를 불러오지 못했어요';
          try {
            const body = await res.json();
            message = body.error || body.message || message;
          } catch {
            // Non-JSON error body.
          }
          throw new Error(message);
        }
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
  }, [previewUrl, usesPdfPreview]);

  useEffect(() => {
    if (!usesTextPreview) return undefined;

    const controller = new AbortController();
    setTextPreview(null);
    setTextPreviewError(null);

    fetch(previewUrl, {
      credentials: 'include',
      signal: controller.signal,
      headers: { Accept: 'text/plain, text/*;q=0.9, */*;q=0.1' },
    })
      .then(async (res) => {
        if (!res.ok) {
          let message = '텍스트 미리보기를 불러오지 못했어요';
          try {
            const body = await res.json();
            message = body.error || body.message || message;
          } catch {
            // Non-JSON error body.
          }
          throw new Error(message);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (controller.signal.aborted) return;
        const decoded = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
        setTextPreview(decoded);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setTextPreviewError(err instanceof Error ? err.message : '텍스트 미리보기를 불러오지 못했어요');
      });

    return () => controller.abort();
  }, [previewUrl, usesTextPreview]);

  return (
    <ModalShell
      title={item.name}
      onClose={onClose}
      size="wide"
      className="files-preview-shell"
      backdropClassName="files-preview-backdrop"
    >
      <div className="files-preview-modal">
        <div className={`files-preview-stage is-${usesTextPreview ? 'text' : usesPdfPreview ? 'pdf' : canPreview ? kind : 'unsupported'}`}>
          {kind === 'image' && (
            <img src={previewUrl} alt={item.name} />
          )}
          {kind === 'video' && (
            <video src={previewUrl} controls playsInline preload="metadata" />
          )}
          {usesTextPreview && textPreview !== null && (
            <pre className="files-preview-text">{textPreview}</pre>
          )}
          {usesTextPreview && textPreview === null && !textPreviewError && (
            <div className="files-preview-loading">
              <span className="fileshare-loading-ring" aria-hidden />
              <strong>텍스트를 불러오고 있어요</strong>
              <span>원문 그대로 미리보기를 준비하는 중이에요.</span>
            </div>
          )}
          {usesTextPreview && textPreviewError && (
            <div className="files-preview-error">
              <Icon name="fileText" size={26} />
              <strong>텍스트를 열지 못했어요</strong>
              <span>{textPreviewError}</span>
            </div>
          )}
          {usesPdfPreview && pdfPreviewUrl && (
            <PdfCanvasPreview title={item.name} fileUrl={pdfPreviewUrl} />
          )}
          {usesPdfPreview && !pdfPreviewUrl && !pdfPreviewError && (
            <div className="files-preview-loading">
              <span className="fileshare-loading-ring" aria-hidden />
              <strong>미리보기를 준비하고 있어요</strong>
              <span>{KIND_LABEL[kind]} 파일을 화면에 맞게 불러오는 중이에요.</span>
            </div>
          )}
          {usesPdfPreview && pdfPreviewError && (
            <div className="files-preview-error">
              <Icon name="fileText" size={26} />
              <strong>미리보기를 열지 못했어요</strong>
              <span>{pdfPreviewError}</span>
            </div>
          )}
          {!canPreview && (
            <div className="files-preview-unsupported">
              <FilePreview kind={kind} />
              <div>
                <strong>{item.name}</strong>
                <span>{KIND_LABEL[kind]} · {formatSize(item.size)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="files-preview-actions">
          <span>{KIND_LABEL[kind]} · {formatSize(item.size)}</span>
          <button type="button" className="btn btn-secondary" onClick={onDownload}>
            <Icon name="download" size={15} />
            다운로드
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function FileTile({
  item,
  space,
  groups,
  friends,
  selectableKey,
  selected = false,
  selectionActive = false,
  onOpen,
  onSelect,
  onContextMenu,
}: {
  item: LibraryItem;
  space?: Space;
  groups: Group[];
  friends: Friendship[];
  selectableKey?: string;
  selected?: boolean;
  selectionActive?: boolean;
  onOpen?: () => void;
  onSelect?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const kind = fileKind(item);
  const thumbUrl = hasFileThumbnail(item) ? uploadApiUrl(`/files/nodes/${item.id}/thumb`) : undefined;
  const activate = (e?: React.MouseEvent) => {
    if (selectionActive || selected || e?.metaKey || e?.ctrlKey || e?.shiftKey) {
      onSelect?.();
      return;
    }
    onOpen?.();
  };

  return (
    <div
      className={`fileshare-file-tile fileshare-selectable ${selected ? 'is-selected' : ''}`}
      data-select-key={selectableKey}
      onClick={activate}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => keyboardActivate(e, selectionActive || selected ? () => onSelect?.() : () => onOpen?.())}
    >
      {onSelect && (
        <span className="fileshare-select-check" aria-hidden>
          {selected && <Icon name="check" size={12} stroke={2.4} />}
        </span>
      )}
      <FilePreview kind={kind} thumbUrl={thumbUrl} />
      <div className="fileshare-file-meta">
        <span>{item.name}</span>
        <small data-tabular>
          {formatSize(item.size)} · {formatDate(item.updatedAt)} · {shareLabel(item, groups, friends, space)}
        </small>
      </div>
    </div>
  );
}

function FilePreview({ kind, thumbUrl }: { kind: FileKind; thumbUrl?: string }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const color = KIND_COLORS[kind];
  const label = KIND_LABEL[kind];
  const showThumb = Boolean(thumbUrl && !thumbFailed);

  return (
    <div
      className={`fileshare-file-preview is-${kind} ${showThumb ? 'has-thumb' : ''}`}
      style={{ '--file-kind-color': color } as React.CSSProperties}
    >
      {showThumb ? (
        <>
          <img
            className="fileshare-file-thumb-img"
            src={thumbUrl}
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

function shareLabel(item: LibraryItem, groups: Group[], friends: Friendship[], space?: Space) {
  const groupNames = item.groupIds
    .map((id) => groups.find((g) => g.id === id)?.name)
    .filter(Boolean) as string[];
  const friendNames = item.friendIds
    .map((id) => friends.find((f) => f.user.id === id)?.user.displayName)
    .filter(Boolean) as string[];

  if (groupNames.length === 0 && friendNames.length === 0) {
    if (space?.kind === 'group') return '그룹 공유';
    if (space?.kind === 'shared') return space.description || '공유 공간';
    return '나만 보기';
  }
  if (groupNames.length === 1 && friendNames.length === 0) return groupNames[0];
  if (groupNames.length === 0 && friendNames.length === 1) return friendNames[0];
  return `그룹 ${groupNames.length}개 · 친구 ${friendNames.length}명`;
}

function shareSelectionLabel(selection: ShareSelection, groups: Group[], friends: Friendship[]) {
  const groupNames = selection.groupIds
    .map((id) => groups.find((g) => g.id === id)?.name)
    .filter(Boolean) as string[];
  const friendNames = selection.friendIds
    .map((id) => friends.find((f) => f.user.id === id)?.user.displayName)
    .filter(Boolean) as string[];

  if (groupNames.length === 0 && friendNames.length === 0) return '나만 볼 수 있는 파일 공간';
  if (groupNames.length === 1 && friendNames.length === 0) return `${groupNames[0]}와 공유`;
  if (groupNames.length === 0 && friendNames.length === 1) return `${friendNames[0]}님과 공유`;
  return `그룹 ${groupNames.length}개 · 친구 ${friendNames.length}명과 공유`;
}

function buildSpaceShareAvatars(space: Space, groups: Group[], friends: Friendship[]): ShareAvatar[] {
  const avatars = new Map<string, ShareAvatar>();
  const addUser = (user: UserHit) => {
    if (avatars.has(user.id)) return;
    avatars.set(user.id, {
      id: user.id,
      name: user.displayName,
      color: themeAt(user.displayName.length + avatars.size).base,
    });
  };

  if (space.groupId) {
    groups
      .find((group) => group.id === space.groupId)
      ?.members
      .filter((member) => member.status === 'active' && member.user)
      .forEach((member) => addUser(member.user!));
  }

  space.groupIds?.forEach((groupId) => {
    groups
      .find((group) => group.id === groupId)
      ?.members
      .filter((member) => member.status === 'active' && member.user)
      .forEach((member) => addUser(member.user!));
  });

  space.friendIds?.forEach((friendId) => {
    const friend = friends.find((entry) => entry.user.id === friendId);
    if (friend) addUser(friend.user);
  });

  return [...avatars.values()];
}

function FileUploadModal({
  spaces,
  activeSpaceId,
  onClose,
  onSubmit,
}: {
  spaces: Space[];
  activeSpaceId: string;
  onClose: () => void;
  onSubmit: (files: File[], target: ShareTarget) => void;
}) {
  const [spaceId, setSpaceId] = useState(activeSpaceId);
  const [files, setFiles] = useState<File[]>([]);

  const submit = () => {
    if (files.length === 0) return;
    const selectedSpace = spaces.find((space) => space.id === spaceId);
    onSubmit(files, {
      spaceId,
      groupIds: selectedSpace?.kind === 'group' && selectedSpace.groupId
        ? [selectedSpace.groupId]
        : selectedSpace?.groupIds ?? [],
      friendIds: selectedSpace?.friendIds ?? [],
    });
    onClose();
  };

  return (
    <ModalShell title="파일 업로드" onClose={onClose}>
      <div className="files-modal-stack">
        <SpaceSelect
          spaces={spaces}
          value={spaceId}
          onChange={setSpaceId}
        />

        <div>
          <label className="label">파일 선택</label>
          <label className="files-drop-zone">
            <Icon name="upload" size={22} />
            <span>{files.length > 0 ? `${files.length}개 파일 선택됨` : 'PDF, 문서, 이미지 파일을 선택하세요'}</span>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.currentTarget.files ?? []))}
            />
          </label>
          {files.length > 0 && (
            <div className="files-picked-list">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`}>
                  <span>{file.name}</span>
                  <span data-tabular>{formatSize(file.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="files-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" disabled={files.length === 0} onClick={submit}>
            업로드
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function FolderCreateModal({
  mode,
  groups,
  friends,
  groupsLoading,
  friendsLoading,
  onClose,
  onSubmit,
}: {
  mode: 'space' | 'folder';
  groups: Group[];
  friends: Friendship[];
  groupsLoading: boolean;
  friendsLoading: boolean;
  onClose: () => void;
  onSubmit: (name: string, sharing: ShareSelection) => void;
}) {
  const [name, setName] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const isSpace = mode === 'space';

  const submit = () => {
    const title = name.trim();
    if (!title) return;
    onSubmit(title, {
      groupIds: isSpace ? selectedGroupIds : [],
      friendIds: isSpace ? selectedFriendIds : [],
    });
    onClose();
  };

  return (
    <ModalShell title={isSpace ? '공간 만들기' : '폴더 만들기'} onClose={onClose}>
      <div className="files-modal-stack">
        <div>
          <label className="label">{isSpace ? '공간 이름' : '폴더 이름'}</label>
          <input
            className="input"
            placeholder={isSpace ? '예: 집 문서' : '예: 병원 서류'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {isSpace && (
          <>
            <ShareTargetSelector
              groups={groups}
              friends={friends}
              groupsLoading={groupsLoading}
              friendsLoading={friendsLoading}
              selectedGroupIds={selectedGroupIds}
              selectedFriendIds={selectedFriendIds}
              onToggleGroup={(id) =>
                setSelectedGroupIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
              }
              onToggleFriend={(id) =>
                setSelectedFriendIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
              }
            />

            <SensitiveNotice groupCount={selectedGroupIds.length} friendCount={selectedFriendIds.length} />
          </>
        )}

        <div className="files-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={submit}>
            만들기
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function RenameModal({
  target,
  onSubmit,
  onClose,
}: {
  target: {
    id: string;
    type: ContextTargetState['type'];
    name: string;
    label: string;
  };
  onSubmit: (name: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const unchanged = trimmed === target.name;

  const submit = async () => {
    if (!trimmed || saving) return;
    if (unchanged) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="이름 바꾸기" onClose={onClose}>
      <div className="files-modal-stack">
        <div>
          <label className="label">{target.label}</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            autoFocus
          />
        </div>
        <div className="files-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" disabled={!trimmed || saving} onClick={() => void submit()}>
            변경
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function FileSettingsModal({
  target,
  groups,
  friends,
  linkControls,
  onColorChange,
  onDelete,
  onClose,
}: {
  target: SettingsModalTarget;
  groups: Group[];
  friends: Friendship[];
  linkControls: LinkShareControls;
  onColorChange: (color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const members = useMemo(() => buildShareMembers(target, groups, friends), [friends, groups, target]);
  const canChangeColor = target.type !== 'file';
  const canDelete = target.type !== 'space' || target.id.startsWith('space-');

  return createPortal(
    <div className="fileshare-share-backdrop" onClick={onClose}>
      <div className="fileshare-share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fileshare-share-head">
          {target.kind === 'file' ? (
            <span className="files-info-file-badge" style={{ background: target.color }}>
              파일
            </span>
          ) : (
            <FolderThumb color={target.color} small shared={target.shared} />
          )}
          <div>
            <h3>{target.name} 설정</h3>
            <p>{target.subtitle}</p>
          </div>
          <button type="button" className="fileshare-share-close" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="files-setting-stack">
          <section className="files-setting-section">
            <div className="files-setting-title">기본 정보</div>
            <div className="files-setting-row">
              <span>이름</span>
              <strong>{target.name}</strong>
            </div>
            <div className="files-setting-row">
              <span>종류</span>
              <strong>{target.type === 'space' ? '공간' : target.type === 'folder' ? '폴더' : '파일'}</strong>
            </div>
          </section>

          {canChangeColor && (
            <section className="files-setting-section">
              <div className="files-setting-title">색상</div>
              <div className="files-color-grid" role="radiogroup" aria-label="폴더 색상">
                {FOLDER_THEMES.map((theme) => (
                  <button
                    key={theme.base}
                    type="button"
                    className={`files-color-swatch ${target.color === theme.base ? 'is-selected' : ''}`}
                    style={{ background: theme.body }}
                    aria-label={`${theme.base} 색상`}
                    aria-pressed={target.color === theme.base}
                    onClick={() => onColorChange(theme.base)}
                  />
                ))}
              </div>
            </section>
          )}

          {target.type === 'space' && (
            <section className="files-setting-section">
              <div className="files-setting-title">멤버</div>
              <div className="fileshare-member-list">
                {members.map((member) => (
                  <div key={member.id} className="fileshare-member-row">
                    <span className="fileshare-member-avatar" style={{ background: member.color }}>
                      {member.name.slice(0, 1)}
                    </span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.label}</small>
                    </div>
                    <span className="fileshare-owner-label">
                      {member.role === 'owner' ? '소유자' : member.role === 'edit' ? '편집' : '보기'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <LinkShareSection controls={linkControls} />

          <section className="files-setting-section is-danger">
            <div className="files-setting-title">위험 영역</div>
            <button
              type="button"
              className="files-danger-btn"
              disabled={!canDelete}
              onClick={() => {
                onClose();
                onDelete();
              }}
            >
              삭제
            </button>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LinkShareModal({
  target,
  linkControls,
  onClose,
}: {
  target: SettingsModalTarget;
  linkControls: LinkShareControls;
  onClose: () => void;
}) {
  return (
    <ModalShell title="링크 공유" onClose={onClose}>
      <div className="files-modal-stack">
        <div className="files-info-head">
          {target.kind === 'file' ? (
            <span className="files-info-file-badge" style={{ background: target.color }}>
              파일
            </span>
          ) : (
            <FolderThumb color={target.color} small shared={target.shared} />
          )}
          <div>
            <h4>{target.name}</h4>
            <p>{target.subtitle}</p>
          </div>
        </div>
        <LinkShareSection controls={linkControls} />
      </div>
    </ModalShell>
  );
}

function LinkShareSection({ controls }: { controls: LinkShareControls }) {
  const [optionsOpen, setOptionsOpen] = useState(Boolean(controls.share));
  const showOptions = Boolean(controls.share) || optionsOpen;

  useEffect(() => {
    if (controls.share) setOptionsOpen(true);
  }, [controls.share]);

  return (
    <section className="files-setting-section">
      <div className="files-setting-title">링크 공유</div>
      {controls.share && controls.url && (
        <div className="fileshare-link-row">
          <div>{controls.url}</div>
          <button type="button" onClick={controls.onCopy}>복사</button>
        </div>
      )}
      {controls.share && !controls.url && (
        <div className="files-link-help">
          링크 공유가 켜져 있어요. 보안을 위해 기존 링크 주소는 다시 표시하지 않아요.
          새 링크를 만들면 이전 링크가 교체돼요.
        </div>
      )}
      {!showOptions ? (
        <button type="button" className="files-link-primary" onClick={() => setOptionsOpen(true)}>
          링크로 공유하기
        </button>
      ) : (
        <div className="files-link-options">
          {!controls.share && (
            <div className="files-link-help">링크를 받은 사람은 만료일까지 이 항목을 볼 수 있어요.</div>
          )}
          <div className="files-link-expiry-row">
            <label>
              <span>만료일</span>
              <input
                type="date"
                value={controls.expiresDate}
                min={dateInputValue(new Date())}
                onChange={(e) => controls.onExpiresDateChange(e.target.value)}
              />
            </label>
            <button type="button" className="files-link-primary" onClick={controls.onEnable}>
              {controls.share ? (controls.url ? '만료일 저장' : '새 링크 생성') : '링크 생성'}
            </button>
          </div>
        </div>
      )}
      {controls.share && (
        <button type="button" className="files-link-disable" onClick={controls.onDisable}>
          링크 공유 끄기
        </button>
      )}
    </section>
  );
}

function buildShareMembers(target: SettingsModalTarget, groups: Group[], friends: Friendship[]): ShareMember[] {
  const members = new Map<string, ShareMember>();
  const addUser = (user: UserHit, role: ShareMember['role'] = 'edit') => {
    if (members.has(user.id)) return;
    members.set(user.id, {
      id: user.id,
      name: user.displayName,
      label: `${user.displayName}님`,
      color: themeAt(user.displayName.length + members.size).base,
      role,
    });
  };

  members.set('me', {
    id: 'me',
    name: '나',
    label: '소유자',
    color: '#8FA9D6',
    role: 'owner',
  });

  if (target.groupId) {
    const group = groups.find((g) => g.id === target.groupId);
    group?.members
      .filter((member) => member.status === 'active' && member.user)
      .forEach((member) => addUser(member.user!, 'edit'));
  }

  target.groupIds?.forEach((groupId) => {
    const group = groups.find((g) => g.id === groupId);
    group?.members
      .filter((member) => member.status === 'active' && member.user)
      .forEach((member) => addUser(member.user!, 'edit'));
  });

  target.friendIds?.forEach((friendId) => {
    const friend = friends.find((f) => f.user.id === friendId);
    if (friend) addUser(friend.user, 'view');
  });

  return [...members.values()];
}

function ModalShell({
  title,
  children,
  onClose,
  size = 'default',
  className = '',
  backdropClassName = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'default' | 'wide';
  className?: string;
  backdropClassName?: string;
}) {
  return createPortal(
    <div
      className={`fixed left-0 top-0 z-50 flex items-start justify-center bg-black/50 px-3 py-6 sm:items-center sm:p-3 overflow-y-auto animate-fade-in ${backdropClassName}`}
      style={{ width: '100dvw', height: '100dvh' }}
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-elevated w-full overflow-hidden animate-slide-up mt-[min(14dvh,96px)] sm:mt-0 ${size === 'wide' ? 'max-w-5xl' : 'max-w-lg'} ${className}`}
        style={{ maxHeight: 'calc(100dvh - 48px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ink-100">
          <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 121px)' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SpaceSelect({
  spaces,
  value,
  onChange,
}: {
  spaces: Space[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">저장 위치</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ShareTargetSelector({
  groups,
  friends,
  groupsLoading,
  friendsLoading,
  selectedGroupIds,
  selectedFriendIds,
  onToggleGroup,
  onToggleFriend,
}: {
  groups: Group[];
  friends: Friendship[];
  groupsLoading: boolean;
  friendsLoading: boolean;
  selectedGroupIds: string[];
  selectedFriendIds: string[];
  onToggleGroup: (id: string) => void;
  onToggleFriend: (id: string) => void;
}) {
  return (
    <div>
      <div className="label">공유 대상 <span className="text-ink-400 font-normal">(선택)</span></div>
      {groupsLoading || friendsLoading ? (
        <div className="text-xs text-ink-500 mt-2">공유 대상을 불러오는 중…</div>
      ) : (
        <div className="files-share-picker">
          {groups.length > 0 && (
            <div>
              <div className="files-picker-label">그룹</div>
              <div className="files-chip-wrap">
                {groups.map((g) => {
                  const checked = selectedGroupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onToggleGroup(g.id)}
                      className={`btn btn-sm ${checked ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      {g.name} · {activeMemberCount(g)}명
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="files-picker-label">친구 개별 초대</div>
            {friends.length === 0 ? (
              <div className="text-xs text-ink-500 mt-2">
                친구가 없으면 <Link to="/friends" className="text-brand-600 hover:underline">친구</Link>에서 먼저 추가하세요.
              </div>
            ) : (
              <div className="files-chip-wrap">
                {friends.map((f) => {
                  const selected = selectedFriendIds.includes(f.user.id);
                  return (
                    <button
                      key={f.user.id}
                      type="button"
                      className={`files-friend-chip ${selected ? 'is-selected' : ''}`}
                      onClick={() => onToggleFriend(f.user.id)}
                    >
                      <Avatar user={f.user} size={24} />
                      <span>{f.user.displayName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SensitiveNotice({
  groupCount,
  friendCount,
}: {
  groupCount: number;
  friendCount: number;
}) {
  const privateOnly = groupCount === 0 && friendCount === 0;
  return (
    <div className="files-sensitive-note">
      <Icon name={privateOnly ? 'lock' : 'share'} size={15} />
      <span>
        {privateOnly
          ? '공유 대상을 선택하지 않으면 나만 볼 수 있어요.'
          : `선택됨: 그룹 ${groupCount}개 · 친구 ${friendCount}명`}
      </span>
    </div>
  );
}
