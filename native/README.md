# 小游戏大厅 · 原生 App 外壳（Capacitor 8）

把仓库根目录的静态站点（`index.html` + `core/` + `games/` …）打包成 Android / iOS App。
网站本身不改；本目录只负责「拷贝网页 → 原生工程 → 安装包」。

- appId / Bundle ID：`cc.mcbar.minigames`，名称：小游戏大厅
- Capacitor 8.6.3（Android：compileSdk/targetSdk 36，minSdk 24；iOS：15.0+，Swift Package Manager，无需 CocoaPods）
- 版本号唯一来源：`native/package.json` 的 `"version"`（versionName / CFBundleShortVersionString）和 `"versionCode"`（versionCode / CFBundleVersion）

## 目录

| 路径 | 作用 |
|---|---|
| `package.json` / `.npmrc` | 依赖与 npm 脚本（`.npmrc` 设 `legacy-peer-deps`，避免装 zeroconf 插件仅 Electron 用的 `bonjour`） |
| `capacitor.config.json` | appId、webDir=`www`、背景色、iOS `contentInset: never`、SystemBars 安全区 |
| `scripts/vendor-entry.js` → `../core/vendor/capacitor.js` | esbuild 打成单个 ESM（Capacitor 运行时 + 全部插件代理），网页里 `import('./core/vendor/capacitor.js')` |
| `scripts/build-www.mjs` | 生成 vendor → 清空重建 `www/` → 拷贝 `listSiteFiles()` → 写 `www/sync-manifest.json` → `cap sync` → 同步 iOS 版本号 |
| `scripts/build-apk.mjs` | build-www → `gradle assembleRelease/Debug` → `dist/minigames-<版本>.apk` |
| `scripts/gradle.mjs` / `toolchain.mjs` | 用项目自己的 JDK 21 / SDK / 代理跑 Gradle，不依赖全局环境变量 |
| `scripts/gen-assets.mjs` | 从 `../assets/icon.svg` 生成 Android 图标（含自适应图标）/启动图、iOS 图标/启动图（sharp） |
| `scripts/env.ps1` / `env.sh` | 只对当前终端生效的 JAVA_HOME / ANDROID_HOME / PATH / 代理参数 |
| `scripts/build-ios-unsigned.sh` | Mac 上出未签名 IPA |
| `android/` `ios/` | 原生工程（已定制，需提交）；`www/`、`dist/`、`node_modules/` 不提交 |
| `android/app/dev-signing.keystore` + `android/keystore.properties` | 开发签名 key 和密码，**只在本机，不进 git**（务必备份），见「签名」 |
| `../.github/workflows/ios-unsigned.yml` | GitHub Actions 云端出未签名 IPA |

## 工具链（本机 Windows，已装好）

全部装在 `C:\Users\frankniubi\dev\`，**没有改任何全局设置/环境变量**：

- `dev\jdk-21` — Temurin 21.0.13.1+2
- `dev\android-sdk` — cmdline-tools 22.0、platform-tools 37.0.3、platforms;android-36、build-tools 35.0.0、emulator 37.3.10、system-images;android-36;google_apis;x86_64
- `dev\android-avd\minigames-api36` — 测试用模拟器（Pixel 7，API 36）
- Gradle 8.14.3 由 wrapper 下载到默认的 `%USERPROFILE%\.gradle`

所有外网访问都走 `http://127.0.0.1:2080`（npm 已配置；脚本自动给 Gradle 加 `-Dhttp(s).proxyHost/Port`）。
换机器或不用代理：设置 `MINIGAMES_PROXY=none`；JDK/SDK 在别处：设置 `MINIGAMES_JAVA_HOME` / `MINIGAMES_ANDROID_HOME`。

从零重装 SDK（参考）：

