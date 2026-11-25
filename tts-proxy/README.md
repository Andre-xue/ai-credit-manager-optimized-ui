# 声音克隆代理 · 阿里云函数计算（FC）部署指南

把代理部署成阿里云函数计算的 **HTTP 函数**，App 的「语音配置 → 第三方语音服务配置」填这个函数的 HTTPS 地址即可。API Key 只存在云端，不进 App、不进聊天记录。

**两个代码文件，按运行时二选一（不要都传）：**

| 你选的运行时 | 用哪个文件 | 说明 |
|---|---|---|
| **自定义运行时 / Python 3.10**（控制台常见默认，需启动命令+监听端口） | **`app.py`** ✅ 推荐 | 自带 HTTP Server，启动命令 `python3 app.py`，端口 `9000`，纯标准库无需依赖 |
| 内置运行时 / Python 3.10（WSGI，入口 `index.handler`） | `index.py` | 仅当创建函数时选的是内置运行时才用 |

## 前置条件

1. 阿里云账号（已实名），开通 **百炼 Model Studio** 和 **函数计算 FC**，地域都选 **华北2（北京）**。
2. 在百炼拿到两样东西：
   - **API Key**：`sk-` 开头（百炼控制台 → API-Key 管理）。
   - **Workspace ID**：业务空间 ID，形如 `ws-xxxx` 或 `llm-xxxx`——就是 API Key 页面「复制并发 Base URL」里域名最前面那段（如 `https://ws-j09...cn-beijing.maas.aliyuncs.com` 中的 `ws-j09...`）。
3. 确认百炼已开通声音复刻模型（默认 `cosyvoice-v3.5-flash`，创建音色免费）。

## 部署步骤（FC 3.0 控制台 · 自定义运行时）

1. 进入 **函数计算 FC** 控制台，地域切到 **华北2（北京）**；左侧走「函数管理 → 函数列表」，点 **创建函数**。
2. 创建函数：类型选 **Web 函数 / HTTP 函数**，运行时选 **自定义运行时 / Python / Python 3.10**。
3. 代码上传选 **使用示例代码**；模式选 **命令模式**，启动命令 `python3 app.py`，监听端口 `9000`。
4. 创建完成后进入函数详情 → **代码** 页，删除示例的 `app.py`，把本目录 **`app.py`** 的全文粘贴进去，部署。
5. 进入 **配置 → 环境变量**，添加三个变量：

   | 变量名 | 值 | 说明 |
   |---|---|---|
   | `DASHSCOPE_API_KEY` | `sk-你的key` | 百炼 API Key |
   | `WORKSPACE_ID` | `ws-xxx`（可留空） | 业务空间 ID；**建议先留空**走通用域名，跑通后再填专属域名 |
   | `TARGET_MODEL` | `cosyvoice-v3.5-flash` | 可选，默认即此值 |

   另外把函数的 **执行超时时间** 从默认 60 秒改成 **120 秒**（创建音色要轮询审核状态，避免超时）。
6. 保存并部署。函数详情里会给出一个 **HTTP 触发器公网地址**，形如：
   `https://xxxx.cn-beijing.fcapp.run`
7. 用浏览器访问 `https://xxxx.cn-beijing.fcapp.run/clone`（GET 也行）应返回 JSON（含 error 也正常，说明函数在跑）。

## App 端配置

1. 打开 App → **语音配置** → 展开 **第三方语音服务配置**。
2. 服务商选 **阿里云百炼 CosyVoice / Qwen3-TTS**。
3. 端点填函数地址（**不要带 /clone 等路径，结尾不要斜杠**）：
   `https://xxxx.cn-beijing.fcapp.run`
4. 保存。
5. 在「声音克隆」区录音或导入音频（WAV/MP3/M4A，10~20 秒、清晰人声），点「克隆为 AI 发音」。
6. 成功后 AI 回复会用克隆音色朗读。

## 手机端能不能用

