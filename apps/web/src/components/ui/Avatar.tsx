// 사용자 아바타: Unipass 프로필 사진을 우선 사용하고, 없으면 이름 기반 기본 아바타를 표시한다.
// 호환성: 기존 호출처는 name만 넘기는 경우가 많아 그 동작을 유지한다.

interface UserLike {
  id?: string;
  displayName: string;
  unipassAvatarUrl?: string | null;
}

interface Props {
  /** 이름만 받는 기존 사용 방식. user prop이 있으면 무시 */
  name?: string;
  /** 신규 — avatar 메타 전체 */
  user?: UserLike;
  size?: number;
  ring?: boolean;
  className?: string;
}

const PALETTE: Array<[string, string]> = [
  ['#fb7185', '#f43f5e'],
  ['#fb923c', '#ea580c'],
  ['#fbbf24', '#d97706'],
  ['#34d399', '#059669'],
  ['#22d3ee', '#0891b2'],
  ['#60a5fa', '#2563eb'],
  ['#a78bfa', '#7c3aed'],
  ['#f472b6', '#be185d'],
];

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function firstLetter(name: string): string {
  return (name?.trim()?.[0] ?? '?').toUpperCase();
}

export default function Avatar({
  name,
  user,
  size = 32,
  ring = false,
  className = '',
}: Props) {
  // user prop 우선, 없으면 name만으로 폴백
  const effectiveName = user?.displayName ?? name ?? '?';
  const letter = firstLetter(effectiveName);
  const ringStyle = ring ? { boxShadow: '0 0 0 2px white' } : undefined;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.42,
    ...ringStyle,
  };

  if (user?.unipassAvatarUrl) {
    return (
      <img
        src={user.unipassAvatarUrl}
        alt=""
        className={`avatar ${className}`}
        style={{
          ...base,
          objectFit: 'cover',
          background: '#eee',
        }}
        referrerPolicy="no-referrer"
        aria-hidden
      />
    );
  }

  // 이름 hash 기반 기본 아바타
  const idx = hashStr(effectiveName) % PALETTE.length;
  const [from, to] = PALETTE[idx];
  return (
    <div
      className={`avatar ${className}`}
      style={{
        ...base,
        backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        textShadow: '0 1px 2px rgba(0,0,0,0.18)',
      }}
      aria-hidden
    >
      {letter}
    </div>
  );
}