```powershell
. .\scripts\env.ps1
mg-sdkmanager --licenses        # 在 Git Bash 里用：yes | mg_sdkmanager --licenses
mg-sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

## Android：在 Windows 上出 APK

```powershell
cd native
npm ci                 # 第一次或依赖变化后
npm run apk            # = build-www + cap sync android + gradle assembleRelease + 复制 APK
# 产物：native\dist\minigames-1.0.0.apk（release，已用开发 key 签名，可直接安装）
npm run apk:debug      # 产物：native\dist\minigames-1.0.0-debug.apk（可 chrome://inspect 调试 WebView）
```

首次构建要下载 Gradle 和依赖（约 4 分钟），之后约 1 分钟。分步命令：

| 命令 | 说明 |
|---|---|
| `npm run vendor` | 只重建 `core/vendor/capacitor.js` |
| `npm run www` / `www:android` / `www:ios` / `www:nosync` | 重建 `www/` 并 `cap sync`（全部 / 单平台 / 不同步） |
| `npm run android:release` / `android:debug` | 只跑 Gradle（不重建 www） |
| `npm run assets` | 改了 `assets/icon.svg` 后重新生成图标与启动图 |
| `npm run version:sync` | 把 package.json 的版本写进 iOS 工程（build-www 会自动做） |
| `npm run open:android` | 用 Android Studio 打开（先 `. .\scripts\env.ps1`） |

手动用 gradlew / adb：

```powershell
cd native ; . .\scripts\env.ps1          # PowerShell（注意前面的点）
mg-gradlew assembleRelease
adb install -r dist\minigames-1.0.0.apk
```

```bash
cd native && source scripts/env.sh       # Git Bash
mg_gradlew assembleDebug
```

### 升级版本

改 `native/package.json`：`"version": "1.0.1"`、`"versionCode": 2`（每次要覆盖安装的新包都必须 +1），再 `npm run apk`。

### 签名

Android 只装已签名的包，且**升级必须同一把 key**。所以 debug 和 release 都用 `android/app/dev-signing.keystore`
（RSA 2048，有效期至 2056 年，SHA-256 `DE:25:57:15:A8:AA:31:01:9C:33:50:44:85:A6:36:96:55:25:2B:17:C2:4F:92:56:A2:FC:C6:B8:D6:AC:F1:1C`）。
这把 key 和 `android/keystore.properties` 只在本机（不进 git），要另外备份；丢了以后的包就无法覆盖安装旧版本。

以后换正式 key：`npm run android:release -- -PMINIGAMES_STORE_FILE=... -PMINIGAMES_STORE_PASSWORD=... -PMINIGAMES_KEY_ALIAS=... -PMINIGAMES_KEY_PASSWORD=...`
（或同名环境变量）。注意：换 key 后用户必须先卸载旧版。

### Android 定制一览

- `AndroidManifest.xml`：网络安全配置 `res/xml/network_security_config.xml`（允许明文 HTTP：`minigames.mcbar.cc` + 局域网 IP）；
  权限 INTERNET、ACCESS_NETWORK_STATE、ACCESS_WIFI_STATE、CHANGE_WIFI_MULTICAST_STATE、BLUETOOTH/BLUETOOTH_ADMIN/ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION（均 maxSdkVersion=30）、
  BLUETOOTH_SCAN（neverForLocation）、BLUETOOTH_ADVERTISE、BLUETOOTH_CONNECT、WAKE_LOCK（插件另带 VIBRATE）；`bluetooth_le` 非必需。屏幕方向不锁，游戏运行时用 ScreenOrientation 插件锁。
- 启动页：Android 12+ 用系统 Splash（自适应图标 + `#FFF8F2`）；7–11 用 `drawable/splash.xml`（纯色 + 居中图标，不拉伸）。
- 内置插件 `AppBridge`（`android/app/src/main/java/cc/mcbar/minigames/AppBridgePlugin.java`，在 `MainActivity` 注册）：
  - `copyBundledWeb({ to })` → `{ files, bytes }`：把 APK 里的 `assets/public` 递归复制到绝对目录 `to`（也接受 `file://` URI），后台线程，覆盖已有文件。模拟器实测 1400 个文件 / 201.6 MB 约 2 秒。
  - `getLocalIp()` → `{ ip }`：IPv4，优先 wlan*，其次热点（ap*/swlan*/softap*），再其他网卡；没有则 `null`。
  - iOS 没有实现（调用会以 UNIMPLEMENTED 拒绝）。

## iOS：Mac 或 GitHub Actions 出未签名 IPA

Windows 上不能编译 iOS；`ios/` 工程已在 Windows 上生成并 `cap sync` 完毕（SPM 的 `ios/App/CapApp-SPM/Package.swift` 已列出全部 10 个插件）。

**Mac 本地**（需要 Xcode 26+ 与 Node 20+）：

