import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';

// 옵션 선택 modal — nav row 클릭 시 노출
export default function ChoiceModal<T extends string>({
  title,
  options,
  selected,
  onClose,
  onSelect,
}: {
  title: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onClose: () => void;
  onSelect: (v: T) => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-sm w-full p-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-3 px-1">{title}</h3>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 8px',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--ink-900)',
                textAlign: 'left',
                borderRadius: 8,
              }}
            >
              <span>{opt.label}</span>
              {opt.value === selected && (
                <Icon name="check" size={16} style={{ color: 'var(--brand-600)' }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
