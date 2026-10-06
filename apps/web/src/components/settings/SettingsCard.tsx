import { useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from '../ui/Icon';

interface Props {
  icon?: IconName;
  iconNode?: React.ReactNode;
  title: string;
  description?: string;
  /** 변경 후 표시 — 변경 트리거 후 2초간 노출. number(timestamp)를 increment 하면 다시 표시 */
  savedKey?: number;
  /** 카드 자체 variant — 위험 구역 */
  danger?: boolean;
  /** 강조 톤 — 받은 친구 요청 같이 사용자 주의 환기가 필요한 카드 */
  tone?: 'brand';
  rightHeader?: React.ReactNode;
  children: React.ReactNode;
}

export default function SettingsCard({
  icon,
  iconNode,
  title,
  description,
  savedKey,
  danger,
  tone,
  rightHeader,
  children,
}: Props) {
  const [showSaved, setShowSaved] = useState(false);
  const timer = useRef<number | null>(null);
  const prevKey = useRef<number | undefined>(savedKey);

  useEffect(() => {
    if (savedKey !== undefined && savedKey !== prevKey.current) {
      prevKey.current = savedKey;
      setShowSaved(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShowSaved(false), 2000);
    }
  }, [savedKey]);

  return (
    <section
      className={`settings-card ${danger ? 'danger' : ''} ${tone === 'brand' ? 'brand-tone' : ''}`}
    >
      <div className="settings-card-head">
        <span style={{ color: danger ? '#991b1b' : '#555', display: 'inline-flex' }}>
          {iconNode ?? (icon ? <Icon name={icon} size={18} /> : null)}
        </span>
        <span className="settings-card-title">{title}</span>
        <div className="settings-card-head-right">
          <span className={`settings-card-saved ${showSaved ? 'on' : ''}`} aria-live="polite">
            <Icon name="check" size={14} />
            저장됨
          </span>
          {rightHeader}
        </div>
      </div>
      {description && <p className="settings-card-desc">{description}</p>}
      {children}
    </section>
  );
}
