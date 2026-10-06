import { Link } from 'react-router-dom';
import Icon from './Icon';

interface Props {
  to: string;
  children: React.ReactNode;
  className?: string;
}

export default function BackLink({ to, children, className = '' }: Props) {
  return (
    <Link
      to={to}
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: 'var(--ink-500)', fontSize: 14,
        textDecoration: 'none',
        marginBottom: 12,
        transition: 'color 120ms var(--ease)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-900)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-500)')}
    >
      <Icon name="chevronLeft" size={14} />
      {children}
    </Link>
  );
}
