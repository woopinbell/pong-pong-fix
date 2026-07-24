# Pong Pong 개발 기록

Pong Pong을 처음 연결한 뒤 실시간 게임, 데이터 정합성, 비회원 체험, 배포와 부하 검증까지 확장한 과정을 정리했다. 완성된 코드를 기능별로 설명하기보다 처음 만든 경계가 어디에서 부족했고, 어떤 문제를 계기로 책임을 다시 나눴는지에 초점을 맞췄다.

프로젝트는 pnpm 모노레포로 구성했다. `packages/shared`가 HTTP와 WebSocket 계약을, `packages/db`가 PostgreSQL 스키마와 저장소를 맡는다. `apps/api`는 Fastify 기반 HTTP·WebSocket 서버이고 `apps/web`은 Next.js 애플리케이션이다. 경기 상태는 서버가 계산하며 브라우저는 입력을 보내고 스냅샷을 그린다.

## 개발 흐름

1. [공용 계약과 서버 기반 구성](devlog/01-contracts-and-foundation.md)
2. [처음으로 연결된 플레이 흐름](devlog/02-first-playable-service.md)
3. [샘플 상태를 실제 상태로 바꾸기](devlog/03-replacing-demo-state.md)
4. [HTTP·인증·프로토콜 경계 닫기](devlog/04-closing-trust-boundaries.md)
5. [실시간 게임 코어 분리](devlog/05-realtime-core.md)
6. [매칭 수명 주기와 재접속](devlog/06-matchmaking-and-reconnect.md)
7. [PostgreSQL 정합성과 트랜잭션](devlog/07-database-consistency.md)
8. [브라우저의 서버 상태 관리](devlog/08-browser-server-state.md)
9. [비회원 체험을 별도 경계로 만들기](devlog/09-guest-mode.md)
10. [방별 타이머를 공유 스케줄러로 바꾸기](devlog/10-shared-scheduler.md)
11. [배포 산출물과 CI 연결](devlog/11-production-pipeline.md)
12. [부하와 장애를 수치로 확인하기](devlog/12-load-fault-observability.md)
13. [운영 안전장치와 마지막 회귀](devlog/13-operational-safety.md)

## 구현하면서 따로 정리한 주제

- [타입과 런타임 계약](learning/contracts-and-runtime-validation.md)
- [인증과 신뢰 경계](learning/authentication-and-trust.md)
- [상태를 소유할 위치](learning/state-ownership.md)
- [시간·순서·재접속](learning/time-order-and-reconnect.md)
- [데이터베이스 불변식](learning/database-invariants.md)
- [브라우저의 서버 상태](learning/browser-server-state.md)
- [빌드 이후의 실행 책임](learning/delivery-and-operability.md)

측정이 판단에 직접 영향을 준 부분은 별도로 남겼다.

- [스케줄러 비교](learning/experiments/scheduler.md)
- [기준 부하와 이벤트 루프 지연](learning/experiments/load-and-event-loop.md)
- [DB·공개 경로 장애 복구](learning/experiments/fault-recovery.md)

여기 적은 수치는 프로젝트의 `docs/measurements`에 보관한 로컬 측정값에 한정한다. 운영 환경의 처리량이나 다른 장비의 결과로 일반화하지 않았다.
