#!/bin/bash
set -euo pipefail
repo=/var/www/cursivalead__usr/data/www/cursivalead.cursiva-dev.ru
rm -f /var/www/cursivalead__usr/data/www/deploy/pull.request
cd "$repo"
git -c safe.directory="$repo" remote set-url origin https://github.com/Tsunamizxc/siteleadtg.git
before=$(git -c safe.directory="$repo" rev-parse HEAD)
git -c safe.directory="$repo" fetch --prune origin main
git -c safe.directory="$repo" checkout -B main
git -c safe.directory="$repo" reset --hard FETCH_HEAD
after=$(git -c safe.directory="$repo" rev-parse HEAD)
if [ "$before" = "$after" ]; then
  exit 0
fi
chown -R cursivalead__usr:cursivalead__usr "$repo"
find "$repo" -type d -exec chmod 755 {} \;
find "$repo" -type f -exec chmod 644 {} \;
git -c safe.directory="$repo" rev-parse --short HEAD
git -c safe.directory="$repo" status -sb
