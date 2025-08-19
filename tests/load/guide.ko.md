# 실시간 부하·장애 주입 실행 안내

이 도구는 로컬 개발 환경에서 API 한 대가 연결 500개와 경기방 50개를 처리하는지 확인합니다. 외부 서비스나 운영 데이터는 사용하지 않습니다. 로그인에는 개발 모드의 `/auth/dev-login`을 쓰므로 운영 모드에서는 실행할 수 없습니다.

## 기준 부하 구성

`pong-load.js`는 VU마다 한 번만 실행합니다. 기본값은 연결 시도 500개이며, 그중 100개가 대기열에 들어가 PvP 방 50개를 만듭니다. 나머지 400개는 연결된 상태로 대기합니다. 접속자가 495명 이상 확인된 뒤 대기열 참가를 시작하므로, 연결이 충분히 모이지 않으면 방 수 기준도 함께 실패합니다.

경기 참가자는 `playing` 스냅샷을 받은 뒤 2초 이상 경기를 진행하고 소켓을 닫습니다. 참가자 100명의 종료 시점은 5초에 걸쳐 나눠 일회용 티켓 발급 요청이 한꺼번에 몰리지 않도록 합니다. 재접속 뒤에는 같은 방의 `queue.matched` 또는 스냅샷을 받아야 성공으로 기록됩니다. 게임 입력은 초당 10개를 같은 명령 경로로 보냅니다.

게임 시뮬레이션은 50ms 간격으로 실행합니다. 스냅샷은 방마다 100ms 간격으로 보내되, 방을 두 묶음으로 나눠 각 시뮬레이션 틱에 한 묶음씩 전송합니다. 시뮬레이션 주기는 유지하면서 같은 순간에 발생하는 WebSocket 전송량을 줄이기 위한 설정입니다.

| 항목 | 통과 기준 |
| --- | --- |
| 최초 연결 성공률 | 99% 이상 |
| 경기 중 재접속 성공률 | 99% 이상 |
| 스냅샷 지연 | p95 150ms 이하, p99 250ms 이하 |
| 이벤트 루프 지연 | p95 50ms 이하 |
| 정상 연결의 스냅샷 유실 | 1% 미만 |
| 동시 접속 관측값 | 495명 이상 |
| 동시 방 관측값 | 50개 이상 |
| 정상 종료 결과 | 방마다 1건 이상, 기본 50건 |
| 종료 실패·중복 | 0건 |

스냅샷 유실률은 같은 연결에서 연속된 시퀀스 사이의 빈 번호를 셉니다. 의도적으로 소켓을 끊은 구간은 정상 연결 구간이 아니므로 재접속할 때 기준 시퀀스를 새로 잡습니다. 정상 종료와 저장 실패 건수는 실행이 끝날 때 API의 Prometheus 지표에서 읽습니다. 클라이언트가 받은 `game.finished`는 응답 형식과 같은 방에서 결과가 반복되지 않았는지 확인하는 데 사용합니다.

## 준비와 실행

`docker-compose.load.yml`을 함께 적용하면 API의 PostgreSQL 연결과 로컬 공개 경로가 `Toxiproxy`를 거칩니다.

```sh
POSTGRES_PASSWORD=local-load-password \
SESSION_SECRET=local-load-session-secret-32-bytes APP_MODE=development \
  docker compose -f docker-compose.yml -f docker-compose.load.yml up --build
```

다른 터미널에서 준비 상태가 올라온 뒤 기준 부하를 실행합니다.

```sh
API_BASE_URL=http://127.0.0.1:18080/api \
WS_URL=ws://127.0.0.1:18080/ws \
METRICS_BASE_URL=http://127.0.0.1:14000 \
  k6 run tests/load/pong-load.js
```

테스트용 사용자는 `load-user-1`부터 같은 사용자 이름(`handle`)을 계속 사용합니다. 실행할 때마다 사용자가 늘어나지는 않지만, 개발 DB에는 해당 계정과 일반 경기 결과가 남습니다. 별도 테스트 DB에서 실행하고 다음 측정 전에 DB 상태를 초기화해야 합니다.

