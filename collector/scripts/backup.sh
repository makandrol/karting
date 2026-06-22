#!/bin/bash
# Бекап karting.db: gzipped SQL dump → git репо (off-machine, GitHub) + локальні
# датовані копії на сервері. Запускається через cron щодоби.
#
# Чому SQL dump, а не raw .db: текстовий дамп тиснеться ~2x краще (1GB db →
# ~58MB .gz проти ~121MB), і він стійкий до пошкоджень бінарного формату.
#
# ВАЖЛИВО: 2026-06-22 виявлено, що стара версія мовчки не пушила бекапи —
# backups/.gitignore містив *.db, тож `git add` ігнорував файл, а помилки
# маскувались `|| echo`. Тепер: явний force-add конкретного файлу + перевірки.

set -euo pipefail

COLLECTOR_DIR="$HOME/collector"
REPO_DIR="$HOME/karting"
DB_FILE="$COLLECTOR_DIR/data/karting.db"
BACKUP_DIR="$REPO_DIR/backups"
LOCAL_DIR="$COLLECTOR_DIR/backups-local"
DATE=$(date +%Y-%m-%d)
DUMP_GZ="$BACKUP_DIR/karting.db.dump.gz"   # rolling (один файл, перезаписується)

echo "🔄 Starting backup: $DATE"

if [ ! -f "$DB_FILE" ]; then
  echo "❌ DB file not found: $DB_FILE"
  exit 1
fi

# Репо має існувати (клонується вручну при первинному налаштуванні).
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "📥 Cloning repo..."
  git clone git@github.com:makandrol/karting.git "$REPO_DIR" || \
  git clone https://github.com/makandrol/karting.git "$REPO_DIR"
fi

cd "$REPO_DIR"
git fetch origin dev --quiet || true
git checkout dev --quiet || true
git reset --hard origin/dev --quiet || true   # backup branch tracks dev, не тримаємо локальних змін

mkdir -p "$BACKUP_DIR" "$LOCAL_DIR"

# 1) Консистентний gzip-дамп (.dump читає БД без блокування писання)
echo "📦 Dumping + gzip..."
sqlite3 "$DB_FILE" ".dump" | gzip -6 > "$DUMP_GZ"

# 2) Локальна датована копія того ж gz-дампа (швидкий rollback), останні 7.
#    НЕ робимо raw sqlite3 .backup — на free-tier диску це ~10хв і вантажить I/O.
cp "$DUMP_GZ" "$LOCAL_DIR/karting-$DATE.dump.gz"
ls -t "$LOCAL_DIR"/karting-*.dump.gz 2>/dev/null | tail -n +8 | xargs -r rm --

SIZE=$(du -h "$DUMP_GZ" | cut -f1)

# 3) Коміт + пуш у git (force-add, бо backups/ має .gitignore на *.db)
git add -f "$DUMP_GZ"
if git diff --cached --quiet; then
  echo "ℹ️  No DB changes since last backup"
else
  git commit -m "DB backup $DATE ($SIZE)" --quiet
  if git push origin dev --quiet; then
    echo "✅ Backup pushed to git: $SIZE"
  else
    echo "❌ Push FAILED — backup NOT off-machine! Check creds/network." >&2
    exit 1
  fi
fi

echo "✅ Backup complete: $SIZE"
