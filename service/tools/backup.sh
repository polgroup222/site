#!/usr/bin/env bash
# Щоденний бекап Čestitam. НІЧОГО НЕ ВИДАЛЯЄ (правило власника): старі копії лишаються, поки ви самі не вирішите інакше.
# Копіює: усі order.json, журнали подій (logs/), налаштування (.env, master.json).
# BACKUP_MEDIA=1 — додати ще фото й готові відео (великі файли).
# Запуск: /root/site/service/tools/backup.sh   (cron: /etc/cron.d/cestitam-backup, щодня о 03:30)
set -euo pipefail
SVC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-/root/backups}"
mkdir -p "$DEST"; chmod 700 "$DEST"
STAMP="$(date +%F_%H%M)"
OUT="$DEST/cestitam-$STAMP.tar.gz"
cd "$SVC"
LIST="$(mktemp)"
{ find runtime/orders -name order.json 2>/dev/null; [ -d runtime/logs ] && echo runtime/logs; echo .env; echo master/master.json; } > "$LIST"
if [ "${BACKUP_MEDIA:-0}" = "1" ]; then
  find runtime/orders -type f \( -name 'photo.*' -o -path '*/out/video.mp4' \) 2>/dev/null >> "$LIST"
fi
tar -czf "$OUT.tmp" -T "$LIST" && mv "$OUT.tmp" "$OUT"
rm -f "$LIST"
chmod 600 "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"; TOTAL="$(du -sh "$DEST" | cut -f1)"; FREE="$(df -h / | awk 'NR==2{print $4}')"
N="$(find runtime/orders -name order.json 2>/dev/null | wc -l)"
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"бекап\",\"file\":\"$OUT\",\"size\":\"$SIZE\",\"orders\":$N,\"backups_total\":\"$TOTAL\",\"disk_free\":\"$FREE\"}" >> "runtime/logs/$(date -u +%F).jsonl"
echo "OK $OUT ($SIZE, замовлень: $N, усі бекапи: $TOTAL, вільно на диску: $FREE)"
