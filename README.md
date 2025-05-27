# Pong Pong

`Pong Pong`은 경기 판정을 서버에서 처리하는 실시간 퐁 서비스입니다. 브라우저는 플레이어 입력을 보내고, 서버가 공의 위치와 점수, 승패를 계산합니다.

## 시작하기

저장소 루트에서 pnpm을 활성화하고 의존성을 설치합니다.

```sh
corepack enable
pnpm install --frozen-lockfile
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

비회원 체험은 일반 사용자 데이터와 분리됩니다. 비회원끼리 매칭하고 일정 시간 뒤에는 NPC 상대를 배정하며, 결과를 전적과 순위표에 저장하지 않습니다.

`PongSimulation`이 경기 계산을, `RoomSession`이 방 상태 전이를 맡습니다. 실행 중인 방은 `SharedRoomScheduler`가 하나의 고정 주기로 순회합니다.

## 실행

로컬 Compose 환경은 PostgreSQL, 마이그레이션, API, 웹과 Caddy를 순서대로 시작합니다. 세션 비밀 값과 DB 비밀번호는 실행할 때 전달합니다.

```sh
POSTGRES_PASSWORD=local-pong-password \
SESSION_SECRET=local-session-secret-at-least-32-bytes \
APP_MODE=demo \
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
pnpm verify:build
pnpm smoke:http
pnpm smoke:ws
pnpm e2e
```

`pnpm postgres-integration`은 Testcontainers로 실제 PostgreSQL 경계를 검사합니다.

`pnpm verify:build`는 공용 패키지, DB, API의 `dist`와 Next.js 배포 산출물이 빠짐없이 생성됐는지 확인합니다.

## 운영 상태

`/health/live`와 `/health/ready`로 프로세스와 DB 준비 상태를 나누어 확인합니다. `/metrics`는 연결, 방, 이벤트 루프 지연과 경기 결과 확정 상태를 Prometheus 형식으로 제공합니다. 종료 신호를 받으면 새 매칭을 막고 진행 중인 방을 정리한 뒤 서버와 DB 연결을 닫습니다.

## 기술 문서

- [서버 구조와 경기 처리 흐름](docs/architecture.md)
- [HTTP와 실시간 프로토콜](docs/protocol.md)
- [로컬 개발과 검증](docs/development.md)
- [운영 준비와 장애 확인](docs/operations.md)
- [서버 구조 개선 과정](docs/case-study.md)
- [부하·장애 주입 실행 안내](tests/load/guide.ko.md)

