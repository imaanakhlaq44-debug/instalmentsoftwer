#!/usr/bin/env bash
set -eu
source_script=$(cd "$(dirname "$0")/.." && pwd)/backup.sh
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/deploy/backups" "$fixture/bin"
cp "$source_script" "$fixture/deploy/backup.sh"
printf 'POSTGRES_USER=test\nPOSTGRES_DB=test\n' > "$fixture/deploy/.env"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
while [ "$1" != sh ]; do shift; done
script=$3
output=${5:-}
script=${script//\/backups/$TEST_BACKUPS}
output=${output//\/backups/$TEST_BACKUPS}
exec sh -c "$script" sh "$output"
MOCK
cat > "$fixture/bin/pg_dump" <<'MOCK'
#!/usr/bin/env sh
if [ "$DUMP_FAIL" = 1 ]; then exit 23; fi
printf '%s\n' '-- simulated SQL dump'
MOCK
chmod +x "$fixture/bin/docker" "$fixture/bin/pg_dump"
export PATH="$fixture/bin:$PATH"
export TEST_BACKUPS="$fixture/deploy/backups"
export POSTGRES_USER=test POSTGRES_DB=test
export DUMP_FAIL=1
if sh "$fixture/deploy/backup.sh"; then
  echo 'FAIL: failed dump was accepted'; exit 1
fi
if find "$TEST_BACKUPS" -type f | read -r file; then
  echo 'FAIL: failed dump left a published backup'; exit 1
fi
export DUMP_FAIL=0
sh "$fixture/deploy/backup.sh"
find "$TEST_BACKUPS" -name '*.sql.gz' | read -r file
printf '%s\n' 'PASS: failed dump rejected; successful dump validated and published'

