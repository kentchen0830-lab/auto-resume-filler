# Security Policy

## Sensitive data

不要在 Issue、Pull Request、Discussion 或代码示例中提交真实 API Key / Token / Cookie、密码、验证码、身份证或护照信息、真实手机号、私人邮箱、家庭住址，或包含这些内容的完整简历 JSON / 浏览器 Profile。

如果秘密已经进入 Git 历史，请立即在对应服务中撤销或轮换，而不是只删除最新版本文件。

## Design safeguards

项目包含敏感字段名和标签过滤、常见敏感值脱敏、AI 输出 JSON 结构校验、允许字段白名单、field ID 校验、常见 Prompt Injection 清理，并保留“人工确认后填写、用户自行最终提交”的边界。

这些措施降低风险，但不能保证对所有网站和输入都有效。
