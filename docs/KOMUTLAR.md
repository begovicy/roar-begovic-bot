# ROAR v0.3 — Komutlar

108 ana komut; takma adlar ayrıca sayılmaz. Bütün komutlar slash değil, önek komutudur. Varsayılan önek `.`.

| Bot | Komut | Alternatifler |
|---|---|---|
| manager | `.yardım` | yardim, help, y |
| manager | `.ping` |  |
| manager | `.kurulum` | setup |
| manager | `.say` | server, sunucu |
| manager | `.avatar` | av, pp |
| manager | `.banner` |  |
| manager | `.profil` | profile, p |
| manager | `.afk` |  |
| manager | `.slowmode saniye` | slow |
| manager | `.sil 10` | temizle |
| manager | `.rol @üye rolID ver/al` |  |
| manager | `.ban @üye sebep` |  |
| manager | `.timeout @üye 10m sebep` | to |
| manager | `.unban` |  |
| manager | `.untimeout` | unto |
| manager | `.cezalar` | sicil |
| manager | `.renkpanel` |  |
| manager | `.odapanel` | özeloda, ozeloda |
| manager | `.git @üye` | go, izinligit |
| manager | `.çek @üye` | cek, pull, izinliçek, izinlicek |
| manager | `.cezaizin jail/cmute` |  |
| manager | `.jail @üye` | karantina, cezali |
| manager | `.mute @üye 10m sebep` | cmute, chatmute |
| manager | `.voicemute @üye 10m sebep` | vmute |
| manager | `.unjail` |  |
| manager | `.unmute` | uncmute |
| manager | `.unvmute` | unvoicemute |
| manager | `.forceban @üye sebep` |  |
| manager | `.unforceban kullanıcıID` |  |
| manager | `.ceza cezaNo` |  |
| manager | `.cezapuan` |  |
| manager | `.soncezalar` |  |
| manager | `.boosterpanel` | booster-panel |
| manager | `.key @üye isim` | kayıt, kayit, referans, k |
| manager | `.ysay` | yetkilisay |
| manager | `.tagsay` |  |
| manager | `.ses @üye` | nerede |
| manager | `.ship @üye` |  |
| manager | `.spotify` | spo |
| manager | `.emoji :özelemoji:` |  |
| manager | `.yaz metin` | write |
| manager | `.command @üye` |  |
| manager | `.uncommand @üye` |  |
| manager | `.özelkomut ekle ad rolID / sil ad / liste` | ozelkomut |
| manager | `.itirafpanel` |  |
| manager | `.memberpanel` | userpanel |
| manager | `.başvuru` | basvuru |
| manager | `.giveaway start 1h 1 Ödül / end / reroll / pause / unpause / edit / delete ID` | çekiliş, cekilis |
| manager | `.nuke` |  |
| manager | `.kilit kapat/aç` |  |
| manager | `.görev ekle @üye metin / tamamla ID / onayla ID / liste` | gorev |
| manager | `.ikonkur` |  |
| manager | `.booster` | boost |
| manager | `.banner-oluştur` | banner-olustur |
| manager | `.baninfo` |  |
| manager | `.aktivite` |  |
| manager | `.snipe` |  |
| manager | `.vip` |  |
| manager | `.url` |  |
| manager | `.tani` | tanı |
| manager | `.yasaklamalar` |  |
| manager | `.taşı` |  |
| manager | `.cezaişlemleri` | ceza işlemleri |
| manager | `.cezalartemizle` |  |
| manager | `.untimeoutall` |  |
| manager | `.unjailall` |  |
| manager | `.not` |  |
| manager | `.notlar` |  |
| manager | `.not-temizle` |  |
| manager | `.toplantıçağır` | yetkiliçağır |
| manager | `.kanal` |  |
| manager | `.rolbilgi` |  |
| manager | `.rolsay` |  |
| manager | `.sesli` |  |
| manager | `.emojilistele` |  |
| manager | `.stickeroluştur` |  |
| statistics | `.stat @üye 7` | me, stats |
| statistics | `.top` | sıralama |
| statistics | `.davet` | invites |
| statistics | `.davet-top` | topinvite |
| statistics | `.rollog` | rl |
| statistics | `.level` | lvl, seviye |
| statistics | `.ses-top` | sestop |
| statistics | `.mesaj-top` | mesajtop |
| statistics | `.yayın-top` | yayintop, topstreaming |
| statistics | `.kamera-top` | kameratop |
| economy | `.coin` | bakiye |
| economy | `.günlük` | gunluk, daily |
| economy | `.addbalance para @üye 1000` |  |
| economy | `.transfer @üye 100` | gönder |
| economy | `.mine 100` |  |
| economy | `.blackjack 100` | bj |
| economy | `.aviator 100` |  |
| economy | `.botmatik` |  |
| economy | `.tkm @üye 100` |  |
| economy | `.duello @üye 100` |  |
| economy | `.magaza` | mağaza |
| economy | `.satinaldiklarim` | satınaldıklarım |
| economy | `.doviz` | döviz |
| economy | `.iade işlemID` |  |
| economy | `.altinal 1` |  |
| economy | `.altinsat 1` |  |
| economy | `.cointop` | altıntop, altintop |
| guard | `.guardstatus` |  |
| guard | `.yedek` |  |
| guard | `.guardmode observe/enforce` |  |
| guard | `.yetki [olayID]` | yt, guardrestore |
| guard | `.yedek-plan yedekID` |  |

Giveaway start ücretsiz çekiliş başlatır. end bitirir; reroll önceki kazananlar dışından seçer; pause/unpause süreyi durdurur/devam ettirir; edit yalnız ödül metnini değiştirir; delete onay ister. Görevler manuel onaylıdır; otomatik terfi/ödül yoktur. Mağaza rolleri config.json ile tanımlanır. Daha fazla ayrıntı: README ve KAPSAM.md.
