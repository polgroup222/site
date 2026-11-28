#!/bin/sh
# Запуск сервісу НЕ від root: спершу (від root) робимо папку даних доступною користувачу node, далі працюємо як node.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  # chown лише того, що ще не належить node (швидко навіть із тисячами файлів)
  find "${DATA_DIR:-/data}" \! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi
exec "$@"
