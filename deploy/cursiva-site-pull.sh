#!/bin/bash
set -euo pipefail
repo=/var/www/cursivalead__usr/data/www/cursivalead.cursiva-dev.ru
cd "$repo"
git fetch --prune origin
git reset --hard origin/main
if [ -f deploy/cursiva-site-pull.sh ]; then
  install -m 755 deploy/cursiva-site-pull.sh /usr/local/sbin/cursiva-site-pull
fi
chown -R cursivalead__usr:cursivalead__usr "$repo"
find "$repo" -type d -exec chmod 755 {} \;
find "$repo" -type f -exec chmod 644 {} \;
if [ -f config.php ]; then
  chmod 640 config.php
fi
git rev-parse --short HEAD
git status -sb
