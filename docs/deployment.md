# Deployment Guide

## Collector (Backend)

### Server
- **Host**: Oracle VPS `150.230.157.143`
- **User**: `ubuntu`
- **SSH key**: `~/.ssh/id_github`
- **Process manager**: PM2
- **App path**: `/home/ubuntu/collector/`
- **DB path**: `/home/ubuntu/collector/data/karting.db`
- **Port**: 3001

### Deploy Collector
```bash
# Copy files to server
scp -i ~/.ssh/id_github collector/src/storage.js collector/src/index.js \
  collector/src/poller.js collector/src/parser.js \
  ubuntu@150.230.157.143:/home/ubuntu/collector/src/

# Restart
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 restart collector"

# Verify
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "curl -s localhost:3001/healthz"
```

### Deploy only specific files
```bash
scp -i ~/.ssh/id_github collector/src/storage.js \
  ubuntu@150.230.157.143:/home/ubuntu/collector/src/storage.js
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 restart collector"
```

### Check logs
```bash
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 logs collector --nostream --lines 20"
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 logs collector --nostream --lines 10 --err"
```

### PM2 commands
```bash
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 list"
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 restart collector"
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 stop collector"
```

## Frontend

### Netlify
- Auto-deploys from `main` branch
- Build: `npm run build`
- Publish: `dist/`
- SPA redirects configured in `netlify.toml`

### Environment Variables (Netlify)
```
VITE_COLLECTOR_URL=http://150.230.157.143:3001
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_ADMIN_TOKEN=...
```

### Local Development
```bash
cd karting
npm install
npm run dev    # → localhost:5173
```

Local `.env` file:
```
VITE_COLLECTOR_URL=http://150.230.157.143:3001
VITE_FIREBASE_API_KEY=AIzaSyAvAJNn-KUfMC10Msa5ChJ9aJBsMIlVSQc
VITE_FIREBASE_AUTH_DOMAIN=ekarting-92ce9.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ekarting-92ce9
```

## Collector Environment Variables
Set on server in PM2 ecosystem or env:
```
PORT=3001
CORS_ORIGIN=*
ADMIN_TOKEN=<secret>
```
