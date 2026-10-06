import React from 'react';
import Icon from '../ui/Icon';

// 공통 행 컴포넌트 — input / toggle / segment / nav / info 5가지 변주
//
// 사용:
//   <SettingsRow variant="input" label="제목">
//     <input className="settings-input" ... />
//   </SettingsRow>

interface BaseProps {
  label: string;
  subLabel?: string;
  /** 마지막 행 border-bottom 제거 등 */
  className?: string;
}

export function SettingsRow({
  label,
  subLabel,
  className,
  children,
}: BaseProps & { children: React.ReactNode }) {
  return (
    <div className={`settings-row ${className ?? ''}`}>
      {subLabel ? (
        <div className="settings-row-label-stack">
          <span className="settings-row-label" style={{ minWidth: 0 }}>
            {label}
          </span>
          <span className="settings-row-sub">{subLabel}</span>
        </div>
      ) : (
        <span className="settings-row-label">{label}</span>
      )}
      <div className="settings-row-right">{children}</div>
    </div>
  );
}

export function SettingsInputRow({
  label,
  value,
  placeholder,
  maxLength,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onChange: (v: string) => void;
  type?: 'text' | 'email';
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="settings-input-wrap">
        <input
          type={type}
          className="settings-input"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export function SettingsNavRow({
  label,
  subLabel,
  value,
  onClick,
  rightExtra,
}: {
  label: string;
  subLabel?: string;
  value?: React.ReactNode;
  onClick: () => void;
  rightExtra?: React.ReactNode;
}) {
  return (
    <div className="settings-row click" onClick={onClick} role="button" tabIndex={0}>
      {subLabel ? (
        <div className="settings-row-label-stack">
          <span className="settings-row-label" style={{ minWidth: 0 }}>
            {label}
          </span>
          <span className="settings-row-sub">{subLabel}</span>
        </div>
      ) : (
        <span className="settings-row-label">{label}</span>
      )}
      <div className="settings-row-right">
        {value !== undefined && (
          <span className="settings-row-value">{value}</span>
        )}
        {rightExtra}
        <span className="settings-row-chevron">
          <Icon name="chevronRight" size={14} />
        </span>
      </div>
    </div>
  );
}

export function SettingsInfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="settings-row-right">
        <span className="settings-row-value strong">{value}</span>
      </div>
    </div>
  );
}

export function SettingsToggleRow({
  label,
  subLabel,
  on,
  onChange,
}: {
  label: string;
  subLabel?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="settings-row">
      {subLabel ? (
        <div className="settings-row-label-stack">
          <span className="settings-row-label" style={{ minWidth: 0 }}>
            {label}
          </span>
          <span className="settings-row-sub">{subLabel}</span>
        </div>
      ) : (
        <span className="settings-row-label">{label}</span>
      )}
      <div className="settings-row-right">
        <Toggle on={on} onChange={onChange} />
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`settings-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

export function SettingsSegmentRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="settings-row-right">
        <div className="settings-segment" role="tablist">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={opt.value === value}
              className={`settings-segment-btn ${opt.value === value ? 'on' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
