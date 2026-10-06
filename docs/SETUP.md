# 실행과 환경 설정

[프로젝트 소개](../README.md) · [환경변수 예시](../.env.example)

## 준비

- Node.js 22, npm
- 먼저 실행한 [공통 인증 서버](https://github.com/ho72/unified-auth-server)
- 영상 썸네일·메타데이터: `ffmpeg`, `ffprobe`
- PDF 미리보기: Poppler의 `pdftoppm`
- Office 문서 미리보기: LibreOffice의 `soffice`

아래 명령은 macOS/Linux의 새 로컬 설치를 기준으로 합니다. 원본·DB·썸네일 디렉터리는 실행 환경에 새로 생성해서 사용합니다.

## 1. 설치와 설정

```bash
git clone https://github.com/ho72/home-media-sharing.git
cd home-media-sharing
npm ci
cp .env.example .env
```

생성한 `.env`에서 다음 항목을 설정합니다.

| 항목 | 설정 |
| --- | --- |
| `SESSION_SECRET` | 32자 이상의 독립적인 세션 키 |
| `UNIPASS_JWT_SECRET` | 공통 인증 서버의 `JWT_SECRET`과 같은 32자 이상의 키 |
| `UNIPASS_BASE_URL` | 로컬 공통 인증 서버 주소. 예시: `http://localhost:4000` |
| `PUBLIC_ORIGIN` | 브라우저가 접속하는 웹 주소. 개발 예시: `http://localhost:5174` |
| `DATABASE_URL` | 기본 예시 `file:./dev.db`는 `apps/server/prisma/dev.db`를 사용 |
| `DATA_DIR`, `ORIGINALS_DIR`, `THUMBS_DIR`, `BACKUPS_DIR` | 로컬 파일 저장 위치. npm workspace 실행 시 서버 작업 디렉터리를 기준으로 상대 경로 해석 |
| `SESSION_COOKIE_DOMAIN` | 로컬에서는 빈 값 유지 |
| `VITE_MAPTILER_KEY` | 지도 기능에 사용할 공개 클라이언트 키. 해당 기능을 사용할 때 설정 |

세션 키와 공통 인증 서명 키는 각각의 역할에 맞게 설정합니다. `VITE_` 환경변수는 웹 번들에 포함되므로 서버 비밀 값을 넣지 않습니다.

## 2. DB 초기화와 실행

```bash
npm -w apps/server run db:generate
touch apps/server/prisma/dev.db
npm -w apps/server run db:deploy
npm run dev
```

새 설치의 빈 SQLite 파일이 없으면 현재 Prisma 5의 `migrate deploy`가 `Schema engine error`로 종료되는 조건을 확인했습니다. 위 초기화는 기본 DB 경로에 빈 파일을 먼저 준비한 뒤, 저장소에 포함된 22개 마이그레이션을 적용하는 순서입니다. `DATABASE_URL`을 바꿨다면 그 경로의 디렉터리와 빈 DB 파일을 준비합니다. 기존 DB를 삭제하거나 덮어쓰지 않습니다.

- 웹: `http://localhost:5174`
- API: `http://localhost:3000`
- 상태 확인: `GET /api/health`

Vite가 `/api` 요청을 Fastify 서버로 전달합니다. 프론트·백엔드를 분리 배포하는 경우에는 웹 주소의 `/api`가 해당 서버로 연결되도록 프록시를 구성합니다.

## 3. 인증 연결

1. 공통 인증 서버의 `OURI_ORIGIN`을 웹의 `PUBLIC_ORIGIN`과 맞춥니다.
2. 로그인 버튼은 `/api/auth/unipass/login`을 거쳐 공통 인증 서버로 이동합니다.
3. 인증 콜백은 웹 주소의 `/api/auth/unipass/callback`입니다.
4. 서비스는 공통 토큰의 서명을 확인하고 `/auth/me`에서 프로필을 조회한 뒤 자체 세션을 생성합니다.

이메일·비밀번호를 서비스에 직접 입력하는 기존 로그인 API는 비활성화되어 있습니다.

### 관리자 초기화

공통 인증 서버에서 준비한 계정의 사용자 ID와 표시 이름을 `BOOTSTRAP_ADMIN_UNIPASS_USER_ID`, `BOOTSTRAP_ADMIN_DISPLAY_NAME`에 설정한 뒤 실행합니다.

```bash
npm run seed
```

이미 관리자가 존재하면 seed는 새 관리자를 생성하지 않습니다. 초기화는 로그인 계정을 대신 생성하는 기능이 아니라, 공통 계정에 대응하는 서비스 관리자 레코드를 만드는 기능입니다.

## 빌드와 컨테이너 구성

```bash
npm run build
```

Docker Compose는 서버 이미지를 빌드하고, 호스트의 웹 빌드와 `data/`를 연결합니다. 새 로컬 컨테이너 설치라면 아래 저장 경로도 준비합니다.

```bash
mkdir -p data/db
touch data/db/photoapp.sqlite
docker compose up --build -d
```

컨테이너 구성은 API와 정적 웹을 3000 포트에서 제공합니다. `PUBLIC_ORIGIN`은 실제 웹 주소, `NODE_ENV=production`에서는 HTTPS 기반 세션 쿠키 조건에 맞춰 설정합니다. Docker 이미지 빌드와 HTTPS 배포는 이번 로컬 검증에 포함하지 않았습니다.

## 선택적 기능

- Cloudflare Worker: [소스](../apps/edge-worker/src/index.ts)와 [설정](../apps/edge-worker/wrangler.toml)을 자신의 환경에 맞춰 별도 배포합니다.
- PDF·Office 미리보기: 해당 변환 실행 파일을 설치해야 합니다.
- 지도: 외부 지도 서비스 키와 네트워크 연결이 필요합니다.

서비스를 실행하면 생성되는 DB·원본·썸네일·업로드 상태·백업과 실제 `.env`는 공개 코드와 분리해서 관리합니다.
