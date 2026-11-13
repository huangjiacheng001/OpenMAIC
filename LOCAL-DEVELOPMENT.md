# OpenMAIC 本机开发

开发与部署分支是 `codex/local`，起点为 OpenMAIC 稳定版 `v1.4.2`。GitHub Fork 的 `main` 用于跟踪上游开发主线。原项目采用 MIT 许可证，见 [LICENSE](LICENSE)。

## 日常开发

在仓库根目录用 Node.js 22.19+ 和 Corepack 运行。Corepack 按 `package.json` 固定的版本启动 pnpm。

```sh
# 首次安装或依赖锁文件变化后运行
corepack pnpm install --frozen-lockfile

# 开发数据库启动一次后，重启开发服务器可以跳过这条命令
docker --context colima-openmaic compose --env-file .env.development.local \
  -p openmaic-dev-db -f docker-compose.db.yml up -d --wait postgres

corepack pnpm dev --hostname 127.0.0.1 --port 3001
```

在 <http://127.0.0.1:3001> 验证改动。开发服务器支持 Next.js Fast Refresh。本机复测发现，当前版本有时不会识别已保存的源码改动。遇到这种情况可重启开发服务器。修改通过 `dist/` 导出的工作区包时，运行 `corepack pnpm --filter <包名> dev` 监听编译（该包有 `dev` 脚本时），或运行 `corepack pnpm build:packages`。修改环境变量或模型配置后重启开发服务器。

本机开发数据库使用独立的 Compose 项目和数据卷，发布到 `127.0.0.1:5432`。Next.js 只在开发模式读取 `.env.development.local`，该文件同时提供开发数据库的密码和连接地址。开发模型配置位于 `.env.development.models.yml`。需要实测 AI 功能时，在开发站的模型设置中接入服务。使用正式站同样的模型时，开发站也需要自己的授权。

在开发站通过相关功能验证后，再运行正式版构建。改动相关的单测可用 `corepack pnpm exec vitest run <测试文件>`。

## 正式版构建

在这台 Mac 上用 `colima start openmaic` 启动已配置的 Docker 虚拟机，然后在仓库根目录执行：

```sh
# 首次部署时创建应用配置文件，已有文件可跳过。
[ -f .env.local ] || (umask 077 && touch .env.local)
docker --context colima-openmaic compose up -d --build
docker --context colima-openmaic compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

打开 <http://127.0.0.1:3000>。默认使用单用户模式，应用只监听本机，PostgreSQL 16 只在容器网络内访问。首次启动前，可在 Git 忽略的 `.env` 中设置只含字母数字的 `PERSISTENCE_POSTGRES_PASSWORD`。数据库卷初始化后，更换配置值还需要同步更改数据库角色密码。

这台 Mac 的 Colima 配置使用 4 核、9 GiB 内存和 24 GiB 虚拟数据盘。构建遇到 npm 下载慢时，可以在 Compose 命令前加 `NPM_REGISTRY=https://registry.npmmirror.com`。依赖安装仍使用上游的锁文件。

在网页模型设置中连接已有文本模型。在课程模型配置中，为课堂互动选择支持工具调用的模型。先跑通大纲、幻灯片、互动、测验和问答，再按需要启用语音、图片和视频。需要显式控制路由时，用 [openmaic.example.yml](openmaic.example.yml) 创建 `openmaic.yml`，通过 Compose 的本地覆盖文件挂载到 `/app/openmaic.yml`，并在 `.env.local` 中提供该配置引用的环境变量。[官方模型配置](packages/docs/content/docs/configuration.zh-cn.mdx)

## 二次开发入口

| 要改什么 | 源码位置 |
| --- | --- |
| 课堂大纲、页面类型与生成提示词 | [生成包](packages/@openmaic/generation/src)、[生成任务 API](app/api/generation-runs) |
| 教师和学生角色、课堂追问 | [编排](lib/orchestration)、[Agent 运行时](lib/agent-runtime)、[课堂聊天 API](app/api/chat) |
| 幻灯片渲染、编辑及数据结构 | [renderer](packages/@openmaic/renderer)、[editor](packages/@openmaic/editor)、[DSL](packages/@openmaic/dsl) |
| 课程库、学习状态和数据库变更 | [应用持久化](lib/persistence)、[storage](packages/@openmaic/storage) |