```bash
cd native
npm ci
bash scripts/build-ios-unsigned.sh     # = npm run ios:unsigned
# 产物：native/dist/minigames-unsigned.ipa（Payload/App.app）
```

**GitHub Actions**：把整个项目推到 GitHub，Actions → “iOS unsigned IPA” → Run workflow（或推送 `native/**` 自动触发），
完成后在运行页面下载 artifact `minigames-unsigned-ipa`。

未签名 IPA 不能直接装到 iPhone，需要用自己的 Apple ID 重签（AltStore / Sideloadly 等）或在 Xcode 里配置 Team 后直接 Run。

iOS 定制：Bundle ID `cc.mcbar.minigames`、显示名 小游戏大厅、1024 图标（不透明）、启动图；`Info.plist`：
ATS 例外 `minigames.mcbar.cc`（允许 HTTP、含子域名）+ `NSAllowsLocalNetworking`、`NSBluetoothAlwaysUsageDescription`、
`NSBluetoothPeripheralUsageDescription`、`NSLocalNetworkUsageDescription`、`NSBonjourServices = [_ivenhall._tcp]`、
iPhone/iPad 四个方向全开、`UIRequiresFullScreen = false`。未加 `UIBackgroundModes`（后台蓝牙需要时再加 `bluetooth-central` / `bluetooth-peripheral`）。

## 网页里怎么用（`core/vendor/capacitor.js` 导出）

`Capacitor, registerPlugin, CapacitorHttp, Filesystem, Directory, Encoding, FileTransfer, App, ScreenOrientation, StatusBar, Style,
Haptics, ImpactStyle, KeepAwake, BluetoothLowEnergy, TcpSocket, DataEncoding, ZeroConf, WebView, AppBridge`

在普通浏览器里 import 也不会报错（插件走 web 实现或返回 UNIMPLEMENTED），用 `Capacitor.isNativePlatform()` 判断。

## 离线同步相关的关键事实（详见交付报告）

- `WebView.setServerBasePath({ path })`：Android/iOS 都要**绝对文件路径（不要 `file://`）**；会重新加载到起始页 `https://localhost/`（Android）/ `capacitor://localhost/`（iOS），hash 路由会丢，sessionStorage 保留。
- `persistServerBasePath()` 后下次启动自动沿用；**装新版本 App（versionCode/versionName 变化）会自动清掉**，回到内置网页。
- Android 启动时若目录不存在会自动回退到内置网页；**iOS 不检查，且只用路径最后一段并固定拼到 `Library/NoCloud/ionic_built_snapshots/<名字>`，目录或其中 index.html 缺失会直接 `exit(1)` 闪退**。所以 iOS 的同步副本必须放在 `Library/NoCloud/ionic_built_snapshots/` 下，持久化前确认 index.html 已写好，删除旧副本前先切回内置。
- 大文件下载用 `@capacitor/file-transfer` 的 `downloadFile({ url, path })`，`path` 用 `Filesystem.getUri()` 得到的 `file://` URI；`Filesystem.downloadFile` 已废弃。
- `Filesystem.copy` 复制目录是递归的，但目标的父目录必须已存在、目标目录不能已存在（Android 实测）。
- Android 本地服务：`.glb` 没有 Content-Type（XHR/fetch 读 ArrayBuffer 无影响）；Range 返回 206 且从请求的起点开始，但会一直读到文件末尾（对媒体的开放区间请求没问题）。

## 常见问题

- **npm 偶发 `ECONNRESET`**：代理抖动，重试即可。
- **全局 `~/.gradle/gradle.properties` 指定了别的 JDK**：脚本用命令行 `-Dorg.gradle.java.home=dev\jdk-21` 覆盖，不改那个文件。
- **sdkmanager**：故意用 cmdline-tools **22.0**；23.0 的 sdkmanager 会把新的 “Android CLI” 自动下载安装到 `~/.android`（约 320 MB）。
- **Capacitor CLI 遥测**：`scripts/cap.mjs` 给子进程设 `CI=1`，不弹提示也不发送遥测。
- **控制台 `Error injecting safe area CSS`**：Capacitor SystemBars 在页面创建前注入一次失败，已被捕获，页面提交后会重新注入，可忽略。
- Gradle 守护进程构建后会常驻一段时间：`mg-gradlew --stop` 可立即结束。
