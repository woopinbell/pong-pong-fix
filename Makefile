.PHONY: install typecheck build test dev down smoke e2e

install:
	pnpm install

typecheck:
	pnpm -r typecheck

build:
	pnpm -r build

test:
	pnpm -r test

smoke:
	node tests/smoke-api.mjs
	node tests/smoke-ws.mjs

dev:
	docker compose up --build

down:
	docker compose down --remove-orphans

e2e:
	pnpm test:e2e
