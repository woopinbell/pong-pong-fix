.PHONY: install typecheck build test dev down e2e

install:
	pnpm install

typecheck:
	pnpm -r typecheck

build:
	pnpm -r build

test:
	pnpm -r test

dev:
	docker compose up --build

down:
	docker compose down --remove-orphans

e2e:
	pnpm test:e2e

