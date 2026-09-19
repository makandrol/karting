#!/bin/bash
# Бекап karting.db: gzipped SQL dump → git (off-machine, GitHub) + локальні
# датовані копії на сервері. Запускається через cron щодоби.
#
# Чому SQL dump, а не raw .db: текстовий дамп тиснеться ~2x краще (1GB db →
# ~58MB .gz проти ~121MB), і він стійкий до пошкоджень бінарного формату.
#
# ВАЖЛИВО (2026-06-22): стара версія мовчки не пушила бекапи — backups/.gitignore
# містив *.db, тож `git add` ігнорував файл, а помилки маскувались `|| echo`.
# Тепер: явний force-add + перевірка пушу.
#
# ВАЖЛИВО (2026-08-26): бекапи більше НЕ йдуть у `dev`.
#
# Раніше кожен дамп (~100MB) лягав окремим комітом у `dev`. Бінарники не
# дельтуються, тож історія росла на ~100MB/добу: .git роздувся до 4GB, GitHub
# почав відхиляти push з `Internal Server Error`, а `git fetch` тривав 5 хвилин.
# Історію довелось чистити через git filter-repo.
#
# Тепер дампи живуть на ОКРЕМІЙ orphan-гілці `db-backups` (без спільної історії
# з кодом) і ротуються: щоразу гілка перестворюється з нуля, лишаючи лише
# KEEP_BACKUPS останніх дампів. Тобто розмір гілки обмежений і не накопичується,
# а клон коду (`git clone` без --branch) її взагалі не тягне.

set -euo pipefail

COLLECTOR_DIR="$HOME/collector"
REPO_DIR="$HOME/karting"
DB_FILE="$COLLECTOR_DIR/data/karting.db"
LOCAL_DIR="$COLLECTOR_DIR/backups-local"
WORK_DIR="$COLLECTOR_DIR/backup-work"       # окремий worktree для orphan-гілки
DATE=$(date +%Y-%m-%d)
BRANCH="db-backups"
KEEP_BACKUPS=7                               # скільки дампів тримати в гілці

echo "🔄 Starting backup: $DATE"

if [ ! -f "$DB_FILE" ]; then
  echo "❌ DB file not found: $DB_FILE"
  exit 1
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "❌ Repo not found: $REPO_DIR (clone it manually once)"
  exit 1
fi

mkdir -p "$LOCAL_DIR"

# 1) Консистентний gzip-дамп (.dump читає БД без блокування писання)
echo "📦 Dumping + gzip..."
DUMP_GZ="$LOCAL_DIR/karting-$DATE.dump.gz"
sqlite3 "$DB_FILE" ".dump" | gzip -6 > "$DUMP_GZ"
SIZE=$(du -h "$DUMP_GZ" | cut -f1)

# 2) Локальні датовані копії (швидкий rollback) — лишаємо KEEP_BACKUPS останніх
ls -t "$LOCAL_DIR"/karting-*.dump.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --

# 3) Публікація в git на orphan-гілку `db-backups` з ротацією.
#
#    Гілка перестворюється з нуля щоразу (orphan commit), тож історія НЕ росте:
#    у ній завжди лише останні KEEP_BACKUPS дампів одним комітом.
echo "☁️  Publishing to branch '$BRANCH' (rotating, keep $KEEP_BACKUPS)..."

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
git init --quiet
git remote add origin "$(git -C "$REPO_DIR" remote get-url origin)"

# Підтягуємо наявні дампи з гілки (якщо вона вже є), щоб зберегти попередні.
if git fetch --depth 1 origin "$BRANCH" --quiet 2>/dev/null; then
  git checkout --quiet FETCH_HEAD -- . 2>/dev/null || true
fi

cp "$DUMP_GZ" "./karting-$DATE.dump.gz"
# Ротація всередині гілки
ls -t ./karting-*.dump.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --

cat > README.md <<'EOF'
# DB backups (orphan branch)

Щодобові gzip SQL-дампи `karting.db`. Гілка НЕ має спільної історії з кодом і
**перестворюється щоразу**, тримаючи лише кілька останніх дампів — щоб історія
репо не росла (раніше дампи в `dev` роздули .git до 4GB).

Відновлення:
```bash
git fetch origin db-backups && git checkout origin/db-backups -- .
gunzip -c karting-YYYY-MM-DD.dump.gz | sqlite3 karting.db
```
EOF

git add -f ./karting-*.dump.gz README.md
git -c user.name="Karting Collector" -c user.email="collector@karting" \
    commit -m "DB backups (latest $DATE, $SIZE)" --quiet

# force — гілка свідомо перезаписується (ротація), історія в ній не потрібна
if git push --force origin HEAD:"$BRANCH" --quiet; then
  echo "✅ Backup pushed to '$BRANCH': $SIZE"
  cd "$COLLECTOR_DIR"
  rm -rf "$WORK_DIR"
else
  echo "❌ Push FAILED — backup NOT off-machine! Check creds/network." >&2
  exit 1
fi

echo "✅ Backup complete: $SIZE (локальних копій: $(ls -1 "$LOCAL_DIR"/karting-*.dump.gz 2>/dev/null | wc -l | tr -d ' '))"
