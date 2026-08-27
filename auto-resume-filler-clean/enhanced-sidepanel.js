(() => {
  "use strict";

  const state = {
    pageStructure: null,
    jobDescription: "",
    plan: null,
    fields: [],
    warnings: [],
    fillResult: null
  };

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setStatus(message, type = "info") {
    const status = document.getElementById("ai-v3-status");
    if (!status) return;
    status.className = `ai-v3-status ${type}`;
    status.textContent = message;
  }

  function setBusy(busy) {
    document.querySelectorAll("#ai-v3-card button").forEach((button) => {
      if (busy) {
        button.dataset.wasDisabled = String(button.disabled);
        button.disabled = true;
      } else {
        button.disabled = button.dataset.wasDisabled === "true";
        delete button.dataset.wasDisabled;
      }
    });
  }

  async function sendToActivePage(message) {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error("没有找到当前标签页。");
    if (/^(?:chrome|edge|about|chrome-extension):/i.test(tab.url || "")) throw new Error("请先打开招聘网站页面。");
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (String(error).includes("Receiving end does not exist")) {
        throw new Error("当前招聘页面尚未加载 V3 扫描脚本，请刷新页面后重试。");
      }
      throw error;
    }
  }

  function readJobDescription() {
    const original = document.querySelector("#root .job-input-block textarea");
    const fallback = document.getElementById("ai-v3-job-description");
    return String(original?.value || fallback?.value || "").trim();
  }

  function confidenceText(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function renderWarnings() {
    const container = document.getElementById("ai-v3-warnings");
    container.replaceChildren();
    for (const warning of state.warnings) container.append(create("p", "ai-v3-warning", warning));
  }

  function renderPlan() {
    const container = document.getElementById("ai-v3-plan");
    const summary = document.getElementById("ai-v3-summary");
    const fillButton = document.getElementById("ai-v3-fill");
    const exportButton = document.getElementById("ai-v3-export");
    container.replaceChildren();
    if (!state.plan) {
      summary.textContent = "扫描后会在这里按字段展示 AI 规划结果。";
      fillButton.disabled = true;
      exportButton.disabled = true;
      return;
    }
    summary.textContent = state.plan.summary;
    const metadata = new Map((state.pageStructure?.fields || []).map((field) => [field.id, field]));
    for (const item of state.fields) {
      const field = metadata.get(item.fieldId) || {};
      const row = create("article", "ai-v3-field");
      const top = create("div", "ai-v3-field-top");
      const checkbox = create("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.selected;
      checkbox.setAttribute("aria-label", `选择 ${field.label || item.fieldId}`);
      checkbox.addEventListener("change", () => {
        item.selected = checkbox.checked;
      });
      const titleWrap = create("div", "ai-v3-field-title");
      titleWrap.append(create("strong", "", field.label || item.fieldId));
      const context = [field.sectionTitle, field.groupTitle, field.groupIndex == null ? "" : `第 ${field.groupIndex + 1} 组`]
        .filter(Boolean)
        .join(" · ");
      if (context) titleWrap.append(create("span", "", context));
      const confidence = create("span", `ai-v3-confidence ${(item.confidence || 0) >= 0.85 ? "high" : "medium"}`, confidenceText(item.confidence));
      top.append(checkbox, titleWrap, confidence);
      const meta = create("p", "ai-v3-field-meta", `${item.semanticType || "other"}${item.sourcePath ? ` · ${item.sourcePath}` : ""}`);
      const editor = create("textarea", "ai-v3-value");
      editor.value = item.value;
      editor.rows = Math.min(8, Math.max(3, Math.ceil(Array.from(item.value).length / 36)));
      if (field.maxLength) editor.maxLength = field.maxLength;
      editor.addEventListener("input", () => {
        item.value = editor.value;
      });
      const reason = create("p", "ai-v3-reason", item.reason || "请结合原简历逐字核对后再填写。");
      if (item.fillStatus) row.dataset.fillStatus = item.fillStatus;
      row.append(top, meta, editor, reason);
      container.append(row);
    }
    fillButton.disabled = state.fields.length === 0;
    exportButton.disabled = false;
    renderWarnings();
  }

  async function scanAndOptimize() {
    const jobDescription = readJobDescription();
    if (!jobDescription) {
      setStatus("请先在上方“岗位信息”或本区域填写岗位名称、职责和任职要求。", "error");
      return;
    }
    setBusy(true);
    state.plan = null;
    state.fields = [];
    state.fillResult = null;
    renderPlan();
    try {
      setStatus("正在扫描当前页面的全部可见字段和项目分组…", "working");
      const scanResponse = await sendToActivePage({type: "SCAN_AI_PAGE_STRUCTURE"});
      if (!scanResponse?.ok) throw new Error(scanResponse?.error || "页面结构扫描失败。");
      state.pageStructure = scanResponse.data;
      state.jobDescription = jobDescription;
      const safeFields = state.pageStructure.fields.filter((field) => !field.sensitive);
      if (safeFields.length === 0) throw new Error("当前页面没有可规划的非敏感字段；请先打开项目或经历编辑模块。");
      setStatus(`已扫描 ${state.pageStructure.fields.length} 个可见字段，正在请求 DeepSeek 进行整页分字段规划…`, "working");
      const planResponse = await chrome.runtime.sendMessage({
        type: "OPTIMIZE_PAGE_STRUCTURE",
        jobDescription,
        pageStructure: state.pageStructure
      });
      if (!planResponse?.ok) throw new Error(planResponse?.error || "DeepSeek 整页规划失败。");
      state.plan = planResponse.data;
      state.warnings = Array.isArray(state.plan.warnings) ? [...state.plan.warnings] : [];
      state.fields = (state.plan.fields || []).map((field) => ({
        ...field,
        selected: Number(field.confidence) >= 0.7,
        fillStatus: "pending"
      }));
      if (state.fields.length === 0) {
        state.warnings.push("DeepSeek 没有找到能够基于现有简历事实可靠填写的字段。");
      }
      renderPlan();
      setStatus(`规划完成：DeepSeek 查看了 ${state.plan.scannedFieldCount} 个非敏感字段，为 ${state.fields.length} 个字段生成了独立内容。`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
      renderPlan();
    }
  }

  async function applySelectedFields() {
    const selected = state.fields.filter((field) => field.selected && field.value.trim());
    if (selected.length === 0) {
      setStatus("请至少勾选一个已核对的字段。", "error");
      return;
    }
    if (!window.confirm(`将把 ${selected.length} 个已勾选字段写入当前网页，但不会点击最终提交。是否继续？`)) return;
    setBusy(true);
    try {
      setStatus(`正在填写 ${selected.length} 个已确认字段…`, "working");
      const response = await sendToActivePage({
        type: "APPLY_AI_FIELD_PLAN",
        fields: selected.map(({fieldId, value}) => ({fieldId, value}))
      });
      if (!response?.ok) throw new Error(response?.error || "AI 规划内容填写失败。");
      state.fillResult = response.data;
      const statusById = new Map(response.data.results.map((result) => [result.fieldId, result.status]));
      for (const field of state.fields) {
        if (statusById.has(field.fieldId)) field.fillStatus = statusById.get(field.fieldId);
      }
      renderPlan();
      setStatus(`已填写 ${response.data.filledCount} 个字段，${response.data.failedCount} 个未填写。请在网页中逐项检查并手动保存。`, response.data.failedCount ? "warning" : "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
      renderPlan();
    }
  }

  function exportJson() {
    if (!state.plan || !state.pageStructure) return;
    const metadata = new Map(state.pageStructure.fields.map((field) => [field.id, field]));
    const fillResults = new Map((state.fillResult?.results || []).map((result) => [result.fieldId, result]));
    const exported = {
      schema_version: "resume-autofill-ai-plan/1.0",
      generated_at: new Date().toISOString(),
      page: {
        title: state.pageStructure.title,
        url: state.pageStructure.urlOrigin,
        scanned_at: state.pageStructure.scannedAt
      },
      job_description: state.jobDescription,
      ai: {
        provider: "deepseek",
        model: state.plan.model,
        summary: state.plan.summary
      },
      warnings: state.warnings,
      fields: state.fields.map((item) => {
        const field = metadata.get(item.fieldId) || {};
        const fill = fillResults.get(item.fieldId);
        return {
          field_id: item.fieldId,
          label: field.label || "",
          section: field.sectionTitle || "",
          group: field.groupTitle || "",
          group_index: field.groupIndex,
          semantic_type: item.semanticType,
          resume_source_path: item.sourcePath,
          original_value: field.existingValue || "",
          generated_value: item.value,
          confidence: item.confidence,
          reason: item.reason,
          selected: item.selected,
          fill_status: fill?.status || item.fillStatus || "not-applied",
          filled_value: fill?.value || ""
        };
      })
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], {type: "application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `网申AI填写计划-${timestamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已导出包含字段结构、生成内容和填写状态的 JSON 文件。", "success");
  }

  function mount() {
    if (document.getElementById("ai-v3-card")) return;
    const card = create("section", "ai-v3-card");
    card.id = "ai-v3-card";
    const heading = create("div", "ai-v3-heading");
    const headingText = create("div");
    headingText.append(create("span", "ai-v3-eyebrow", "V3 AI"), create("h2", "", "整页结构优化与 JSON 导出"));
    heading.append(headingText, create("span", "ai-v3-badge", "人工确认后填写"));
    const description = create(
      "p",
      "ai-v3-description",
      "打开网申中的项目/经历编辑页后运行。DeepSeek 会一次理解当前页全部可见字段，分别生成项目介绍、主要职责、技术栈和成果，不会自动提交。"
    );
    const jobLabel = create("label", "ai-v3-label");
    jobLabel.append(create("span", "", "岗位信息（若上方已填写会优先使用上方内容）"));
    const jobInput = create("textarea", "ai-v3-job");
    jobInput.id = "ai-v3-job-description";
    jobInput.rows = 4;
    jobInput.maxLength = 8000;
    jobInput.placeholder = "粘贴岗位名称、职责、任职要求和优先条件";
    jobLabel.append(jobInput);
    const actions = create("div", "ai-v3-actions");
    const scanButton = create("button", "ai-v3-primary", "扫描整页并生成规划");
    scanButton.type = "button";
    scanButton.addEventListener("click", scanAndOptimize);
    const fillButton = create("button", "ai-v3-secondary", "填写已勾选字段");
    fillButton.id = "ai-v3-fill";
    fillButton.type = "button";
    fillButton.disabled = true;
    fillButton.addEventListener("click", applySelectedFields);
    const exportButton = create("button", "ai-v3-secondary", "导出填写 JSON");
    exportButton.id = "ai-v3-export";
    exportButton.type = "button";
    exportButton.disabled = true;
    exportButton.addEventListener("click", exportJson);
    actions.append(scanButton, fillButton, exportButton);
    const status = create("p", "ai-v3-status info", "等待扫描。请先打开招聘网页中的项目或经历编辑模块。");
    status.id = "ai-v3-status";
    status.setAttribute("role", "status");
    const summary = create("p", "ai-v3-summary", "扫描后会在这里按字段展示 AI 规划结果。");
    summary.id = "ai-v3-summary";
    const warnings = create("div", "ai-v3-warnings");
    warnings.id = "ai-v3-warnings";
    const plan = create("div", "ai-v3-plan");
    plan.id = "ai-v3-plan";
    card.append(heading, description, jobLabel, actions, status, summary, warnings, plan);
    document.body.append(card);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once: true});
  else mount();
})();
