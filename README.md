# Iven Mini Games · 小游戏大厅

给 iPhone / iPad / 安卓做的小游戏大厅：网页直接玩，也能装成 App，全部游戏离线可玩；斗地主和太仓麻将可以在同一 Wi‑Fi 或通过蓝牙一起打。

| 游戏 | 说明 |
|---|---|
| Sobosuba 软体合成 | 珠链软体物理的数字合成，规则对照原作 |
| 斗地主 | 抢地主 / 叫分、炸弹翻倍、春天；记牌器、托管、语音报牌；3 档电脑 |
| 太仓麻将 | 152 张、28 花、翻财神、二花自摸三花冲、无花果、吃碰三口承包（规则整理见 [docs/taicang-mahjong-rules.md](docs/taicang-mahjong-rules.md)） |
| 植物大战僵尸、神庙逃亡 2 | 第三方游戏，**不在本仓库里**；网站上提供，App 第一次同步时下载 |

## 目录

```
index.html, core/          大厅（纯静态 ES module，无需打包）
core/net/                  联机：房间 / 断线重连 / 电脑补位（room.js）、Wi‑Fi + 蓝牙传输（transports.js）、大厅（lobby.js）
core/sync.js               App 离线同步：对比 sync-manifest.json，只下载变化的文件
games/<id>/index.js        每个游戏一个插件（registry.js 里注册）
native/                    Capacitor 8 的 Android / iOS 工程，见 native/README.md
tools/                     manifest 生成、测试（node --test tools/tests/*.test.mjs）、联机调试工具
```

## 本地运行

```bash
node server.mjs 8080            # 打开 http://localhost:8080
node --test tools/tests/*.test.mjs
```

在电脑浏览器里测试联机：地址后面加 `?netdebug=1`，开两个标签页，一个「创建房间」，一个「加入房间」。

## App

- 安卓：`cd native && npm ci && npm run apk`（Windows 上的工具链说明见 native/README.md）。签名 key 只在作者本机，不在仓库里。
- iOS：两个 GitHub Actions 工作流
  - **iOS unsigned IPA**：每次改动 `native/` 自动跑，产出未签名的 `.ipa`（Actions 页面的 Artifacts）。
  - **iOS TestFlight**：手动运行，自动签名并上传到 TestFlight。需要仓库 Secrets：`APPLE_TEAM_ID`、`ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_P8`，以及 App Store Connect 里 bundle ID 为 `cc.mcbar.minigames` 的 App。

联机用到的开源插件：[capacitor-tcp-socket](https://www.npmjs.com/package/capacitor-tcp-socket)、[@mhaberler/capacitor-zeroconf-nsd](https://www.npmjs.com/package/@mhaberler/capacitor-zeroconf-nsd)、[@capgo/capacitor-bluetooth-low-energy](https://www.npmjs.com/package/@capgo/capacitor-bluetooth-low-energy)。
