# Security Policy

## Sensitive data

不要在 Issue、Pull Request、Discussion 或代码示例中提交：

- 真实 API Key / Token / Cookie；
- 密码、验证码、身份证或护照信息；
- 真实手机号、私人邮箱、家庭住址；
- 包含上述信息的完整简历 JSON 或浏览器 Profile。

如果秘密已经提交到 Git 历史，请立即在对应服务中撤销/轮换，而不是仅删除最新版本文件。

## Design safeguards

项目包含以下防护思路：

- 敏感字段名和标签黑名单；
- 常见敏感值正则脱敏；
- AI 输出严格 JSON 解析；
- 允许字段白名单和 field ID 校验；
- Prompt Injection 常见模式清理；
- 不自动提交最终申请。

这些措施降低风险，但不能保证对所有网站和输入都有效。

## Reporting

发现安全问题时，请优先通过 GitHub 的私密安全报告功能（若仓库已启用）联系维护者，不要公开发布可直接利用的密钥或个人数据。