首个场景可用小学中文数学短课「按 2、5、10 个一组数数」做验收。让课程包含一页用实物分组讲解的幻灯片、一个可以切换组大小并手动分组的互动页，以及一道询问「5、10、15 后面是什么」的单选题。完成一次分组、提交答案，然后在课堂追问「为什么按 5 个一组数，个位在 5 和 0 之间交替？」。刷新后检查课程能重新打开。

## 同步上游稳定版

`origin` 指向自己的 GitHub Fork，`upstream` 指向 `THU-MAIC/OpenMAIC`。若从 GitHub 重新克隆，可用 `git remote add upstream https://github.com/THU-MAIC/OpenMAIC.git` 恢复上游配置。在工作区干净时从 `codex/local` 开一条升级分支，取 [官方 Releases](https://github.com/THU-MAIC/OpenMAIC/releases) 中审核过的稳定标签。把命令中的 `vX.Y.Z` 替换为目标标签：

```sh
git fetch upstream --prune --tags
git switch codex/local
git pull --ff-only origin codex/local
git switch -c codex/sync-vX.Y.Z
git merge refs/tags/vX.Y.Z
git push -u origin codex/sync-vX.Y.Z
```

升级前读发行说明，备份 PostgreSQL、应用数据卷和模型实例密钥。建议用独立 Compose 项目、端口和数据库卷验证升级，特别是带数据库迁移的版本。通过后，将升级分支合并到 `codex/local` 并重新构建部署。需要更新 Fork 的上游开发主线时，可在 GitHub 的 `main` 上使用 **Sync fork**。

GitHub 保存源码和提交历史。课程、媒体、模型设置及实例密钥需要另行备份。默认 Compose 使用 `openmaic-postgres` 和 `openmaic-data` 两个命名卷，实际名称带 Compose 项目前缀。正式站日常停机可用 `docker --context colima-openmaic compose stop`。

## 使用 ChatGPT 套餐额度

这是单人、仅本机监听的 Docker 部署。通过 OpenAI 官方的 [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) 授权 OpenMAIC 使用当前账号的套餐额度。它会在 ChatGPT 使用量页面显示为独立应用，但套餐额度与 Codex 共享。

1. 在运行的 Compose 项目根目录执行 `OPENMAIC_DOCKER_CONTEXT=colima-openmaic node scripts/connect-chatgpt-plan.mjs`。使用 Node.js 22.19 或更高版本。若 Docker CLI 不在 PATH，可设置 `OPENMAIC_DOCKER`。
2. 在系统浏览器完成 OpenAI 授权。脚本把连接凭据写入应用数据卷的 `data/chatgpt-plan.json`，并显示账号可用模型。删除凭据前，可在 [ChatGPT 用量设置](https://chatgpt.com/settings/usage) 管理此应用的额度或断开连接。
3. 在 `openmaic.yml` 配置下面的模型槽位，并按官方 Compose 注释将文件挂载到 `/app/openmaic.yml`。只使用授权脚本返回的模型。此前在网页保存过默认模型时，可在课程模型设置里清除覆盖，或使用 `lock: [llm]` 固定整个文本模型配置。
4. 重新构建和启动应用。若 Docker 需要宿主机的网络代理，使用本地 Compose 覆盖文件给应用设置 `HTTPS_PROXY` 和 `NODE_USE_ENV_PROXY=1`。运行授权脚本的宿主机如需代理，也可通过相同的 Node 环境变量启用已配置的代理。

```yaml
providers:
  chatgpt:
    preset: chatgpt-plan
    models: [gpt-6-luna, gpt-6.1-terra]
slots:
  llm: chatgpt:gpt-6-luna
  course.content.interactive: chatgpt:gpt-6.1-terra
  classroom: chatgpt:gpt-6.1-terra
  agent: null
lock: [llm]
```

这个连接提供课件生成和课堂文本问答。图片、视频和音频能力可用各自的模型服务单独配置。
