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

## 경기 처리

클라이언트는 패들 방향만 전송합니다. 서버가 고정 시간 간격으로 경기 상태를 갱신하고 WebSocket으로 스냅샷을 전달하므로, 점수와 승패를 브라우저 상태에 맡기지 않습니다.

## 실행

환경 변수 파일을 준비한 뒤 API 개발 서버를 실행합니다.

```sh
cp .env.example .env
pnpm --filter @pong-pong/api dev
```

