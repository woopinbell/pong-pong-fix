# 실시간 부하·장애 주입 실행 안내

이 도구는 로컬 개발 환경에서 API 한 대가 연결 500개와 경기방 50개를 처리하는지 확인합니다. 외부 서비스나 운영 데이터는 사용하지 않습니다. 로그인에는 개발 모드의 `/auth/dev-login`을 쓰므로 운영 모드에서는 실행할 수 없습니다.

## 기준 부하 구성

`pong-load.js`는 VU마다 한 번만 실행합니다. 기본값은 연결 시도 500개이며, 그중 100개가 대기열에 들어가 PvP 방 50개를 만듭니다. 나머지 400개는 연결된 상태로 대기합니다. 접속자가 495명 이상 확인된 뒤 대기열 참가를 시작하므로, 연결이 충분히 모이지 않으면 방 수 기준도 함께 실패합니다.

경기 참가자는 매치 직후 10초가 지나면 소켓을 닫고 새 일회용 티켓으로 다시 접속합니다. 재접속 뒤에는 같은 방의 `queue.matched` 또는 스냅샷을 받아야 성공으로 기록됩니다. 게임 입력은 초당 10개를 같은 명령 경로로 보냅니다.

| 항목 | 통과 기준 |
| --- | --- |
| 최초 연결 성공률 | 99% 이상 |
| 경기 중 재접속 성공률 | 99% 이상 |
| 스냅샷 지연 | p95 150ms 이하, p99 250ms 이하 |
| 정상 연결의 스냅샷 유실 | 1% 미만 |
| 동시 접속 관측값 | 495명 이상 |
| 동시 방 관측값 | 50개 이상 |
| 정상 종료 결과 | 방마다 1건 이상, 기본 50건 |
| 종료 실패·중복 | 0건 |

스냅샷 유실률은 같은 연결에서 연속된 시퀀스 사이의 빈 번호를 셉니다. 의도적으로 소켓을 끊은 구간은 정상 연결 구간이 아니므로 재접속할 때 기준 시퀀스를 새로 잡습니다. 종료 결과는 각 방의 왼쪽 참가자만 집계해 두 참가자가 같은 `matchId`를 받은 일을 중복으로 오인하지 않게 했습니다.

## 준비와 실행

`docker-compose.load.yml`을 함께 적용하면 API의 PostgreSQL 연결과 로컬 공개 경로가 `Toxiproxy`를 거칩니다.

```sh
SESSION_SECRET=local-load-secret APP_MODE=development \
  docker compose -f docker-compose.yml -f docker-compose.load.yml up --build
```

다른 터미널에서 준비 상태가 올라온 뒤 기준 부하를 실행합니다.

```sh
API_BASE_URL=http://127.0.0.1:18080/api \
WS_URL=ws://127.0.0.1:18080/ws \
  k6 run tests/load/pong-load.js
```

테스트용 사용자는 `load-user-1`부터 같은 사용자 이름(`handle`)을 계속 사용합니다. 실행할 때마다 사용자가 늘어나지는 않지만, 개발 DB에는 해당 계정과 일반 경기 결과가 남습니다. 별도 테스트 DB에서 실행하고 다음 측정 전에 DB 상태를 초기화해야 합니다.

연결 1,000개는 기본 실행에 포함하지 않습니다. 실행 장비의 파일 디스크립터와 메모리 여유를 먼저 확인한 뒤 다음과 같이 선택합니다.

```sh
EXTENDED_LOAD=1 \
API_BASE_URL=http://127.0.0.1:18080/api \
WS_URL=ws://127.0.0.1:18080/ws \
  k6 run tests/load/pong-load.js
```

`CONNECTIONS`, `ROOMS`, `INITIAL_HOLD_MS`, `PLAYER_RECONNECT_DELAY_MS`, `RECONNECTED_HOLD_MS`, `MAX_DURATION`으로 실행 조건을 바꿀 수 있습니다. 연결 수는 방 수의 두 배보다 작게 설정할 수 없습니다.

스냅샷 지연은 부하 발생기의 현재 시각에서 `serverTimeMs`를 빼서 계산합니다. 서버와 k6가 다른 장비에 있다면 두 장비의 시계를 먼저 동기화해야 합니다. 그렇지 않으면 이 지표를 기준 결과로 쓰면 안 됩니다.

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

## 정적 검증

실제 부하를 만들기 전에 다음 명령으로 환경 변수 해석, 메트릭 계약, k6 구문, Compose 병합 결과를 확인합니다.

```sh
fnm exec --using=24.18.0 node --test tests/load/load-harness.test.mjs
k6 inspect tests/load/pong-load.js
fnm exec --using=24.18.0 node tests/load/toxiproxy-control.mjs plan
SESSION_SECRET=static-validation APP_MODE=development \
  docker compose -f docker-compose.yml -f docker-compose.load.yml config
```

정적 검증은 부하 기준을 통과했다는 뜻이 아닙니다. 결과를 남길 때는 실행 날짜, 커밋, CPU와 메모리, 운영체제, Node·k6·Docker 버전, 환경 변수, 통과 기준 결과를 함께 기록합니다. 실행하지 못한 연결 1,000개 결과나 장애 복구 수치는 빈칸 대신 미측정으로 표시합니다.
