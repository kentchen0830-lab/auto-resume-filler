# Auto Resume Filler

一个面向校招 / 社招网申场景的 Chromium 浏览器扩展。它将结构化简历数据保存在浏览器本地，在招聘网站页面识别可填写字段，并提供自动匹配、人工确认填写和可选的 AI 辅助内容规划。

> 本仓库已移除个人简历、真实联系方式、账号信息和 API Key。`examples/resume.example.json` 仅包含虚构示例数据。

## 功能

- 结构化管理教育、工作、项目、获奖、证书、专利和技能等简历信息。
- 扫描当前页面可见、可编辑字段，识别栏目、重复记录和字段语义。
- 本地规则优先完成高置信度字段匹配与填写。
- 可选接入 DeepSeek API，对整页表单进行一次结构理解和内容规划。
- 对 AI 生成结果逐字段预览、编辑、勾选，确认后再写入网页。
- 对身份证、手机号、邮箱、住址、密码、验证码、Token/API Key 等字段进行敏感信息过滤。
- 不自动点击验证码、隐私协议或最终提交按钮。
- 支持导出填写规划 JSON，便于审计和复盘。

## 运行环境

- Microsoft Edge / Google Chrome 等 Chromium 浏览器
- Manifest V3
- Chromium 114+

## 安装

1. 下载或克隆本仓库。
2. 打开 `edge://extensions` 或 `chrome://extensions`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展程序”。
5. 选择仓库根目录。

## 使用

1. 打开扩展的“简历信息管理”，手动录入或导入结构化简历 JSON。
2. 打开招聘网站的简历/申请表单页面。
3. 使用侧边栏扫描页面，先检查自动匹配结果。
4. 如需 AI 辅助，在设置中填写自己的 DeepSeek API Key，并进行连接测试。
5. 对 AI 建议逐字段核对；只有用户确认的字段才写入网页。
6. 在招聘网站中再次人工检查，并由用户自行保存或提交。

可以从 `examples/resume.example.json` 开始制作自己的数据文件。请不要把真实简历 JSON、导出结果或浏览器配置提交到 Git 仓库。

## 隐私与安全

- 简历数据通过 `chrome.storage.local` 保存在本地浏览器环境，不会因为使用本项目而自动上传到本仓库。
- API Key 同样保存在扩展本地存储中；界面掩码不代表加密。不要在共享浏览器或不可信设备中保存真实 Key。
- AI 规划器会过滤常见个人敏感字段和值，但任何自动过滤都不能替代用户复核。
- 扩展需要读取招聘网页中的表单元素，因此具有较广泛的页面访问能力。只应在你信任的网站上启用和使用。
- 更详细的说明见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 项目结构

```text
.
├── manifest.json                 # Chromium 扩展清单
├── background.js                 # 打包后的后台逻辑
├── background-entry.js           # Service Worker 入口
├── ai-project-optimizer.js       # AI 整页结构规划与安全过滤
├── content-scripts/
│   ├── autofill.js               # 页面扫描 / 匹配 / 填写逻辑
│   └── ai-structure.js           # AI 页面结构扫描与写入
├── chunks/                       # 已构建的 UI bundle
├── assets/                       # UI 样式
├── icons/                        # 扩展图标
├── options.html                  # 简历信息管理页面
├── sidepanel.html                # 侧边栏
├── enhanced-sidepanel.js         # V3 AI 增强侧边栏
├── examples/
│   └── resume.example.json       # 完全虚构的示例数据
└── tests/
    └── smoke-test.js             # Playwright 冒烟测试
```

当前仓库保留了可直接加载的构建产物，因此部分 UI JavaScript 为压缩后的 bundle。后续如果继续开发，建议逐步恢复为完整的 `src/` + 构建流程，以便贡献和审查。

## 开发与测试

需要 Node.js 20+：

```bash
npm install
npx playwright install chromium
npm run check
npm test
```

测试覆盖页面字段语义识别、重复字段 ID、受控输入框填写、AI 越权字段过滤、批量结果校验以及扩展页面加载等基本场景。

## AI 配置

默认 AI 服务地址为 `https://api.deepseek.com`。API Key 由用户自行提供，本仓库不包含任何真实 Key。

如果你修改 AI Provider，请同步检查：

- HTTPS 与允许的 API 地址；
- 请求中是否包含敏感字段；
- 错误日志是否会泄漏 Token；
- 模型输出是否经过 JSON 结构和字段白名单校验。

## 使用边界

本项目用于个人效率工具、浏览器自动化学习和求职表单辅助。使用者应遵守目标网站的服务条款、隐私规则及当地法律法规。项目不设计为绕过验证码、风控、访问控制或自动批量提交申请。

## License

MIT License。详见 [LICENSE](LICENSE)。