**能。** 手机 App 和桌面端连的是同一套接口：只要云函数有公网 HTTPS 地址，两端填同一个端点即可。声音样本在各自设备本地录制/导入，克隆出的 voiceId 保存在各自设备。注意：

- 两端是不同设备各自克隆的 voiceId（本机独立），不互相同步；想共用可把 voiceId 记下来，但 App 目前手动填 voiceId 的入口有限，简单起见各端各克隆一次即可。
- 手机端「录音 8 秒」依赖系统录音授权；录不了就用「选择音频文件」导入一段 WAV/MP3。

## 常见问题

- **提示未配置环境变量**：检查第 5 步三个变量是否填全、函数名入口是否为 `index.handler`。
- **403 / 鉴权失败**：API Key 与 Workspace ID 必须是同一地域（北京）；北京和新加坡的 Key 不通用。
- **音色状态超时**：样本质量不行或含噪声，换一段 10~20 秒干净朗读重录；也可在百炼控制台看音色状态。
- **费用**：创建 CosyVoice 音色免费；合成按字符计费（flash 约 ¥0.8/万字符），新账号有约 90 天免费额度。函数计算个人每月有免费调用额度，低频使用基本不花钱。

## 安全说明

- API Key 只作为函数环境变量，App 不持有，聊天与备份都不包含它。
- 函数 URL 是公开的（CORS `*`）。若担心被他人盗用产生费用，可在 FC 上给 HTTP 触发器加访问鉴权（如自定义 header token），并在 App 端配置里加一个可填 token 的字段——当前版本未内置该字段，需要的话可后续补。

---

## 火山引擎声音复刻（provider=volcengine，v0.1.87+）

同一份 `app.py` 已支持火山引擎，通过请求里的 `provider` 字段自动分派：
- `provider=aliyun` 或留空 → 阿里云百炼（原逻辑，需 `DASHSCOPE_API_KEY`）
- `provider=volcengine` → 火山引擎（需 `VOLC_APP_ID` + `VOLC_ACCESS_TOKEN`）

App 端在「语音配置 → 第三方语音服务配置」里把 **provider 选 volcengine**、端点填这个函数的地址即可，克隆/合成链路与百炼完全一致。

### 火山开通与配置

1. 火山引擎控制台开通 **豆包语音 → 声音复刻 2.0** 服务（新用户有免费额度：15 次训练 + 20000 字合成）。
2. 在「API Key 管理」拿到 **APP ID** 和 **Access Token**。
3. 给云函数追加环境变量（原有百炼变量可保留，互不影响）：

   | 变量名 | 值 | 说明 |
   |---|---|---|
   | `VOLC_APP_ID` | 你的 APP ID | 必填 |
   | `VOLC_ACCESS_TOKEN` | 你的 Access Token | 必填 |
   | `VOLC_CLONE_ENDPOINT` | `https://openspeech.bytedance.com/api/v1/vc/submit` | 可选；音色训练端点，火山接口调整时改这里 |
   | `VOLC_TTS_ENDPOINT` | `https://openspeech.bytedance.com/api/v1/tts` | 可选；语音合成端点 |
   | `VOLC_TTS_CLUSTER` | `volcano_icl` | 可选；合成集群，按你开通的服务填 |

4. 重新部署函数，App 端 provider 选 `volcengine` 即可克隆与合成。

> 注意：火山声音复刻有多个产品形态（豆包语音 HTTP API / RTC TrainTTSVoiceType 等），端点与请求体各不相同。本实现采用豆包语音 `vc/submit` + `tts` 的通用结构，并通过上面两个 `*_ENDPOINT` 环境变量做成可配置——若你的控制台给出的端点/字段不同，改环境变量或按文档调整 `app.py` 里 `_volc_create_voice` / `_volc_synthesize` 的 payload 即可，无需改 App。**本分支无密钥环境，未做真实 API 联调，请开通后按实际返回校准。**
