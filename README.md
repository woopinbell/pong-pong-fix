# Pong Pong

`Pong Pong`은 경기 판정을 서버에서 처리하는 실시간 퐁 서비스입니다. 브라우저는 플레이어 입력을 보내고, 서버가 공의 위치와 점수, 승패를 계산합니다.

## 시작하기

저장소 루트에서 pnpm을 활성화하고 의존성을 설치합니다.

```sh
corepack enable
pnpm install
```

## 구성

공용 데이터 형식은 `packages/shared`, PostgreSQL 스키마와 저장소 구현은 `packages/db`에 있습니다.

`apps/api`는 Fastify 기반 HTTP·WebSocket 서버입니다. 실행 환경은 `.env.example`을 바탕으로 준비하며, API 기본 포트는 4000입니다.

`apps/web`은 Next.js 기반 웹 애플리케이션입니다. 로비, 경기장, 대시보드, 순위표와 토너먼트 화면을 같은 공용 계약으로 연결합니다.

## 경기 처리

클라이언트는 패들 방향만 전송합니다. 서버가 고정 시간 간격으로 경기 상태를 갱신하고 WebSocket으로 스냅샷을 전달하므로, 점수와 승패를 브라우저 상태에 맡기지 않습니다.

개발 로그인, 실시간 매칭과 채팅, 일시 정지와 재개, 경기 기록, 순위표, 토너먼트와 관리자 상태 변경을 한 흐름으로 확인할 수 있습니다.

브라우저 인증은 HttpOnly 세션 쿠키로 유지합니다. WebSocket 연결에는 유효 시간이 짧고 한 번만 사용할 수 있는 접속권을 따로 발급합니다.

경기 중 연결이 끊기면 방과 경기 위치를 15초 동안 보존합니다. 제한 시간 안에 다시 연결하면 중단 전 상태로 돌아가며, 시간이 지나면 남아 있는 플레이어의 승리를 한 번만 확정합니다.

## 실행

Docker Compose로 PostgreSQL, API, 웹과 Caddy를 함께 시작합니다.

```sh
make dev
```

웹은 `http://localhost:8080`에서 접속할 수 있습니다. 서비스를 내릴 때는 `make down`을 실행합니다.

## 검증

정적 검사와 단위 검사부터 실행한 뒤 실제 HTTP·WebSocket 프로세스와 브라우저 흐름을 확인합니다.

```sh
pnpm typecheck
pnpm unit
pnpm postgres-integration
pnpm build
pnpm smoke:http
pnpm smoke:ws
pnpm e2e
```

`pnpm postgres-integration`은 Testcontainers로 실제 PostgreSQL 경계를 검사합니다.

