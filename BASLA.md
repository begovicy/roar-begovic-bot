# ROAR 7 BOT SİSTEMİ

## BAŞLATMA

```powershell
pm2 delete all
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

## 7 BOT

1. roar-voucher
2. roar-manager
3. roar-main
4. roar-economy
5. roar-statistics
6. roar-guard
7. roar-moderation

## TEST

Discord'da:
- `.ping` - Bot latency
- `.p0` - Raw ping
- `.status` - Manager status

## LOG

```powershell
pm2 logs roar-manager --lines 50
```
