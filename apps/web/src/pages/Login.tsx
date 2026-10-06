import { Link } from 'react-router-dom';
import BrandMark from '../components/ui/BrandMark';
import Icon from '../components/ui/Icon';

const UNIPASS_MESSAGES: Record<string, string> = {
  error: 'Unipass 인증이 취소되었거나 완료되지 않았어요.',
  missing_token: 'Unipass 인증 결과를 받지 못했어요. 다시 시도해주세요.',
  invalid_token: 'Unipass 인증 정보가 유효하지 않아요. 다시 로그인해주세요.',
  conflict: '이미 다른 Ouri 계정에 연결된 Unipass 계정이에요.',
  pending: '아직 관리자 승인을 받지 못했습니다.',
  disabled: '비활성화된 계정입니다.',
  profile_error: 'Unipass 계정 정보를 확인하지 못했어요.',
};

export default function Login() {
  const status = new URLSearchParams(window.location.search).get('unipass') ?? '';
  const message = status ? UNIPASS_MESSAGES[status] ?? 'Unipass 로그인을 완료하지 못했어요.' : '';

  const startUnipass = () => {
    window.location.href = '/api/auth/unipass/login';
  };

  return (
    <div
      style={{
        width: '100%', minHeight: '100%',
        background: 'var(--ink-50)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div className="anim-up" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <BrandMark size="lg" />
            <div>
              <div className="h-display" style={{ fontSize: 28 }}>Ouri</div>
              <div className="subtitle" style={{ marginTop: 6 }}>Unipass 계정으로 이용하세요</div>
            </div>
          </div>
        </div>

        <div
          className="card"
          style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {message && (
            <div className="error-box anim-fade">
              <Icon name="alert" size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {message}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={startUnipass}
            style={{ marginTop: 4 }}
          >
            <Icon name="shield" size={16} />
            Unipass로 계속하기
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 14, color: 'var(--ink-600)' }}>
          처음이세요?{' '}
          <Link
            to="/signup"
            style={{ color: 'var(--brand-600)', fontWeight: 600, textDecoration: 'none' }}
          >
            Unipass에서 가입하기
          </Link>
        </div>
      </div>
    </div>
  );
}
