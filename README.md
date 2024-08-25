# Pong Pong

`Pong Pong`은 실시간 퐁 서비스를 여러 패키지로 나누어 개발하기 위한 pnpm 모노레포입니다.

## 시작하기

저장소 루트에서 pnpm을 활성화하고 의존성을 설치합니다.

```sh
corepack enable
pnpm install
```

## 구성

공용 데이터 형식은 `packages/shared`, PostgreSQL 스키마와 저장소 구현은 `packages/db`에 있습니다.

