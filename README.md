# DB backups (orphan branch)

Щодобові gzip SQL-дампи `karting.db`, розрізані на частини по 90MB (GitHub не
приймає файли >100MB). Гілка НЕ має спільної історії з кодом і
**перестворюється щоразу**, тримаючи лише кілька останніх дампів — щоб історія
репо не росла (раніше дампи в `dev` роздули .git до 4GB).

Відновлення:
```bash
git fetch origin db-backups && git checkout origin/db-backups -- .
cat karting-YYYY-MM-DD.dump.gz.part-* | gunzip -c | sqlite3 karting.db
```
