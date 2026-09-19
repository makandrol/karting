Дампи БД тут НЕ зберігаються в git.

Щодобовий cron на VPS (`collector/scripts/backup.sh`) публікує gzip SQL-дамп на
окрему orphan-гілку `db-backups` із ротацією (кілька останніх дампів), а не в
`dev` — інакше історія росла на ~100MB/добу.

Відновлення з бекапу:

```bash
git fetch origin db-backups
git checkout origin/db-backups -- .
gunzip -c karting-YYYY-MM-DD.dump.gz | sqlite3 karting.db
```

Локальні копії на сервері: `~/collector/backups-local/` (7 останніх).
