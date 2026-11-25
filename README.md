# AI积分管家-优化版

> 本仓库为前端优化版：采用 **D · Bento 卡片流 · 移动优先** 布局与 UI 重设计，仅重构前端布局与视觉（`src/App.tsx` 布局层 + CSS），`src/core/` 数据、加密、同步与后端 / Tauri / 小程序逻辑与原版完全一致。

## 本次改版：八套全平台外观主题（A–H）

本仓库在原项目基础上完成**纯前端显示层**重构：后端接口、数据结构、加密、同步、Tauri / Capacitor 原生层以及小程序业务脚本均保持不变，只新增设计令牌、表面材质、响应式布局与动效。

| | 主题 | 视觉 | 交互 |
|---|---|---|---|
| A | 精准控制台 | 极简蓝 · 表格优先 | 克制过渡、快捷操作、清晰状态 |
| B | 暖白工作室 | 暖白陶土 · 大留白 | 柔和展开、沉静反馈、对话聚焦 |
| C | 暗夜指挥舱 | 深色高密度 · 多窗格 | 实时刷新、紧凑反馈、键盘优先 |
| D | 青屿轻卡片 | 自然青绿 · 圆润卡片 | 弹性按压、底部导航、触控友好 |
| E | **极光琉璃（默认）** | 极光渐变 · 分层玻璃 | 光影追随、弹性弹层、流动进度 |
| F | 极简流光 | 纯净浅色 · 精细描边 | 共享过渡、悬浮预览、磁性反馈 |
| G | 星舰 HUD | 深空界面 · 精密刻度 | 扫描光效、实时脉冲、指令面板 |
| H | 数字杂志 | 编辑排版 · 纸感层次 | 章节转场、阅读进度、细节展开 |

- **设置页切换**：Web / 桌面 / 手机端在「设置 → 界面主题」用带缩略图的卡片即时切换；小程序在「设置 → 界面外观」切换，并同步联动导航栏、底部标签栏与窗口背景色。选择仅保存在本机，不影响任何业务数据。
- **覆盖范围**：Web 页面、Docker 镜像内的静态页面、桌面客户端（Tauri）、安卓 / iOS（Capacitor WebView）、微信小程序（原生 WXML/WXSS），以及桌面菜单栏迷你窗。
- **明暗模式**：C / E / G 使用固定深色画布；其余主题继续响应「跟随系统 / 浅色 / 深色」。关闭「动态效果」或系统开启「减少动态效果」时自动停用视差、光斑与弹性动画。
- **实现位置**：`src/uiThemes.ts`（主题目录）、`src/theme-gallery.css`（Web 令牌与画廊）、`src/App.tsx`（设置面板与挂载）、`miniapp/theme.wxss` + `miniapp/utils/providers.js`（小程序令牌与切换 API）。所有页面组件与业务数据完全共用，未新增或改动任何接口。
- **验证**：`npm run build`（`tsc -b && vite build`）通过；`npm test` 87 个测试文件 / 937 个用例全部通过。
- **CI 说明**：本仓库发布时所用凭据不含 `workflow` 权限，GitHub Actions 配置以 `.github/workflow-templates/` 模板形式完整保留；需要自动构建 / Pages 部署时，在仓库网页端把模板移回 `.github/workflows/` 即可。这不影响任何运行、构建与主题功能。

---

# AI 魔方（AI Credit Manager）

统一管理你在各家 AI 平台的**积分、额度、用量与 API Key** 的合规工具。

> **仓库**：https://github.com/Andre-xue/ai-credit-manager
> **线上演示**：https://andre-xue.github.io/ai-credit-manager/
> **Docker 镜像**：`docker compose up -d` → http://localhost:8081

## Docker 版（容器运行）

本项目 Web 版可完全运行在 Docker 容器中，镜像仅约 78 MB（多阶段构建 + nginx）。

```bash
# 方式一：docker compose（推荐）
docker compose up -d --build
# 访问 http://localhost:8081

# 方式二：纯 docker 命令
docker build -t ai-credit-manager:latest .
docker run -d --name ai-credit-manager -p 8081:80 --restart unless-stopped ai-credit-manager:latest
```

