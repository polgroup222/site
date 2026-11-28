#!/usr/bin/env bash
# Щоденний бекап Čestitam. Копії старші за KEEP_DAYS (14) видаляються — погоджено власником 27.11.2026.
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
find "$DEST" -maxdepth 1 -name 'cestitam-*.tar.gz' -mtime +"${KEEP_DAYS:-14}" -print -delete
chmod 600 "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"; TOTAL="$(du -sh "$DEST" | cut -f1)"; FREE="$(df -h / | awk 'NR==2{print $4}')"
N="$(find runtime/orders -name order.json 2>/dev/null | wc -l)"
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"бекап\",\"file\":\"$OUT\",\"size\":\"$SIZE\",\"orders\":$N,\"backups_total\":\"$TOTAL\",\"disk_free\":\"$FREE\"}" >> "runtime/logs/$(date -u +%F).jsonl"
# сервіс у контейнері працює не від root: журнал лишаємо доступним для нього
chown --reference=runtime "runtime/logs/$(date -u +%F).jsonl" 2>/dev/null || true
# копія поза сервером (за бажанням): якщо в .env є BACKUP_PASS і Telegram, архів шифрується (AES-256) і йде вам у Telegram.
# Без пароля ніхто не відкриє. Розшифрувати: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in файл.enc -out бекап.tar.gz
envv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- ; }
BP="$(envv BACKUP_PASS)"; TGT="$(envv TG_BOT_TOKEN)"; TGC="$(envv TG_CHAT_ID)"
if [ -n "$BP" ] && [ -n "$TGT" ] && [ -n "$TGC" ] && [ "$(stat -c%s "$OUT")" -lt 45000000 ]; then
  ENC="$OUT.enc"
  BACKUP_PASS="$BP" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$OUT" -out "$ENC" -pass env:BACKUP_PASS
  if curl -sS -m 120 -F chat_id="$TGC" -F caption="🗄 Бекап Čestitam $STAMP (зашифровано)" -F document=@"$ENC" "https://api.telegram.org/bot$TGT/sendDocument" >/dev/null; then echo "копія в Telegram: OK"; else echo "копія в Telegram: помилка"; fi
  rm -f "$ENC"
fi
echo "OK $OUT ($SIZE, замовлень: $N, усі бекапи: $TOTAL, вільно на диску: $FREE)"
