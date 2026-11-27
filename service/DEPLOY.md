# Запуск сервера замовлень (Hetzner, ~6 €/міс)

Що вийде: сайт приймає ім'я + фото + email → сервер сам озвучує ім'я в ElevenLabs, вписує його в книгу, ставить фото в портрет, рендерить 1080p → ви дивитесь ролик в адмінці й натискаєте «Підтвердити» (або вмикаєте автонадсилання) → клієнт отримує лист із посиланням.

## 1. Сервер
1. Зареєструйтесь на hetzner.com → Cloud → **Add Server**.
2. Location: Falkenstein або Helsinki. Image: **Ubuntu 24.04**. Type: **CPX31** (4 vCPU, 8 GB, ~13 €) для швидкого рендеру або **CPX21** (3 vCPU, 4 GB, ~7 €) для старту.
3. Додайте свій SSH-ключ, створіть сервер, скопіюйте його IP.

## 2. Домен
У DNS вашого домену додайте запис **A**: `api` → IP сервера. Сайт буде на `https://api.ваш-домен` (сертифікат HTTPS ставиться сам).

## 3. Встановлення (один раз)
```bash
ssh root@IP
curl -fsSL https://get.docker.com | sh
git clone https://github.com/polgroup222/site.git && cd site/service
cp .env.example .env && nano .env        # заповніть домен, ADMIN_TOKEN, ключі ElevenLabs
mkdir -p runtime/master
```
Завантажте мастер-відео з VN зі свого Mac:
```bash
scp master.mp4 root@IP:~/site/service/runtime/master/master.mp4
```
Запуск:
```bash
docker compose up -d --build
curl https://api.ваш-домен/health          # має відповісти {"ok":true,...}
```

## 4. Сайт
У `index.html` впишіть адресу сервера: `<meta name="order-api" content="https://api.ваш-домен">`.
Поки там порожньо, форма працює в демо-режимі.

## 5. Щоденна робота
- Адмінка: `https://api.ваш-домен/admin/login?token=ВАШ_ADMIN_TOKEN` (один раз, далі пам'ятає 30 днів).
- `PAYMENT_MODE=manual`: нове замовлення чекає «Оплачено → у чергу». Коли підключимо оплату, це буде автоматично.
- Після рендеру ролик з'являється в адмінці. «Підтвердити і надіслати» → клієнту йде лист (якщо заданий `RESEND_API_KEY`), або скопіюйте посилання «сторінка клієнта» вручну.
- Ролик із зауваженнями (обличчя не знайдено, незнайоме ім'я тощо) ніколи не йде клієнту сам.

## Оновлення мастера чи коду
```bash
cd ~/site && git pull && cd service && docker compose up -d --build
```
Новий мастер: замініть `runtime/master/master.mp4`; якщо змінились секунди книги/портрета, поправте `master/master.json`.

## Що де лежить
- `runtime/orders/<id>/` — фото, order.json, готовий `out/video.mp4`.
- `runtime/voice_cache/` — озвучені імена (кожне ім'я генерується лише раз).
- Бекап: достатньо копіювати папку `runtime/`.
