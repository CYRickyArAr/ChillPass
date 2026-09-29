# ChillPass Windows 桌面版

## 使用与数据

运行 `ChillPass-Setup-0.2.0.exe`，按向导安装。开始菜单与桌面快捷方式打开的是独立窗口，不启动外部浏览器。无需单独安装 Node.js。当前安装目标为 Windows x64；其他平台未验证。

桌面程序沿用 `%USERPROFILE%\.chillpass\config.json` 记录的数据目录，缺省为 `%USERPROFILE%\Documents\ChillPass`。课程、答题、错题及 Athena 对话以 `_chillpass-data` 中的文件为准，格式不变。重装、升级和默认卸载不主动删除该目录。

桌面设置、API Key、主题、浏览器式文件缓存和未保存队列放在 `%APPDATA%\ChillPass Desktop`。它们与 Chrome/Edge 的缓存相互独立，密钥没有跨端自动迁移，也不承诺由本应用加密存储。首次打开桌面版需重新配置 API Key。

从网页版迁移时：

1. 在原浏览器等待学习数据保存完成；若有 IndexedDB 课件，先通过存储设置迁移到硬盘。
2. 关闭网页版，避免两个版本同时编辑同一数据目录。
3. 打开桌面版，确认课程与进度，然后重新配置厂商、密钥与模型。
4. 不要先清空原浏览器数据；确认迁移完成前保留旧副本。

关闭窗口前，主进程会要求页面提交待保存数据，成功后才退出；保存错误或确认超时会保留窗口。断电、强制结束进程等不能保证完成保存，请保留桌面配置目录中的待保存队列。长 AI 任务可能在下次启动按原有恢复逻辑继续。

## 架构与权限

- Electron 主进程：`desktop/main.cjs`，原生窗口、单实例、目录选择、退出保存确认与更新检查。
- 最小预加载桥：`desktop/preload.cjs`，只暴露指定窗口操作，不暴露 Node、文件系统、任意 IPC 或命令执行。
- React 界面继续复用原文件与学习数据适配器，使用稳定地址 `chillpass://app/`，重启后不会因为端口变化丢失设置。
- 原 Node 数据服务嵌入主进程，监听随机的 `127.0.0.1` 端口；每次启动随机令牌，未经认证的请求返回 403。令牌不传给页面。关闭程序也关闭服务，不留浏览器启动器/托盘进程。
- 渲染进程开启 sandbox、contextIsolation、webSecurity，禁用 nodeIntegration 和 webview。外部 HTTP(S) 链接交给系统浏览器，其他外部协议拒绝打开。
- 桌面协议只允许明确列出的 API 和构建静态资源。旧 `/api/startUpdate` 不可访问。
- AI 仍通过用户配置的网络服务生成内容，会发送相关课程材料并产生服务商费用，并非离线模型。

## 本地开发与打包

```powershell
npm ci
npm run desktop
npm run desktop:pack
npm run desktop:dist
```

`desktop` 当前运行构建后的页面；修改前端后需重新运行。`npm run dev` 仍是原浏览器开发模式，不会自动打开 Electron。

打包配置：`desktop/builder.cjs`。输出：

- `release/desktop/ChillPass-Setup-<版本>.exe`：交给最终用户的安装包。
- `release/desktop/win-unpacked/ChillPass.exe`：免安装目录中的启动文件，不能单独拿出来分发，必须连同整个目录。

打包采用文件白名单，不包含个人课件、密钥、测试输出、配置和备份。包含构建后的前端、桌面壳和本地存储服务。首次下载 Electron、NSIS 工具等需要联网。上游项目信息见打包附带的 README。

构建脚本不会自动上传 GitHub，也不会给当前电脑自动安装此应用。版本由 `package.json` 与 `package-lock.json` 管理；当前桌面初版为 `0.2.0`。未配置签名证书时安装包没有可信发布者签名，Windows 可能提示“未知发布者”或 SmartScreen。公开分发建议先完成签名与人工安装验收，不要把构建成功当作完成所有产品验收。

## 更新发布

桌面版读取仓库 `CYRickyArAr/ChillPass` 的最新正式 GitHub Release，只认更高的 `v主版本.次版本.补丁` 标签及 `ChillPass-Setup-*.exe` 附件。源码 ZIP、预发布和没有桌面安装包的 Release 都不会触发桌面升级。

新版本发布流程：递增版本 → 构建与测试 → 签名/安装验收 → 手动上传对应安装包到正式 Release。用户点击下载后由浏览器下载，保存并关闭软件后手动运行安装包。目前不做自动覆盖升级、增量升级或自动回滚。

## 回归测试

```powershell
npm run test:updates
npm run test:desktop
```

桌面冒烟脚本使用开发依赖 `playwright` 和项目自带的 Electron，不需要另外下载 Chromium。使用隐藏窗口，不截图、不调用付费模型。测试数据及桌面缓存放在 `%USERPROFILE%\.pi\agent\tmp` 下的专用随机目录，结束后清理；可设置 `CHILLPASS_SMOKE_ROOT` 改变位置。

验证打包后的 EXE：

```powershell
$env:CHILLPASS_DESKTOP_EXE = (Resolve-Path 'release/desktop/win-unpacked/ChillPass.exe').Path
npm run test:desktop
Remove-Item Env:CHILLPASS_DESKTOP_EXE
```

测试专用的 `CHILLPASS_DESKTOP_PROFILE` 与 `CHILLPASS_CONFIG_DIR` 用于隔离配置，正常使用无需设置。不要对真实课件目录运行破坏性测试。
