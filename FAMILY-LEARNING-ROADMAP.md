# OpenMAIC 家庭学习二次开发

首页保留一个问答入口，支持文字、语音和拍照。教材和联网来源由系统判断。课程继续使用 OpenMAIC 的课件、场景、测验和编辑器。孩子在同一个应用里从问问题进入练习，之后可从练习记录找到要重做的题。

## 源码清单

调研目录的 `source-inventory.json` 记录 26 个仓库的上游链接、固定提交和下载状态。本机位置是 `~/Documents/ChatGPT/学习项目/openmaic-research/`。其中 24 个下载了源码快照，PhET 的 Fraction Matcher 和 Fractions Intro 对应快照只有迁移说明。此前已做源码阅读，尚无各项目横向运行和性能数据。

| 方向 | 已下载的项目 |
| --- | --- |
| 问答入口与附件 | LibreChat、Open WebUI、LobeHub、Cherry Studio |
| 教学与课程 | DeepTutor、OpenTutor、Moodle、LearnHouse、Kolibri、MathBot、Celestin |
| 资料搜索与复习 | Open Notebook、Vane、GPT Researcher、Anki |
| 拍照识别 | RapidOCR、PaddleOCR、Pix2Text、Tesseract |
| 交互课件 | MAIC-UI、Khan Perseus、Mafs、JSXGraph、H5P Interactive Video |

## 迭代与验收

| 顺序 | 交付 | 源码依据与集成决定 | 验收 |
| --- | --- | --- | --- |
| 1 | 按组数数、即时判分、错题重做 | [DeepTutor 的答题处理](https://github.com/HKUDS/DeepTutor/blob/60fb3bdfddb30b7740c7ce3bd9b28d908f2af6db/deeptutor/services/session/turns/learning_adapter.py) 将答案绑定到题目，并对重复提交复用判分结果。[Perseus 的数字判分](https://github.com/Khan/perseus/blob/874f1a8bb4678411437be2d6fbdf844be0ef9271/packages/perseus-score/src/widgets/numeric-input/score-numeric-input.ts) 将判分与界面分开。使用 OpenMAIC 自有组件实现第一套练习，作答记录先放在浏览器。 | 从首页进入，也能从分组讲解直接打开练习。做错后刷新仍可重做，答对后从待重做清单移除，保留作答次数。手机和键盘均可完成。 |
| 2 | 学习记录和复习入口 | [Moodle 的作答模型](https://github.com/moodle/moodle/blob/afbcc55fa1bd80dcdd887b8965dd8c28c0f3bbda/public/question/engine/questionattempt.php) 分开记录题目和每次作答。沿用 OpenMAIC 的工作区和 PostgreSQL，接上学习者身份、近期记录及重做队列。 | 学习者之间隔离。同一提交重试只记录一次。刷新及跨设备重新登录后可见。 |
| 3 | 数轴、分数、函数 | [Perseus](https://github.com/Khan/perseus) 提供可独立评分的数学组件设计。[Mafs](https://github.com/stevenpetryk/mafs) 适合先验证可拖动的函数图形，JSXGraph 作为几何能力的备选。优先复用 OpenMAIC 已有交互渲染。 | 数轴和分数的正确答案由代码验证。拖动点和替代键盘操作都有反馈。函数图可直接从解释中打开。 |
| 4 | 拍照识别和定位题目 | 用 [RapidOCR](https://github.com/RapidAI/RapidOCR) 验证本机中文印刷题的识别与区域定位，对公式样本和现有视觉模型并行测量。只在数据表明有收益后接入识别服务。 | 用清晰、倾斜、模糊、多题与公式照片验证。清晰单题直接讲，只有多题或不清晰时才追问。记录首字耗时与识别错误。 |
| 5 | 教材与网页的自动检索 | 参考 [Open Notebook 的搜索 API](https://github.com/lfnovo/open-notebook/blob/cf536ca840fb7ce96371f6a42af3ad81d5513964/api/routers/search.py) 的资料范围和 [Vane 的 SearXNG 接入](https://github.com/ItzCrazyKns/Vane/blob/348feca3e378fb4157b217724ed508dc707f853f/src/lib/searxng.ts) 的搜索结果处理。扩展 OpenMAIC 已有资料库与搜索槽位。 | 教材问题命中正确资料，能打开对应出处。时效问题可引用网页。搜索失败时说明来源缺失。普通问题保持一次模型调用。 |
| 6 | 随年龄进阶与复习计划 | 覆盖小学到中学的难度与题型。积累稳定作答记录后，根据 [Anki 的 FSRS 调度](https://github.com/ankitects/anki/tree/9c539a036804130135eb55109868d8d9907a4e57/rslib/src/scheduler/fsrs) 评估复习间隔。 | 同一个主题能切换解释深度。记录不足时展示实际练习和错题。题库、评分和复习算法分别验证。 |

## 已验证的 OCR 预研

在 Apple Silicon Mac 上用 RapidOCR 3.7.0 和 ONNX Runtime 1.31.1 运行默认中文模型。使用 5 张 900 × 420 的合成中文题图，每张预热后重复 3 次取中位数。首次加载模型约 270 ms。

| 合成样图 | 中位耗时 | 观察 |
| --- | ---: | --- |
| 清晰中文印刷题 | 248 ms | 两行题干及数字可读 |
| 倾斜 9° 的题图 | 218 ms | 两行题干及数字可读 |
| 高斯模糊题图 | 177 ms | 本样例仍识别出题干 |
| 同页两道题 | 223 ms | 返回两行，可用于候选题目定位 |
| 分数与公式 | 181 ms | 将 `½ + ¼` 识别错了，普通斜杠分数可读 |

样本量仅 5 张，耗时仅覆盖本机 OCR。下一轮增加真实风格的阴影、折痕、手写和排版分数，分别统计文字、数字、数学符号和题目定位的错误。保留视觉模型通路，对置信度高但公式解析失败的题也走视觉模型。对 OCR 的采用门槛以端到端首字耗时和错误率共同判断。

本轮的练习功能独立开发，没有引入第三方代码或运行依赖。后续接入前按快照核对代码、模型及数据的许可。OpenMAIC 使用 MIT 许可证，GPL/AGPL 项目先用于研究产品流程和数据模型。

每轮在本机开发站验收。发布前备份课程和模型配置，正式站以独立 Docker 镜像验证，保持已有课程可读。将通过验证的改动提交到 GitHub 分支，沿用上游同步流程。
