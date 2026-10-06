interface Props {
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 28,
  md: 36,
  lg: 56,
} as const;

export default function BrandMark({ size = 'md' }: Props) {
  const px = SIZES[size];
  return (
    <img
      src="/icon.png"
      alt="Ouri"
      width={px}
      height={px}
      draggable={false}
      style={{
        width: px,
        height: px,
        borderRadius: size === 'lg' ? 14 : size === 'sm' ? 8 : 10,
        objectFit: 'cover',
        flexShrink: 0,
        // 기존 brand-mark의 입체감 유지
        boxShadow:
          '0 4px 14px rgba(99,102,241,.22), inset 0 1px 0 rgba(255,255,255,.18)',
      }}
    />
  );
}
