import { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  illustration?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, illustration, title, description, action, className = '' }: Props) {
  return (
    <div className={`text-center py-12 px-6 ${className}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {illustration}
      {icon && !illustration && (
        <div
          style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'var(--brand-50)', color: 'var(--brand-600)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {icon}
        </div>
      )}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>
          {title}
        </div>
        {description && (
          <div className="subtitle" style={{ marginTop: 6, maxWidth: 380 }}>{description}</div>
        )}
      </div>
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}

export function PolaroidStack() {
  const Pol = ({ rot, off, hue }: { rot: number; off: number; hue: number }) => (
    <div
      style={{
        position: 'absolute',
        width: 96, height: 110,
        background: 'white', borderRadius: 8,
        boxShadow: '0 6px 18px rgba(28,25,23,.12)',
        padding: 6,
        transform: `rotate(${rot}deg) translateX(${off}px)`,
        zIndex: 10 - Math.abs(rot),
      }}
    >
      <div
        style={{
          width: '100%', height: '76%', borderRadius: 4,
          background: `linear-gradient(135deg, hsl(${hue}, 70%, 80%), hsl(${(hue + 30) % 360}, 75%, 65%))`,
        }}
      />
    </div>
  );
  return (
    <div style={{ position: 'relative', width: 132, height: 130 }}>
      <Pol rot={-12} off={-14} hue={20} />
      <Pol rot={4} off={0} hue={140} />
      <Pol rot={14} off={14} hue={260} />
    </div>
  );
}