연결 1,000개는 기본 실행에 포함하지 않습니다. 실행 장비의 파일 디스크립터와 메모리 여유를 먼저 확인한 뒤 다음과 같이 선택합니다.

```sh
EXTENDED_LOAD=1 \
API_BASE_URL=http://127.0.0.1:18080/api \
WS_URL=ws://127.0.0.1:18080/ws \
METRICS_BASE_URL=http://127.0.0.1:14000 \
  k6 run tests/load/pong-load.js
```

`CONNECTIONS`, `ROOMS`, `INITIAL_HOLD_MS`, `PLAYER_RECONNECT_DELAY_MS`, `PLAYER_RECONNECT_STAGGER_MS`, `RECONNECTED_HOLD_MS`, `MAX_DURATION`으로 실행 조건을 바꿀 수 있습니다. 연결 수는 방 수의 두 배보다 작게 설정할 수 없습니다. 재접속 시점을 나누지 않는 단일 조건을 확인할 때는 `PLAYER_RECONNECT_STAGGER_MS=0`을 사용합니다.

스냅샷 지연은 부하 발생기의 현재 시각에서 `serverTimeMs`를 빼서 계산합니다. 서버와 k6가 다른 장비에 있다면 두 장비의 시계를 먼저 동기화해야 합니다. 그렇지 않으면 이 지표를 기준 결과로 쓰면 안 됩니다.

`METRICS_BASE_URL`은 부하 검사 설정이 루프백에만 연 API 직접 경로입니다. 공개 Caddy 경로의 `/api/metrics`는 계속 차단되며, 운영 Compose는 API 포트를 외부에 열지 않습니다.

## 장애 주입

제어 명령은 기본적으로 `http://127.0.0.1:8474`의 Toxiproxy API를 사용합니다. 현재 구성을 바꾸지 않고 확인하려면 `plan`을 씁니다.

```sh
node tests/load/toxiproxy-control.mjs plan
node tests/load/toxiproxy-control.mjs ensure
node tests/load/toxiproxy-control.mjs reset
```

새 장애 명령을 적용하면 같은 프록시에 남아 있던 장애 규칙은 먼저 지웁니다. 지연과 연결 재설정을 겹쳐야 한다면 제어 스크립트를 바꾸지 말고 별도의 실험 조건으로 기록해 실행합니다.

PostgreSQL 응답에 300ms 지연과 최대 50ms 지터를 넣거나 연결을 완전히 끊을 수 있습니다.

```sh
node tests/load/toxiproxy-control.mjs db-latency 300 50
node tests/load/toxiproxy-control.mjs db-down
node tests/load/toxiproxy-control.mjs db-up
```

HTTP와 WebSocket이 지나는 공개 경로 프록시에도 같은 방식으로 지연, 연결 재설정, 중단을 적용합니다.

```sh
node tests/load/toxiproxy-control.mjs edge-latency 200 25
node tests/load/toxiproxy-control.mjs edge-reset 750
node tests/load/toxiproxy-control.mjs edge-down
node tests/load/toxiproxy-control.mjs edge-up
```

장애 실험이 끝나면 `reset`으로 두 프록시를 활성화하고 장애 규칙을 모두 지웁니다. `migrate` 작업은 DB에 직접 연결하고 API 트래픽만 PostgreSQL 프록시를 지나므로, 스키마 준비가 끝난 뒤 장애를 넣어야 합니다. 장애를 넣은 실행은 일부 통과 기준이 실패하는 것이 예상될 수 있습니다. 기준 부하 통과 결과와 장애 복구 관찰 결과는 섞지 않습니다.

### 복구 시나리오 자동 실행

추가 Compose 설정이 준비됐다면 아래 명령으로 DB와 공개 경로의 복구 흐름을 한 번에 확인할 수 있습니다. 기준 부하를 실행하는 동안에는 호출하지 않습니다. 이 명령은 의도적으로 DB 연결과 공개 경로를 끊습니다.