- 健康检查：`curl http://localhost:8081/health` 返回 `ok`
- 更新：[见下方"GitHub 实时更新"](#github-实时更新)

> **数据说明**：本应用为本地优先架构，所有账户/额度/密钥数据保存在**浏览器 localStorage**，容器不持久化任何用户数据。因此容器可随时删除重建，数据不会丢失；但换浏览器/设备需通过「导出/导入」迁移。容器本身无状态，无需挂载数据卷。

## GitHub 实时更新

推送到 `main` 分支后，GitHub Actions 会自动：
1. 运行 62 个单元测试 + 构建 + Docker 冒烟测试（CI）
2. 构建 Web 版并部署到 GitHub Pages（免费静态托管）

仓库已在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions** 启用 Pages 自动部署。此后每次 push 都会实时更新线上版本。

## 一、在我的电脑上运行（最简单）

**前置条件**：安装 Node.js 20 或以上（[https://nodejs.org](https://nodejs.org)，选 LTS 版，一路下一步即可）。只需安装一次。

**Mac 用户**：打开 Finder，进入 `ai-credit-manager` 文件夹，**双击 `start-mac.command`**。
- 首次运行会自动安装依赖（约 1 分钟），随后自动打开浏览器，地址是 `http://localhost:5173`。
- 若提示"无法打开，因为来自身份不明的开发者"：右键该文件 →「打开」→ 弹窗点「打开」即可（仅需一次）。
- 使用完毕后，关闭弹出的终端窗口即停止服务。

**Windows 用户**：进入 `ai-credit-manager` 文件夹，**双击 `start-windows.bat`**，浏览器会自动打开 `http://localhost:5173`。

**手动命令方式**（任意系统，在项目目录打开终端）：

```bash
npm install     # 首次运行需要
npm run dev     # 启动，然后浏览器访问 http://localhost:5173
```

> 数据保存在浏览器本地存储中，同一个浏览器地址访问即可看到之前的数据。清除浏览器站点数据会清空记录，重要数据请用顶栏「导出」备份为 JSON。

**其他端**：桌面 App（Mac/Windows 独立程序）、安卓、微信小程序、iOS 的构建方式见下方「快速开始」。

### 各平台安装包下载（GitHub Releases）

**八套 UI 主题改版安装包** → https://github.com/Andre-xue/ai-credit-manager-optimized-ui/releases/tag/v0.1.431-ui

| 平台 | 文件名 | 说明 |
|------|--------|------|
| macOS Apple Silicon | `macOS-arm64-UI8-themes.dmg` | M1/M2/M3/M4，已校验 CRC32 |
| Web 静态版 | `Web-UI8-themes.zip` | 解压后用任意静态服务器打开，全平台浏览器可用 |
| Docker 镜像 | `Docker-image-UI8-themes.tar.gz` | `docker load -i` 后运行，含完整八套主题 |
| Android | `Android-UI8-themes.apk` | Debug 版，安装时选"允许未知来源" |
| 校验清单 | `SHA256SUMS-ui.txt` | 下载后用 `shasum -a 256 -c` 校验 |

原项目（旧 UI）的历史安装包仍保留在 https://github.com/Andre-xue/ai-credit-manager-optimized/releases/latest ，包含 Windows `.msi`/`.exe`、Linux `.AppImage`/`.deb`、macOS Intel 版。这些平台的**八套主题新版**可在启用 `.github/workflow-templates/` 中的 CI 后由 GitHub Actions 自动编译。

**关于 iOS**：Apple 要求所有 iOS 应用必须签名才能在真机安装，签名需要加入 Apple Developer 计划（$99/年）。因此无法提供可直接安装的 IPA。可选方案：
1. **自行编译**（免费）：在有 Xcode 的 Mac 上 `cd android && npx cap add ios && npx cap sync ios && npx cap open ios`，用免费开发者账号签名后安装到自己的设备
2. **TestFlight 分发**：加入开发者计划后走 App Store Connect 分发给测试者
3. **使用 Web 版**：把 `http://localhost:8081`（Docker）或 Pages 线上地址添加到 iPhone 主屏幕，体验接近原生 App


> **定位说明**：本工具管理的是你**自己账户**的资源。所有数据本地优先存储；签到仅做提醒并跳转官方页面，由你本人登录完成领取。工具**不模拟登录、不自动领取、不共享凭证、不抓取私有接口**，因此可通过各应用商店与小程序审核。

## 功能

- **积分额度看板**：集中查看各账户剩余额度、使用进度、重置时间，支持手动录入或官方只读 API 查询。
- **用量预测与耗尽提醒**：基于近期额度快照或用量记录，按日均消耗速度预测"约 N 天后耗尽"，并分健康/警告(≤7天)/告急(≤3天)三级提示。录入满 2 次即可预测。
- **AI Agent 工具（签到）**：国内外 34 款主流 AI Agent 一览，每款含官方 logo（本地存储、离线可用）、中英文名、功能分类、一句话定位与官方直达链接。按**国内 / 海外**分区、每区再分**可签到领积分（15 款）/ 暂无签到机制（仅免费额度）**两组；可签到工具标注签到入口与奖励规则（如 WorkBuddy「Buddy 加油站」每日 100 积分、豆包电脑版每日 200 额度），一键跳转官方页并手动标记完成，看板与侧栏同步显示今日待签到数。支持名称搜索与地区筛选。**桌面端智能跳转**：点击跳转会先检测本机是否已安装该工具客户端（卡片显示「本机已装」），已装则直接唤醒本地 App，未安装则打开官网；网页端直接打开官网。区分口径严格：仅官方确有「每日签到 / 登录领积分」才算可签到，免费层、试用、每日免费额度归为无签到。本工具不模拟登录、不自动领取，规则以各平台实时页面为准。
- **API Key 管理**：AES-256-GCM 加密，PBKDF2（210k 次）派生密钥，密文仅存本地。点击「解锁」弹出选择窗口（指纹或密码，按设置只显示一种），成功后页面内所有 Key 明文展示；**点眼睛弹出完整明文窗口并可一键复制**。余额旁有官方刷新按钮——支持用量 API 的平台（OpenAI/Anthropic）可即时拉取官方余额；无公开 API 的平台（DeepSeek/硅基流动/Kimi 等）需在官方页查看后手动录入。**设置 → 安全** 可修改主密码（自动重新加密所有密钥）、重置保险箱、切换解锁方式。52 个平台（覆盖主流 AI 服务）自动填充官方 API 地址；平台选择弹窗支持搜索 + 按 9 类模型功能筛选（文本大模型/编程助手/图像生成/视频生成/语音音频/搜索研究/设计工具/嵌入向量/其他）。删除账户会级联清除其额度/用量/签到等全部关联数据，所有模块实时刷新。备注用 `[分类] 说明` 可下拉筛选；支持分页（每页 3 条，额度看板为 6 条）与多选批量操作。导入/导出仅在本页提供。
- **用量与费用**：本地记录用量、估算费用、预算预警、近 14 天趋势。
- **设置中心**：统一管理签到提醒、耗尽预警阈值（1/3/7/14/30 天）、默认额度单位、每月预算、密钥保险箱、备份提醒、数据导入导出与清空、数据概览。所有设置保存在本地并向后兼容旧版本存档。
- **福利中心**：聚合 14 个平台公开的免费层/试用/教育优惠信息，按"全部/仅我的平台"筛选，标记本人已处理并跳转官方页面。工具只提供公开信息与官方链接，**不自动领取、不模拟登录**。具体额度以官方实时公告为准。
- **系统通知**：签到与额度告警主动提醒（桌面走系统通知、Web 走浏览器通知），每日每类最多一次；支持免打扰时段与手动测试。设置中开启。
- **跨平台价值归一化**：把不同单位的剩余额度按可校准的单价折算成人民币"资源总估值"；费用页新增按平台消费结构分析与单价校准表（默认值为参考，请按实际账单调整）。
- **云同步（可选登录）**：在「设置 → 云同步」用微信扫码 / 手机号验证码 / 邮箱验证码 / WorkBuddy 账号登录，登录后同一账号在 Web、桌面、安卓端的数据（账户、额度、签到、用量、设置及加密密钥密文）自动同步；不登录则完全本地使用。多端解锁密钥需使用同一主密码。
- **AI 助手**：独立的「AI」模块，用平台免密钥大模型做流式对话（类 WorkBuddy 聊天界面），可切换 14 个模型、中止生成、快捷提问。桌面端排首位，移动端 / Docker / 小程序排导航正中。对话历史仅存本机，不参与云同步。
- **语音朗读**：AI 回复可一键朗读，用系统内置语音（离线、零下载、不占存储），多种音色与语速可选。方言音色（粤语/四川话/上海话/东北话）需配置第三方 TTS 代理后下载；本地同时只保留一个音色文件，切换时自动删除旧文件并提示。
- **模型分类联动**：添加账户时备注写死为下拉（通用型/生图型/视频型/对话型/本地型，按官方用途选）；AI 页模型下拉旁增设分类下拉（含文本型），两级联动，数据源为你在 API Key 管理页保存的账户。选中自己的账户即用其 Key 真正调用（对话走 OpenAI 兼容接口，生图走 images，视频尽力提交异步任务；桌面端走本地代理绕跨域）。默认仍可用平台免费模型；对话型还支持「AI 语音通话」模式。
- **附件上传**：AI 助手 + 号可添加附件——桌面为文件/照片/视频，手机为相机/相册/文件。相机/相册首次使用会请求系统权限，授权后才打开；图片可随消息发给支持视觉的模型分析。安卓构建自动注入相机/相册/存储权限。
- **引擎联动与推理等级**：顶部选平台（API 管理页添加的模型账户，通用型只展示自有账户）后，右侧面板列出该平台真实可用引擎——优先用该账户 Key 调 `/v1/models` 实时拉取，失败时回退到内置目录（Kimi K3.1/K3、DeepSeek V4.1、Qwen4、GLM4.6 等当前主流模型），按 token 参考倍率从低到高排序；底部推理等级 Off/Low/High/Max 映射到 reasoning_effort，悬停/点选有中文说明。倍率为参考值，实际计费以官方账单为准。
- **解锁隔离（全平台一致）**：API Key 管理页的「解锁」只作用于该页（明文展示密钥），不影响其他功能。AI 助手调用自有模型完全独立：指纹/人脸模式自动解密，纯密码模式在 AI 页内一次性输入主密码（本次会话记住），永不提示"先去 Key 管理页解锁"。手机端设置页提供系统指纹/人脸快捷解锁入口，验证通过后直接进入并解锁 Key 管理页。
- **应用更新**：设置 → 应用更新。桌面端用 Tauri 官方 updater 自动检查/下载/安装，完成后一键重启生效；安卓端下载最新 APK 覆盖安装；Docker 版检测新版后给出可一键复制的 `docker pull/stop/rm/run` 命令（在终端执行，自动替换实例、保留数据卷）；微信小程序用官方 `getUpdateManager()` 自动下载并提示重启。
- **网络兼容**：桌面端的所有对外调用（平台用量、自有模型 API、平台免费大模型）均走本地 Rust 代理，绕过 WebView 跨域限制。

## 项目结构

```
ai-credit-manager/
├── src/                 # 核心 Web 应用（React + TS + Vite）
│   ├── core/            # 共享核心：数据模型 / 加密 / 存储 / 适配器
│   └── data/providers.ts# 14 个平台官方目录（官方链接）
├── miniapp/             # 微信小程序（原生，查询/提醒版）
├── desktop/src-tauri/   # 桌面端 Tauri 配置（Mac / Windows / Linux）
└── android/             # 安卓端 Capacitor 配置（也可 build iOS）
```

## 快速开始

### Web 版（可立即运行）

```bash
cd ai-credit-manager
npm install
npm run dev        # 开发预览 http://localhost:5173
npm run build      # 生产构建，产物在 dist/
npm test           # 运行 27 个核心逻辑单元测试
```

> 测试覆盖：CSV 解析（英文/中文表头、引号字段、BOM/CRLF、异常值）、状态存取与合并去重、密钥保险箱（加密解密往返、错误密码拒绝、主密码校验）。

### 桌面端（Mac / Windows）

前置：安装 [Rust](https://rustup.rs) 与系统构建工具（macOS: Xcode CLT；Windows: VS Build Tools + WebView2）。

```bash
cd ai-credit-manager/desktop
npm install
npm run tauri dev    # 开发（热更新）
npm run tauri build  # 生成 .dmg / .msi
```

Tauri 配置在 `desktop/src-tauri/tauri.conf.json`，`beforeBuildCommand` 会自动构建前端，无需手动执行。产物位置：

- **macOS**：`desktop/src-tauri/target/release/bundle/macos/*.app`；dmg 在 `bundle/dmg/`（若 Tauri 的 `hdiutil` 脚本在新版 macOS 报错，可手动执行：
  ```bash
  cd desktop/src-tauri/target/release/bundle
  STAGE=/tmp/acm-stage && rm -rf $STAGE && mkdir -p $STAGE
  cp -R "macos/AI Credit Manager.app" "$STAGE/" && ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "AI 魔方" -srcfolder "$STAGE" -ov -format UDZO "AI Credit Manager_0.1.0_aarch64.dmg"
  ```
  ）
- **Windows**：`desktop/src-tauri/target/release/bundle/msi/*.msi`

> **macOS 首次打开提示"无法验证开发者"**：右键 .app →「打开」→ 弹窗点「打开」即可。要彻底消除提示需加入 Apple Developer 计划做签名与公证（可选，不影响本地使用）。
>
> 本机已内置完整图标集（`desktop/src-tauri/icons/`），CSP 已放行内联样式与官方 API 域名；如修改 `tauri.conf.json` 的 `csp`，注意保留 `ipc:` 与 `'unsafe-inline'`，否则界面会白屏或代理失效。

### 安卓端

前置：Android Studio + JDK 17 + Android SDK。

```bash
cd ai-credit-manager/android
npm install
npm run sync         # 构建 Web 并同步到原生工程
npm run open         # 在 Android Studio 打开
npm run build        # 构建 APK
```

### iOS 端

在同一 `android/` 目录的 `package.json` 中追加 `@capacitor/ios`，然后：

```bash
npx cap add ios
npx cap sync ios
npx cap open ios      # 用 Xcode 打开，配置签名后 Archive
```

### 微信小程序

1. 打开微信开发者工具 → 「导入项目」 → 选择 `miniapp/` 目录。
2. 填入你自己的 AppID（或使用测试号）。
3. 编译预览；上传前在 `project.config.json` 中替换为真实 AppID。

> 小程序为**轻量查询/提醒版**：不含 API Key 加密保险箱（小程序不适合存密钥）；支持添加账户后随时点「编辑额度」更新或清除额度；不做任何自动化外部操作，以确保符合平台审核规范。

## 数据来源与合规边界

| 方式 | 说明 | 适用 |
|------|------|------|
| 官方只读 API | 桌面端经 Rust 后端代理（域名白名单）绕过 CORS；Web 端直连可能受 CORS 限制。需 Admin Key | OpenAI、Anthropic 等 |
| 官方页面跳转 | 复制/打开官方用量或签到页，本人登录后查看与领取 | 全部平台 |
| 手动录入 | 无公开 API 的平台，用户自行查看后录入 | 豆包、Kimi、Cursor 等 |
| 账单导入 | 预留，CSV 导入用量 | 后续版本 |

明确不做：模拟登录、破解私有接口、自动点击签到、代领积分、上传/共享用户凭证。

## 桌面端 API 代理（Tauri）

`desktop/src-tauri/src/lib.rs` 注册了 `proxy_usage` 命令：

- **域名白名单**：仅允许 OpenAI、Anthropic 的官方用量端点，不接收任意 URL，防止被用作开放代理（SSRF）。
- **仅只读 GET**：发送 `Authorization: Bearer <Key>` 到官方域名，不做任何写操作、不执行领取。
- **不落盘凭证**：Key 仅内存传递，命令执行完即释放；不写日志、不持久化。
- 前端 `src/core/adapters.ts` 自动检测运行环境：桌面端走 `invoke('proxy_usage')`，Web 端走 `fetch`。

## 用量录入

- **手动录入**：用量与费用页点「手动添加记录」，填写账户、日期、Tokens、估算费用、模型。
- **CSV 导入**：支持表头 `date, account, inputTokens, outputTokens, cost, model`（兼容中文表头），按账户名称自动匹配已有账户；可下载模板。
- **额度录入**：看板卡片点刷新图标，填写总额度、已用、单位与重置日期，带实时进度预览。
- **多格式导入导出**（均在「API Key 管理」页）：
  - **导出**：点「导出」弹窗选择 4 种格式 —— `JSON 完整备份`（可完整导回）、`账户 CSV`、`额度 CSV`、`用量 CSV`。CSV 带 BOM、Excel 可直接打开，文件名带格式与日期。所有格式都不含密钥。
  - **导入**：点「导入」选择文件，自动识别格式（扩展名 + 表头 + 内容，兼容中英文列名）：
    - JSON 备份 → 「合并/覆盖」确认
    - 账户 / 额度 / 用量 CSV → 预览弹窗，确认后追加（不删除已有内容）
    - **第三方 API 服务清单**（数组格式，字段 `name/api/apiBase/note/model/modelCategory/quota/kid`）→ 专用预览弹窗：自动映射平台、`modelCategory` 归一层 `[分类]`、同名多用途自动区分；**密钥用主密码 AES-256-GCM 加密后仅存本机**，明文绝不落盘；空密钥（本地服务）与重名项自动跳过
    - **导出什么格式就能导回什么格式**。

## 安全说明

- 密钥密文与派生盐仅存浏览器 `localStorage`（Web）或应用沙盒（桌面/App）。
- 导出 JSON **自动剔除**密钥字段与保险箱校验位。
- 主密码遗忘无法恢复密钥——这是有意设计，避免密钥被弱口令保护。
- 生产部署请使用 HTTPS；本地开发使用 localhost。

## 已内置平台（14）

OpenAI、Anthropic Claude、Google Gemini、DeepSeek、通义千问、Moonshot Kimi、豆包/火山方舟、智谱 GLM、Cursor、GitHub Copilot、Midjourney、Perplexity、ElevenLabs、Figma AI。

平台目录在 `src/data/providers.ts` 与 `miniapp/utils/providers.js`，可自行扩展（仅需官方 URL，无需任何私有接口）。

---

**免责声明**：本工具仅提供个人信息管理功能，不替代任何平台的官方服务，不承诺获取任何平台奖励。使用时应遵守各平台服务条款。
