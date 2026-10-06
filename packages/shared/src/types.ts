// 서버와 웹이 함께 쓰는 API 타입.
// Prisma 모델이 추가되면 여기서 `Pick`/`Omit`으로 응답 DTO를 정의한다.

export type UserStatus = 'pending' | 'active' | 'disabled';

export interface UserPublic {
  id: string;
  handle: string;
  displayName: string;
}

export interface MeResponse extends UserPublic {
  email: string;
  isAdmin: boolean;
}

export type SortKey = 'taken_at' | 'uploaded_at';
export type SortDir = 'asc' | 'desc';

export interface ProjectCard {
  id: string;
  title: string;
  coverUrl: string | null;
  mediaCount: number;
  createdAt: string;
}

export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  filename: string;
  uploaderId: string;
  uploaderHandle: string;
  takenAt: string | null;
  uploadedAt: string;
  durationSec?: number;
}
