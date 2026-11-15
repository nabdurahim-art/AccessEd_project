#!/usr/bin/env bash
# Makes an account an admin, so it can publish lessons.
# Register the account in the app first, then run:
#     tools/make_admin.sh USERNAME
set -euo pipefail
cd "$(dirname "$0")/.."

user="${1:-}"
if [ -z "$user" ]; then
  echo "Usage: tools/make_admin.sh USERNAME"
  echo "Register that account in the app first."
  exit 1
fi
if ! [[ "$user" =~ ^[A-Za-z0-9_]{3,30}$ ]]; then
  echo "A username has 3 to 30 letters, numbers or _ only."
  exit 1
fi

changed=$(docker compose -f backend/docker-compose.yml exec -T db \
  psql -U accessed -d accessed -q -tA \
  -c "UPDATE users SET role='admin' WHERE username='$user' RETURNING 1;" | head -1)

if [ "$changed" = "1" ]; then
  echo "OK: $user is now an admin."
else
  echo "No account named '$user'. Register it in the app first."
  exit 1
fi
