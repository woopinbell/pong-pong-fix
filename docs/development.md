# 로컬 개발과 검증

## 실행 환경

Node.js `24.18.0`과 pnpm `10.32.1`을 사용합니다. `.nvmrc`, `package.json`, CI, Dockerfile이 같은 Node 버전을 가리킵니다. 의존성 설치는 저장소 루트에서 실행합니다.

```bash
corepack enable
pnpm install --frozen-lockfile
```

개발 서버는 API와 웹을 함께 실행합니다.

```bash
pnpm dev
```

API 기본 포트는 4000, 웹 기본 포트는 3000입니다. PostgreSQL을 붙일 때는 `DATABASE_URL`을 명시합니다. 애플리케이션 시작 과정에서 마이그레이션이나 시드를 실행하지 않으므로 처음 만든 DB에는 아래 명령을 따로 실행해야 합니다.

```bash
pnpm --filter @pong-pong/db migrate
pnpm --filter @pong-pong/db seed:dev
```

`seed:demo`는 NPC 데이터만 준비합니다. 관리자 권한을 명시적으로 바꿀 때는 다음 명령을 씁니다.

```bash
pnpm --filter @pong-pong/db user:set-role -- <handle> <user|admin>
```

## 검사 순서

빠른 검사부터 실행하면 실패 원인을 좁히기 쉽습니다.

```bash
pnpm typecheck
pnpm unit
pnpm postgres-integration
pnpm build
pnpm verify:build
pnpm smoke:http
pnpm smoke:ws
pnpm e2e
```

- `pnpm unit`은 공용 계약, API 로직, 웹 컴포넌트와 상태 전이 함수, 메모리 저장소를 검사합니다.
- `pnpm postgres-integration`은 Testcontainers가 띄운 임의 포트 PostgreSQL을 사용합니다. 테스트별 스키마를 만들고 마이그레이션, 테스트 데이터, 정리를 분리합니다.
- `pnpm smoke:http`와 `pnpm smoke:ws`는 빌드한 프로세스를 직접 실행해 HTTP와 WebSocket 통신을 확인합니다.
- `pnpm e2e`는 브라우저에서 로그인, 로비, 경기 흐름을 확인합니다.
- `pnpm verify:build`는 공용 패키지, DB, API의 `dist`와 Next.js 독립 실행 산출물이 실제로 생겼는지 검사합니다.

PostgreSQL 통합 검사는 Docker 데몬을 사용합니다. 테스트가 중간에 실패해도 스키마, 연결 풀, 컨테이너를 `finally`에서 정리하도록 작성되어 있습니다. 로컬 Docker를 쓸 수 없는 환경에서는 이 검사를 건너뛴 것으로 성공 처리하지 말고, 실행하지 못한 이유를 결과에 남깁니다.

## 마이그레이션과 테스트 데이터

`packages/db/migrations/*.sql`만 스키마 변경 원본으로 사용합니다. `SqlMigrationProvider`가 파일 이름 순서대로 읽어 Kysely Migrator에 넘깁니다. 테스트 데이터와 `seed:dev`, `seed:demo`는 마이그레이션에 섞지 않습니다.

새 마이그레이션을 추가할 때는 다음 세 가지를 함께 확인합니다.

1. 빈 스키마에 전체 마이그레이션이 적용되는지 확인합니다.
2. 같은 마이그레이션 명령을 다시 실행해도 스키마가 바뀌지 않는지 확인합니다.
3. 기존 사용자와 경기 데이터를 보존해야 하는 변경이 실제 데이터를 유지하는지 확인합니다.

## 스케줄러 비교

방별 타이머와 공유 스케줄러 비교는 아래 명령으로 재현합니다.

```bash
node tests/load/scheduler-benchmark.mjs
```

현재 보관된 측정 파일에는 1, 20, 50, 100개 방 결과가 들어 있습니다. 다른 장비에서 다시 잰 값은 기존 파일을 덮어쓰지 말고 날짜와 실행 환경을 함께 기록합니다.
