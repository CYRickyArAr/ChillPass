# ChillPass

本地运行的 AI 学习助手：导入课件、提炼考点、生成学习关卡与小测，通过 Athena 侧边聊天答疑。

本仓库是在 [Koipoppy/ChillPass-Web](https://github.com/Koipoppy/ChillPass-Web) 基础上修改的版本，保留原项目归属说明。本仓库从当前版本独立记录提交历史；原项目历史请查看上游仓库。运行与存储方式以本页为准；其他语言的旧说明尚未同步。

## 下载后在本机使用（Windows）

1. 安装 **Node.js 22 或更新版本**（包含 npm），官网为 https://nodejs.org/。
2. 在本仓库选择 **Code → Download ZIP**，完整解压到一个可写目录。
3. 双击 **`Start-ChillPass.bat`**。
4. 首次启动自动下载依赖并构建应用，需要联网；成功后自动打开浏览器。以后未修改代码时跳过安装和构建。
5. 在设置中配置**自己的 API key**，或选择 **ChatGPT → Continue with ChatGPT** 授权套餐使用，再新建课程、导入自己的课件。

运行期间保留启动窗口，按 `Ctrl+C` 停止。默认地址是 `http://localhost:5174`。请先退出占用同一端口的旧 ChillPass。

首次准备可能需要几分钟。本仓库不依赖作者电脑上的课程文件或浏览器缓存，也不需要下载旧 release。

### 终端启动

```powershell
npm ci
npm run build
npm start
```

开发时使用 `npm run dev`。不要用静态网页服务器或 `npm run preview` 代替正常启动：学习数据需要项目提供的本地后端。

## 数据属于使用者自己

仓库**不包含作者的课件、课程、学习进度、聊天记录、API key 或个人备份**。新电脑首次运行是空的学习环境；已有 ChillPass 数据的电脑会读取本机数据，不主动清空。

默认数据目录为当前 Windows 用户的 `Documents\ChillPass`，可在设置中修改：

```text
ChillPass/
├─ 课程名称/                 原始课件
└─ _chillpass-data/
   ├─ courses.json           课程、考点、关卡、学习进度
   ├─ quiz-progress.json     答题记录
   ├─ wrong-questions.json   错题
   ├─ conversations.json    按课程分组的会话、消息与独立记忆
   ├─ current-conversation.json
   ├─ athena.json           模型偏好与旧全局记忆/技能归档
   └─ backups/              迁移和修改前的备份
```

学习数据以硬盘为准；浏览器保留缓存和待保存队列。API key、主题等通用设置仍存于浏览器。原本只存在浏览器中的课件需通过存储设置里的迁移功能复制到硬盘。

切勿在提示“尚未保存”时关闭程序或清除浏览器数据。保存失败、版本冲突和损坏的数据不会被静默覆盖。备份不自动清理，会占用额外空间。

详见 [本地数据与恢复说明](docs/local-learning-data.md)。

## 主要功能

- 导入 PDF、Word、PPTX、TXT、Markdown。
- 生成考点、学习关卡、例题和小测，保存学习与答题进度。
- Athena 按课程分组的多会话、会话独立记忆、重命名、模型与思考设置、停止生成、编辑重发。
- 可调整宽度的侧边聊天，长会话分批加载。
- 课程切换、课件追加、错题本、本地数据备份。

AI 功能会将相关课件内容和问题发送给你配置的模型服务，需联网，可能产生该服务的 API 费用。“本地保存”不代表模型在本机离线运行。

## ChatGPT 套餐登录（OAuth）

点击侧栏 **设置** 会直接打开设置窗口，不离开当前课程或对话。顶部包含常规、模型、存储、关于；常规选项即时生效，模型配置在底部统一保存。关闭或切换分类时，未保存的模型配置会提示确认。

在 **设置 → 模型 → ChatGPT** 点击 **Continue with ChatGPT**，在 OpenAI 授权页完成登录，返回后启用所需模型、设置默认模型，点击 **设为当前服务商 → 保存**。支持保存多个账号注册、切换账号、重新授权、自动刷新令牌与退出登录。现有 API Key 服务商不受影响。

模型页左侧选择服务商，右侧编辑连接、查看用量和筛选模型。点击“添加服务商”会弹出可搜索的分类选择窗口（自定义、订阅服务、API Key），仅列出实际支持的接入方式。模型开关决定 Athena 菜单中的可选模型；全部关闭后，该服务商不会继续发起模型请求。编辑其他服务商不会自动切换当前计费通道；需要显式设置为当前服务商并保存。API Key 服务还支持手动添加模型 ID，高级余额脚本默认折叠。

**OpenCode Go**：在“添加服务商 → 订阅服务”选择 OpenCode Go，填入套餐 API Key 后刷新模型目录。默认地址为官方文档当前列出的 `https://opencode.ai/inference/go/v1`，不是 Zen 按量计费地址；默认模型 `glm-5.3-flash`。推理通过本机 `/api/opencode-go/*` 转发到固定的官方 Go 地址，解决浏览器跨域预检限制；不会将密钥发到任意用户指定网址，更新后需要重启本地服务。根据 [Go 文档](https://opencode.ai/docs/go/) 为已收录模型分别适配 Chat Completions、Responses、Anthropic Messages 三种请求与流式响应；目录会过滤尚未适配协议的模型，避免用错误的请求格式。是否允许套餐超额后扣除 Console 余额由 OpenCode 控制台设置决定，本应用不自行切换到 Zen。

服务商图标统一用于添加弹窗、设置列表和主界面选择器，内置品牌 SVG 随应用离线打包，使用主题色适配深浅模式；无对应品牌的自定义服务商显示名称首字。图标来自 `@lobehub/icons-static-svg` 1.95.1（MIT），授权说明随构建包含在 `public/notices/lobehub-icons.txt`。

主界面左上角的 ChatGPT 余量按钮直接显示 **Codex 当前工作区的订阅额度**，不是 ChillPass 专属用量。悬停可查看完整时间窗口、重置时间、积分、可用重置次数和数据来源。此前直接将套餐 OAuth 令牌发往 `wham/usage` 会被访问控制拒绝（`no_matching_rule`）；[CC Switch](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/subscription.rs) 使用的是 Codex 授权，不能混用两类令牌。

本项目改为调用**官方 Codex CLI 的 `app-server` stdio 协议**（`account/read`、`account/rateLimits/read`），由官方客户端处理凭据、刷新、账号请求头和额度接口。不会读取或复制 Codex 令牌、借用 client ID、发起模型调用、兑换重置次数或切换 ChillPass 的模型计费通道。

- 首次使用：安装官方 `@openai/codex`，执行 `codex login` 登录与 ChillPass 相同的 ChatGPT 账号；在左上角点击“连接 Codex 额度”并确认。已安装登录的用户无需重复安装。
- 每次查询都核对账号；服务端提供工作区 ID 时还会绑定工作区。账号不一致、工作区变化或登录失效时停止展示，避免串用其他账号额度。
- 在设置 → 模型 → ChatGPT 中可“停止读取额度”；这不会退出本机 Codex。
- CLI 必须在 PATH 中；特殊安装可用 `CHILLPASS_CODEX_PATH` 指定官方原生可执行文件的绝对路径。Windows npm 安装会自动解析原生二进制文件。
- 更新本地后端后需重启 ChillPass。缺失的窗口、积分或重置次数均视为未知，不伪造为零。

- 使用官方开源应用动态注册、PKCE 和本机 `127.0.0.1` 回调，不借用 Codex 等应用的 client ID。
- 通过官方 Responses API 进行 Athena 对话和学习内容生成；使用账号实时模型目录，不保证所有套餐、地区或模型都可用。额度不足或权限受限时不会自动切换 API 计费。
- 登录凭据位于 `~/.chillpass/chatgpt/credentials.dat`（可通过 `CHILLPASS_CONFIG_DIR` 指定根目录）。Windows 使用当前用户 DPAPI 加密；其他系统使用用户专属权限文件。凭据不进入浏览器存储或学习数据导出。
- 退出时尝试撤销远程会话并清除本机令牌，保留账号注册与主机 ID。若远程撤销失败，界面会提醒在 ChatGPT 设置中断开应用。
- 仅允许本机访问。需要 Node.js 后端；`npm start` 和 `npm run dev` 均支持，静态部署和 `npm run preview` 不支持。请不要同时运行多个实例进行授权或刷新。
- 若异常退出留下 `credentials.lock`，确认所有 ChillPass 实例已关闭后再删除该锁文件；不要删除或分享凭据文件。

参考：[OpenAI 开源应用接入文档](https://developers.openai.com/siwc/token-sharing-open-source)。自动化测试使用模拟 OpenAI 服务，不代替真实账号授权验收。

## 更新

下载最新 ZIP，解压到新的程序文件夹，再运行 `Start-ChillPass.bat`。学习数据在用户文档目录，不随程序文件夹删除。使用原浏览器和访问地址可保留 API key 等设置。不要用旧 release 覆盖本仓库。

程序启动后会检查 GitHub 仓库 `package.json` 中的版本号；发现更高版本时仅提示下载源码 ZIP，不会自动安装或覆盖文件。也可在“设置 → 关于”手动检查。每次发布新版源码时须递增 `package.json` 与 `package-lock.json` 的版本号，否则旧版不会提示更新。

## 开发检查

```powershell
npm run build
npm run test:storage
npm run test:updates
npm run test:chatgpt
node --test scripts/model-preferences.test.cjs
```

存储测试使用 `output/` 下的隔离数据，不读取个人课件。便携 EXE 的 PDF 测试需显式提供测试 PDF 路径。

`.gitignore` 排除了依赖、构建结果、发布包、自动化截图、测试输出、本地数据与备份。提交前仍应检查是否误加了隐私文件。

原项目声明使用 MIT 许可证，相关版权和许可声明请继续保留。
