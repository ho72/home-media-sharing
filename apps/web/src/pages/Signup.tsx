import { Link } from 'react-router-dom';
import BrandMark from '../components/ui/BrandMark';
import Icon from '../components/ui/Icon';

export default function Signup() {
  const startUnipass = () => {
    window.location.href = '/api/auth/unipass/login';
  };

  return (
    <div
      style={{
        width: '100%', minHeight: '100%',
        background: 'var(--ink-50)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, overflow: 'auto',
      }}
    >
      <div className="anim-up" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <BrandMark size="lg" />
            <div>
              <div className="h-display" style={{ fontSize: 28 }}>Ouri 가입</div>
              <div className="subtitle" style={{ marginTop: 6 }}>Unipass에서 계정을 만들고 바로 이어집니다</div>
            </div>
          </div>
        </div>

        <div
          className="card"
          style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={startUnipass}
          >
            <Icon name="shield" size={16} />
            Unipass에서 가입하기
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 14, color: 'var(--ink-600)' }}>
          이미 계정이 있나요?{' '}
          <Link
            to="/login"
            style={{ color: 'var(--brand-600)', fontWeight: 600, textDecoration: 'none' }}
          >
            로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