```sh
pnpm load:faults > /tmp/pong-pong-fault-recovery.json
```

스크립트는 다음 순서로 상태를 확인합니다.

1. 남아 있는 장애 규칙을 지우고 API 준비 상태 200을 확인합니다.
2. PostgreSQL 응답에 300ms 지연을 넣고 준비 상태 응답 시간과 본문을 기록합니다.
3. PostgreSQL 프록시를 끄고 준비 상태 503을 확인합니다.
4. PostgreSQL 프록시를 다시 열고 준비 상태 200 복구를 확인합니다.
5. 공개 경로에 150ms 지연을 넣은 뒤 연결 재설정과 준비 상태 복구를 확인합니다.
6. 성공 여부와 관계없이 마지막에 두 프록시를 모두 초기화합니다.

결과는 JSON으로 표준 출력에 기록됩니다. 각 단계에는 HTTP 상태, 응답 시간, 준비 상태 본문 또는 네트워크 오류가 들어갑니다. `passed`는 예상한 상태 전이가 확인됐다는 뜻입니다. 지연 단계의 실제 응답 시간은 결과 파일에서 설정값과 함께 비교합니다.

대상 URL은 실수로 외부 환경을 건드리지 않도록 루프백 주소만 허용합니다. 기본 포트가 다른 경우 아래 환경 변수를 바꿀 수 있습니다.

| 환경 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `TOXIPROXY_API_URL` | `http://127.0.0.1:8474` | Toxiproxy 제어 API |
| `FAULT_API_READINESS_URL` | `http://127.0.0.1:14000/health/ready` | DB 상태를 확인할 API 직접 경로 |
| `FAULT_EDGE_READINESS_URL` | `http://127.0.0.1:18080/api/health/ready` | 공개 경로 프록시 경유 |
| `FAULT_DATABASE_LATENCY_MS` | `300` | PostgreSQL 응답 지연 |
| `FAULT_EDGE_LATENCY_MS` | `150` | 공개 경로 응답 지연 |
| `FAULT_INCLUDE_EDGE` | `1` | `0`이면 DB 시나리오만 실행 |
| `FAULT_REQUEST_TIMEOUT_MS` | `5000` | 준비 상태 요청 제한 시간 |
| `FAULT_RECOVERY_TIMEOUT_MS` | `15000` | 단계별 상태 전이 대기 시간 |
| `FAULT_POLL_INTERVAL_MS` | `250` | 상태 확인 간격 |

실행 전에 `node tests/load/toxiproxy-control.mjs plan`으로 대상 프록시를 다시 확인합니다. 스크립트가 실패했더라도 결과를 확인한 뒤 `node tests/load/toxiproxy-control.mjs reset`을 한 번 더 실행하면 수동으로 원상 복구할 수 있습니다.

## 정적 검증

실제 부하를 만들기 전에 다음 명령으로 환경 변수 해석, 메트릭 계약, k6 구문, Compose 병합 결과를 확인합니다.

```sh
fnm exec --using=24.18.0 node --test tests/load/fault-scenario.test.mjs
fnm exec --using=24.18.0 node --test tests/load/load-harness.test.mjs
k6 inspect tests/load/pong-load.js
fnm exec --using=24.18.0 node tests/load/toxiproxy-control.mjs plan
POSTGRES_PASSWORD=static-validation-password \
SESSION_SECRET=static-validation-session-secret APP_MODE=development \
  docker compose -f docker-compose.yml -f docker-compose.load.yml config
```

정적 검증은 부하 기준을 통과했다는 뜻이 아닙니다. 결과를 남길 때는 실행 날짜, 커밋, CPU와 메모리, 운영체제, Node·k6·Docker 버전, 환경 변수, 통과 기준 결과를 함께 기록합니다. 실행하지 못한 연결 1,000개 결과나 장애 복구 수치는 빈칸 대신 미측정으로 표시합니다.
