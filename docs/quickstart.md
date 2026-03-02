# Quickstart

## 1) Kurulum
```bash
npm install
```

## 2) Stack'i ayağa kaldır
```bash
cd infra
docker compose up --build
```

## 3) Rules yükle (opsiyonel ama önerilen)
```bash
curl -X POST http://localhost:4002/v1/projects/demo-project/rules \
  -H 'content-type: application/json' \
  -d '{"rules":[{"path":"/todos","auth":"required","ownerField":"ownerId","allow":true,"validation":{"title":{"required":true,"type":"string","maxLength":120}}}]}'
```

## 4) Demo
- http://localhost:5173 adresine git.
- Önce Sign Up veya Sign In.
- Todo ekle, realtime güncellemeyi izleyin.
