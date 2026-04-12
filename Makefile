SHELL := /bin/sh

# This Makefile is an execution-entry stub.
# package.json scripts are not implemented yet in this repository.
# If `pnpm run ...` fails, the corresponding implementation task is still pending.
# The goal here is to fix convenient target names so they stay aligned with docs.

.PHONY: help status tree install typecheck lint format build \
	package vsix-package vsix-install vsix-uninstall \
	test test-unit test-integration test-integration-host \
	check verify clean clear-runtime-logs f5-note real-kiwi-note env-example

help:
	@echo "Available targets:"
	@echo "  make help                  - show this help"
	@echo "  make status                - show git status"
	@echo "  make tree                  - show repository files"
	@echo "  make install               - install development dependencies"
	@echo "  make typecheck             - run TypeScript type checking"
	@echo "  make lint                  - run lint checks"
	@echo "  make format                - run formatter"
	@echo "  make build                 - run build"
	@echo "  make package               - build and package the extension as a VSIX"
	@echo "  make vsix-package         - package the extension as a VSIX"
	@echo "  make vsix-install         - install the packaged VSIX into VS Code"
	@echo "  make vsix-uninstall       - uninstall the extension from VS Code"
	@echo "  make test                  - alias for test-unit"
	@echo "  make test-unit             - run unit tests"
	@echo "  make test-integration      - run integration tests"
	@echo "  make test-integration-host - run extension host integration tests"
	@echo "  make check                 - run typecheck, lint, and unit tests"
	@echo "  make verify                - run build and all documented test layers"
	@echo "  make clean                 - remove common local artifacts"
	@echo "  make clear-runtime-logs    - remove runtime JSONL files"
	@echo "  make env-example           - show key .env.example variables"
	@echo "  make f5-note               - show F5 debug usage"
	@echo "  make real-kiwi-note        - show real Kiwi local integration note"

status:
	git status --short --branch

tree:
	find . -maxdepth 2 \
		-not -path './.git*' \
		-not -path './node_modules*' \
		-not -path './dist*' \
		-not -path './out*' \
		-not -path './.kiwi-logs*' \
		| sort

install:
	pnpm install

typecheck:
	pnpm run typecheck

lint:
	pnpm run lint

format:
	pnpm run format

build:
	pnpm run build

package: vsix-package

vsix-package:
	pnpm run package:vsix

vsix-install:
	pnpm run install:vsix

vsix-uninstall:
	pnpm run uninstall:vsix

test: test-unit

test-unit:
	pnpm run test:unit

test-integration:
	pnpm run test:integration

test-integration-host:
	pnpm run test:integration:host

check: typecheck lint test-unit

verify: build test-unit test-integration test-integration-host

clean:
	rm -rf dist out coverage .kiwi-logs .vscode-test node_modules

clear-runtime-logs:
	mkdir -p .kiwi-logs/runtime
	find .kiwi-logs/runtime -type f -name '*.jsonl' -delete

env-example:
	@echo "Key .env.example values:"
	@sed -n '1,6p' .env.example

f5-note:
	@echo "F5 debug is launched from VS Code, not from make."
	@echo "Use .vscode/launch.json and the 'Extension: Debug F5' configuration."
	@echo "Runtime logging is enabled only when KIWI_RUNTIME_MODE=debug-f5."

real-kiwi-note:
	@echo "Real Kiwi local integration uses .env and https://localhost:8443/."
	@echo "Set KIWI_BASE_URL, KIWI_USERNAME, and KIWI_PASSWORD in .env."
	@echo "Then start the extension with F5 from VS Code."

-include Makefile.private
