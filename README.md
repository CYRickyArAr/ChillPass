# ChillPass

本地运行的 AI 学习助手：导入课件、提炼考点、生成学习关卡与小测，通过 Athena 侧边聊天答疑。

本仓库是在 [Koipoppy/ChillPass-Web](https://github.com/Koipoppy/ChillPass-Web) 基础上修改的版本，保留原项目归属说明。本仓库从当前版本独立记录提交历史；原项目历史请查看上游仓库。运行与存储方式以本页为准；其他语言的旧说明尚未同步。

## 下载后在本机使用（Windows）

1. 安装 **Node.js 22 或更新版本**（包含 npm），官网为 https://nodejs.org/。
2. 在本仓库选择 **Code → Download ZIP**，完整解压到一个可写目录。
3. 双击 **`Start-ChillPass.bat`**。
4. 首次启动自动下载依赖并构建应用，需要联网；成功后自动打开浏览器。以后未修改代码时跳过安装和构建。
5. 在设置中配置**自己的 API key**，再新建课程、导入自己的课件。

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
   ├─ conversations.json    Athena 会话和消息
   ├─ current-conversation.json
   ├─ athena.json           Athena 记忆与能力
   └─ backups/              迁移和修改前的备份
```

学习数据以硬盘为准；浏览器保留缓存和待保存队列。API key、主题等通用设置仍存于浏览器。原本只存在浏览器中的课件需通过存储设置里的迁移功能复制到硬盘。

切勿在提示“尚未保存”时关闭程序或清除浏览器数据。保存失败、版本冲突和损坏的数据不会被静默覆盖。备份不自动清理，会占用额外空间。

详见 [本地数据与恢复说明](docs/local-learning-data.md)。

## 主要功能

- 导入 PDF、Word、PPTX、TXT、Markdown。
- 生成考点、学习关卡、例题和小测，保存学习与答题进度。
- Athena 多会话、重命名、模型与思考设置、停止生成、编辑重发。
- 可调整宽度的侧边聊天，长会话分批加载。
- 课程切换、课件追加、错题本、本地数据备份。

AI 功能会将相关课件内容和问题发送给你配置的模型服务，需联网，可能产生该服务的 API 费用。“本地保存”不代表模型在本机离线运行。

## 更新

下载最新 ZIP，解压到新的程序文件夹，再运行 `Start-ChillPass.bat`。学习数据在用户文档目录，不随程序文件夹删除。使用原浏览器和访问地址可保留 API key 等设置。不要用旧 release 覆盖本仓库。

## 开发检查

```powershell
npm run build
npm run test:storage
```

存储测试使用 `output/` 下的隔离数据，不读取个人课件。便携 EXE 的 PDF 测试需显式提供测试 PDF 路径。

`.gitignore` 排除了依赖、构建结果、发布包、自动化截图、测试输出、本地数据与备份。提交前仍应检查是否误加了隐私文件。

原项目声明使用 MIT 许可证，相关版权和许可声明请继续保留。
