import { Link } from 'react-router-dom';
import Avatar from './ui/Avatar';
import Icon from './ui/Icon';

interface Member {
  userId: string;
  user: { id: string; displayName: string };
}

interface AlbumHeaderProps {
  projectId: string;
  title: string;
  coverMediaId: string | null;
  firstMediaId: string | null;
  location: string | null;
  tripStartDate: string | null;
  tripEndDate: string | null;
  bannerType: 'auto' | 'solid' | 'photo';
  bannerColor: string | null;
  bannerPhotoId: string | null;
  members: Member[];
  mediaCount: number;
  isOwner: boolean;
  onUploadClick: () => void;
  onHistoryClick: () => void;
}

export default function AlbumHeader({
  projectId,
  title,
  coverMediaId,
  firstMediaId,
  location,
  tripStartDate,
  tripEndDate,
  bannerType,
  bannerColor,
  bannerPhotoId,
  members,
  mediaCount,
  isOwner,
  onUploadClick,
  onHistoryClick,
}: AlbumHeaderProps) {
  // 커버 썸네일 (좌하단 1:1)
  const coverId = coverMediaId ?? firstMediaId;
  const coverUrl = coverId ? `/api/media/${coverId}/thumb?size=lg` : null;
  const dateRange = formatDateRange(tripStartDate, tripEndDate);
  // 배너 배경 결정
  const bannerBgImageUrl =
    bannerType === 'photo' && bannerPhotoId
      ? `/api/media/${bannerPhotoId}/thumb?size=lg`
      : null;
  const bannerSolidColor =
    bannerType === 'photo' ? null : bannerColor ?? '#1e1b3a';

  // 멤버 표시: 항상 "첫 사람 외 N명" 형태. 1명일 땐 이름만.
  const memberNames =
    members.length <= 1
      ? members[0]?.user.displayName ?? ''
      : `${members[0].user.displayName} 외 ${members.length - 1}명`;

  return (
    <header className="mb-3">
      <div
        className="album-banner"
        style={bannerSolidColor ? { background: bannerSolidColor } : undefined}
      >
        {bannerBgImageUrl && (
          <>
            <div
              className="album-banner-bg"
              style={{ backgroundImage: `url(${bannerBgImageUrl})` }}
              aria-hidden
            />
            <div className="album-banner-overlay" aria-hidden />
          </>
        )}

        <Link to="/" className="album-banner-breadcrumb">
          <Icon name="chevronLeft" size={12} />
          홈
        </Link>

        <div className="album-banner-actions">
          <button
            type="button"
            className="banner-icon-btn"
            aria-label="히스토리"
            onClick={onHistoryClick}
          >
            <Icon name="history" size={14} />
          </button>
          <div className="banner-divider" aria-hidden />
          <button
            type="button"
            className="banner-upload-btn"
            onClick={onUploadClick}
          >
            <Icon name="upload" size={14} />
            업로드
          </button>
          <Link
            to={`/projects/${projectId}/settings`}
            className="banner-icon-btn"
            aria-label={isOwner ? '설정' : '앨범 정보'}
          >
            <Icon name={isOwner ? 'settings' : 'infoCircle'} size={14} />
          </Link>
        </div>

        <div className="album-banner-bottom">
          <div className="album-cover-thumb">
            {coverUrl ? (
              <img src={coverUrl} alt="" />
            ) : (
              <div style={{ width: '100%', height: '100%' }} />
            )}
          </div>

          <div className="album-banner-title-wrap">
            {(location || dateRange) && (
              <div className="album-banner-pills">
                {location && (
                  <span className="album-banner-pill">
                    <Icon name="mapPin" size={11} className="pill-ico" />
                    {location}
                  </span>
                )}
                {dateRange && (
                  <span className="album-banner-pill">
                    <Icon name="calendar" size={11} className="pill-ico" />
                    {dateRange}
                  </span>
                )}
              </div>
            )}
            <h1 className="album-banner-title" title={title}>{title}</h1>
            <div className="album-banner-meta">
              <div className="album-banner-avatars">
                {members.slice(0, 5).map((m) => (
                  <Avatar key={m.userId} user={m.user} size={22} />
                ))}
              </div>
              <span className="album-banner-meta-names">{memberNames}</span>
              <span className="album-banner-pill album-banner-count-pill" data-tabular>
                <Icon name="image" size={11} className="pill-ico" />
                {mediaCount}장
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  // 한쪽만 있으면 YY.MM.DD 단일 표시
  if (start && !end) return formatYMD(start);
  if (!start && end) return formatYMD(end);
  const sd = new Date(start!);
  const ed = new Date(end!);
  if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return null;
  const sParts = ymdParts(sd);
  const eParts = ymdParts(ed);
  // 같은 해면 YY.MM.DD - MM.DD, 다른 해면 양쪽 모두 YY.MM.DD
  if (sParts.year === eParts.year) {
    return `${sParts.year}.${sParts.month}.${sParts.day} - ${eParts.month}.${eParts.day}`;
  }
  return `${sParts.year}.${sParts.month}.${sParts.day} - ${eParts.year}.${eParts.month}.${eParts.day}`;
}

function formatYMD(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const { year, month, day } = ymdParts(d);
  return `${year}.${month}.${day}`;
}

function ymdParts(d: Date): { year: string; month: string; day: string } {
  // KST 기준, year는 2자리(끝 2자리)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: (v.year ?? '').slice(-2),
    month: v.month ?? '',
    day: v.day ?? '',
  };
}
