(() => {
  "use strict";

  const FIELD_SELECTOR = [
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "[contenteditable='true']"
  ].join(",");
  const SKIPPED_TYPES = new Set(["password", "file", "hidden", "checkbox", "radio", "button", "submit", "reset", "image"]);
  const SENSITIVE_PATTERN = /身份证|证件号|护照|银行卡|银行账户|手机号|联系电话|电子邮箱|邮箱|家庭住址|现居地址|户籍地址|出生日期|密码|验证码|密钥|令牌|(?:^|[_\-.])(?:phone|mobile|email|address|passport|password|token|secret|otp|id_?number)(?:$|[_\-.])/i;
  const GROUP_PATTERN = /project|experience|record|entry|item|card|panel|项目|经历/i;
  const LABEL_CONTAINER_SELECTOR = [
    ".ant-form-item",
    ".el-form-item",
    ".ivu-form-item",
    ".form-item",
    ".form-group",
    ".field-item",
    ".field",
    "fieldset",
    "td",
    "li"
  ].join(",");
  const HEADING_SELECTOR = [
    "legend",
    "h1",
    "h2",
    "h3",
    "h4",
    "[role='heading']",
    ".section-title",
    ".ant-card-head-title",
    ".el-card__header",
    ".panel-title"
  ].join(",");
  let lastFieldRegistry = new Map();

  function cleanText(value, limit = 240) {
    return Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, limit).join("");
  }

  function isRendered(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function directLabelText(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll?.("input,textarea,select,button,svg,script,style").forEach((child) => child.remove());
    return cleanText(clone.textContent, 240);
  }

  function fieldLabel(element) {
    const candidates = [];
    if (element.labels) {
      for (const label of element.labels) candidates.push(directLabelText(label));
    }
    const ariaLabelledBy = element.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      for (const id of ariaLabelledBy.split(/\s+/)) candidates.push(directLabelText(document.getElementById(id)));
    }
    candidates.push(cleanText(element.getAttribute("aria-label"), 240));
    const container = element.closest(LABEL_CONTAINER_SELECTOR);
    if (container) {
      const labelNode = container.querySelector(":scope > label, :scope > .label, :scope > .field-label, .ant-form-item-label, .el-form-item__label");
      candidates.push(directLabelText(labelNode));
    }
    let previous = element.previousElementSibling;
    if (previous && previous.matches("label,span,strong")) candidates.push(directLabelText(previous));
    candidates.push(cleanText(element.getAttribute("placeholder"), 240));
    candidates.push(cleanText(element.getAttribute("name"), 240));
    candidates.push(cleanText(element.id, 240));
    return candidates.find((candidate) => candidate && candidate.length <= 240) || "未命名字段";
  }

  function nearestHeading(element, fieldName) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      const heading = current.matches(HEADING_SELECTOR) ? current : current.querySelector(`:scope > ${HEADING_SELECTOR}`);
      const text = directLabelText(heading);
      if (text && text !== fieldName && text.length <= 200) return text;
    }
    return "当前页面";
  }

  function findGroup(element, fieldName) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const signature = `${current.id} ${current.className}`;
      const fieldsInside = current.querySelectorAll?.(FIELD_SELECTOR).length || 0;
      if (fieldsInside >= 2 && GROUP_PATTERN.test(signature)) {
        const heading = current.querySelector(HEADING_SELECTOR);
        const groupTitle = directLabelText(heading) || nearestHeading(current, fieldName);
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName && GROUP_PATTERN.test(`${sibling.id} ${sibling.className}`))
          : [];
        return {
          element: current,
          title: cleanText(groupTitle, 200),
          index: Math.max(0, siblings.indexOf(current))
        };
      }
    }
    return {element: null, title: "", index: null};
  }

  function domPath(element) {
    const parts = [];
    let current = element;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      if (current.id) {
        parts.unshift(`${current.tagName.toLowerCase()}#${current.id}`);
        break;
      }
      const parent = current.parentElement;
      const index = parent ? [...parent.children].indexOf(current) : 0;
      parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
    }
    return parts.join("/");
  }

  function fnv1a(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function fieldKind(element) {
    if (element instanceof HTMLTextAreaElement) return "textarea";
    if (element instanceof HTMLSelectElement) return "select";
    if (element instanceof HTMLInputElement) return (element.type || "text").toLowerCase();
    if (element.getAttribute("contenteditable") === "true") return "contenteditable";
    return element.tagName.toLowerCase();
  }

  function semanticHint(label) {
    const text = cleanText(label, 300).toLowerCase();
    if (/项目名称|project\s*name/.test(text)) return "project_name";
    if (/项目介绍|项目描述|项目概述|项目内容|project\s*(description|summary|introduction)/.test(text)) return "project_description";
    if (/主要职责|个人职责|本人职责|职责描述|负责内容|responsibilit|role\s*description/.test(text)) return "responsibilities";
    if (/项目成果|主要成果|取得成果|业绩|成效|achievement|result|outcome/.test(text)) return "achievements";
    if (/技术栈|开发工具|使用技术|核心技术|technology|tech\s*stack/.test(text)) return "technology_stack";
    if (/开始时间|起始时间|start\s*date/.test(text)) return "start_date";
    if (/结束时间|终止时间|end\s*date/.test(text)) return "end_date";
    if (/自我介绍|个人介绍|self\s*intro/.test(text)) return "self_introduction";
    if (/申请理由|求职动机|为什么.*申请|application\s*reason/.test(text)) return "application_reason";
    if (/工作内容|实习内容|经历描述|experience\s*description/.test(text)) return "experience_description";
    return "other";
  }

  function currentValue(element) {
    if (element instanceof HTMLSelectElement) {
      const selected = element.selectedOptions?.[0];
      return cleanText(selected?.textContent || element.value, 1000);
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return cleanText(element.value, 1000);
    return cleanText(element.textContent, 1000);
  }

  function describeField(element, order) {
    const kind = fieldKind(element);
    if (SKIPPED_TYPES.has(kind) || element.disabled || element.readOnly || !isRendered(element)) return null;
    const label = fieldLabel(element);
    const name = cleanText(element.getAttribute("name"), 160);
    const placeholder = cleanText(element.getAttribute("placeholder"), 240);
    const semantic = semanticHint(`${label} ${placeholder} ${name}`);
    const sensitive = SENSITIVE_PATTERN.test(`${label} ${placeholder} ${name}`);
    const sectionTitle = nearestHeading(element, label);
    const group = findGroup(element, label);
    const path = domPath(element);
    const id = `ai-field-${fnv1a([kind, label, name, sectionTitle, group.index, path].join("|"))}`;
    return {
      id,
      order,
      label,
      kind,
      name,
      placeholder,
      sectionTitle,
      groupTitle: group.title,
      groupIndex: group.index,
      semanticHint: semantic,
      required: element.required === true || element.getAttribute("aria-required") === "true",
      maxLength: Number.isFinite(element.maxLength) && element.maxLength > 0 ? element.maxLength : null,
      options: element instanceof HTMLSelectElement
        ? [...element.options].slice(0, 80).map((option) => ({label: cleanText(option.textContent, 160), value: cleanText(option.value, 160)}))
        : [],
      existingValue: sensitive ? "" : currentValue(element),
      sensitive
    };
  }

  function scanPage() {
    const registry = new Map();
    const fields = [];
    [...document.querySelectorAll(FIELD_SELECTOR)].slice(0, 300).forEach((element, index) => {
      const field = describeField(element, index);
      if (!field) return;
      fields.push(field);
      registry.set(field.id, element);
    });
    lastFieldRegistry = registry;
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,legend,[role='heading']")]
      .filter(isRendered)
      .map((element) => cleanText(element.textContent, 200))
      .filter(Boolean)
      .slice(0, 50);
    return {
      title: cleanText(document.title, 200),
      urlOrigin: `${location.origin}${location.pathname}`,
      scannedAt: new Date().toISOString(),
      headings,
      fields
    };
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLSelectElement) {
      const normalized = cleanText(value, 300).toLowerCase();
      const option = [...element.options].find((item) =>
        cleanText(item.value, 300).toLowerCase() === normalized || cleanText(item.textContent, 300).toLowerCase() === normalized
      );
      if (!option) throw new Error("AI 结果不在下拉选项中");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (setter) setter.call(element, option.value);
      else element.value = option.value;
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    } else if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    } else if (element.getAttribute("contenteditable") === "true") {
      element.textContent = value;
    } else {
      throw new Error("不支持的字段类型");
    }
    element.dispatchEvent(new Event("input", {bubbles: true, composed: true}));
    element.dispatchEvent(new Event("change", {bubbles: true, composed: true}));
    element.dispatchEvent(new Event("blur", {bubbles: true, composed: true}));
  }

  function applyPlan(fields) {
    if (!Array.isArray(fields)) throw new Error("待填写内容格式无效");
    if ([...lastFieldRegistry.values()].some((element) => !element.isConnected)) scanPage();
    const results = [];
    for (const item of fields.slice(0, 180)) {
      const id = cleanText(item?.fieldId, 120);
      const value = cleanText(item?.value, 5000);
      let element = lastFieldRegistry.get(id);
      if (!element?.isConnected) {
        scanPage();
        element = lastFieldRegistry.get(id);
      }
      if (!element) {
        results.push({fieldId: id, status: "not-found", error: "页面结构已变化，请重新扫描"});
        continue;
      }
      const description = describeField(element, 0);
      if (!description || description.sensitive) {
        results.push({fieldId: id, status: "blocked", error: "敏感或不可填写字段"});
        continue;
      }
      const maximum = description.maxLength || 5000;
      try {
        setNativeValue(element, Array.from(value).slice(0, maximum).join(""));
        results.push({fieldId: id, status: "filled", value: currentValue(element)});
      } catch (error) {
        results.push({fieldId: id, status: "failed", error: error instanceof Error ? error.message : String(error)});
      }
    }
    return {
      filledAt: new Date().toISOString(),
      filledCount: results.filter((item) => item.status === "filled").length,
      failedCount: results.filter((item) => item.status !== "filled").length,
      results
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    try {
      if (message?.type === "SCAN_AI_PAGE_STRUCTURE") return Promise.resolve({ok: true, data: scanPage()});
      if (message?.type === "APPLY_AI_FIELD_PLAN") return Promise.resolve({ok: true, data: applyPlan(message.fields)});
    } catch (error) {
      return Promise.resolve({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return undefined;
  });
})();
