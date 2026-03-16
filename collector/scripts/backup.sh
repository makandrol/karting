#!/bin/bash
# Бекап karting.db в git репо
# Запускається через cron кожні 24 години

set -e

COLLECTOR_DIR="$HOME/collector"
REPO_DIR="$HOME/karting"
DB_FILE="$COLLECTOR_DIR/data/karting.db"
BACKUP_DIR="$REPO_DIR/backups"
DATE=$(date +%Y-%m-%d)

echo "🔄 Starting backup: $DATE"

# Check DB exists
if [ ! -f "$DB_FILE" ]; then
  echo "❌ DB file not found: $DB_FILE"
  exit 1
fi

# Clone/update repo
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "📥 Cloning repo..."
  git clone git@github:makandrol/karting.git "$REPO_DIR" 2>/dev/null || \
  git clone https://github.com/makandrol/karting.git "$REPO_DIR"
fi

cd "$REPO_DIR"
git pull --rebase origin dev 2>/dev/null || true

# Create backup dir
mkdir -p "$BACKUP_DIR"

# Copy DB (use sqlite3 .backup for consistency)
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/karting.db'"
else
  cp "$DB_FILE" "$BACKUP_DIR/karting.db"
fi

# Also save a dated copy (keep last 7)
cp "$BACKUP_DIR/karting.db" "$BACKUP_DIR/karting-$DATE.db"
ls -t "$BACKUP_DIR"/karting-*.db | tail -n +8 | xargs -r rm --

# Get DB size for commit message
DB_SIZE=$(du -h "$BACKUP_DIR/karting.db" | cut -f1)

# Commit and push
cd "$REPO_DIR"
git add backups/
git commit -m "🔄 DB backup $DATE ($DB_SIZE)" 2>/dev/null || echo "No changes"
git push origin dev 2>/dev/null || echo "Push failed (will retry next time)"

echo "✅ Backup complete: $DB_SIZE"
