# OpenMAIC 本机开发

开发与部署分支是 `codex/local`，起点为 OpenMAIC 稳定版 `v1.4.2`。GitHub Fork 的 `main` 用于跟踪上游开发主线。原项目采用 MIT 许可证，见 [LICENSE](LICENSE)。

## 启动与配置

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

日常改代码可以用 Node.js 22.19+ 和 pnpm 10。运行 `pnpm install`、`pnpm db:up`，参照[部署指南](packages/docs/content/docs/deployment.zh-cn.mdx)配置独立的开发数据库，再用 `pnpm dev --port 3001` 运行开发服务器。开发服务读取仓库根目录的 `.env.local`，如需同时运行 Compose 实例，可用仅对开发命令生效的 `DATABASE_URL` 连接开发数据库。

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

GitHub 保存源码和提交历史。课程、媒体、模型设置及实例密钥需要另行备份。默认 Compose 使用 `openmaic-postgres` 和 `openmaic-data` 两个命名卷，实际名称带 Compose 项目前缀。日常停机使用 `docker compose stop`。
