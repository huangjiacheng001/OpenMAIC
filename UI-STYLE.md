# OpenMAIC 界面规范

以原生课堂的灰色工作区、白色内容面板和紫色交互为基准。问答、错题本、家庭记录、学习资料、课程库与课堂之间切换时，共用应用主题和控件语义。

## 颜色

颜色统一在 [app/theme.css](app/theme.css) 定义。[app/globals.css](app/globals.css) 把语义变量映射为 Tailwind 类。CSS 模块直接用 `var(--名称)`。

| 用途 | 颜色变量 |
| --- | --- |
| 页面与工作区 | `--background`、`--workspace` |
| 卡片、弹层与正文 | `--card`、`--popover`、`--foreground`、`--muted-foreground` |
| 主要操作 | `--primary`、`--primary-foreground` |
| 当前选项、链接与焦点 | `--primary-soft`、`--primary-text`、`--primary-edge`、`--ring` |
| 分隔线与输入框 | `--border`、`--input` |
| 完成、提醒、错误 | `--success`、`--warning`、`--destructive` 及相应的浅色背景 |

紫色用于可操作内容和当前选项。绿色用于成功反馈，琥珀色用于可处理的提醒，红色用于错误。状态同时提供可读文字。明暗模式沿用课堂设置，新颜色需要同时检查两种模式。照片裁剪遮罩也在主题文件集中维护。

## 公共组件

- 按钮和可操作链接使用 [Button](components/ui/button.tsx)。主要操作用默认变体，次要操作用 `outline`，返回和文字操作用 `ghost`。移动端主要操作用 `size="touch"`，链接用 `asChild`。
- 内容分区使用 [CardSection](components/ui/card.tsx)，已有通用卡片使用同文件的 `Card`。弹层用 [Dialog](components/ui/dialog.tsx)。页面样式保留宽度、滚动、间距和响应式布局。
- 主题切换使用全局 [ThemeProvider](lib/hooks/use-theme.tsx)。原生课堂、课程库和家庭学习页共享明暗模式设置。
- 课堂的课程画布、课件插图和互动内的学科配色跟随课程内容。围绕课件的导航、操作栏和弹层使用应用主题。

## 界面检查

在 320 px 和 390 px 宽度下检查主要入口、长标题、照片预览和课堂返回。确认明暗模式都能识别主按钮、选中项、禁用项和反馈，并用键盘检查焦点样式。跨页面切换后，检查主题和当前任务上下文能否恢复。
