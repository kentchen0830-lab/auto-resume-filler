const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..");
const {chromium} = require("playwright");
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

async function testContentScannerAndFiller() {
  const browser = await chromium.launch({headless: true, ...(browserExecutable ? {executablePath: browserExecutable} : {})});
  try {
    const page = await browser.newPage();
    await page.setContent(`
    <main>
      <h1>研发工程师申请</h1>
      <section class="project-panel">
        <h2>项目经历</h2>
        <article class="project-card">
          <h3>项目 1</h3>
          <label>项目名称<input name="projectName"></label>
          <label>项目介绍<textarea name="description" maxlength="300"></textarea></label>
          <label>主要职责<textarea name="responsibility" maxlength="240"></textarea></label>
          <label>项目成果<textarea name="achievement" maxlength="180"></textarea></label>
        </article>
        <article class="project-card">
          <h3>项目 2</h3>
          <label>项目名称<input name="projectName"></label>
          <label>项目介绍<textarea name="description"></textarea></label>
          <label>主要职责<textarea name="responsibility"></textarea></label>
          <label>项目成果<textarea name="achievement"></textarea></label>
        </article>
      </section>
    </main>
    `);
    await page.evaluate(() => {
      window.chrome.runtime = {
        onMessage: {
          addListener(listener) {
            window.__aiMessageListener = listener;
          }
        }
      };
    });
    await page.addScriptTag({path: path.join(extensionRoot, "content-scripts", "ai-structure.js")});
    const scan = await page.evaluate(() => window.__aiMessageListener({type: "SCAN_AI_PAGE_STRUCTURE"}));
  assert.equal(scan.ok, true);
  assert.equal(scan.data.fields.length, 8);
  assert.equal(new Set(scan.data.fields.map((field) => field.id)).size, 8);
  assert.equal(scan.data.fields.filter((field) => field.semanticHint === "project_description").length, 2);
  assert.equal(scan.data.fields.filter((field) => field.semanticHint === "responsibilities").length, 2);
  assert.equal(scan.data.fields.filter((field) => field.semanticHint === "achievements").length, 2);
  const target = scan.data.fields.find((field) => field.semanticHint === "project_description");
  const applied = await page.evaluate(
    ({fieldId}) => window.__aiMessageListener({type: "APPLY_AI_FIELD_PLAN", fields: [{fieldId, value: "面向招聘表单建立字段识别与自动填写流程"}]}),
    {fieldId: target.id}
  );
  assert.equal(applied.ok, true);
  assert.equal(applied.data.filledCount, 1);
  assert.equal(await page.locator("textarea[name=description]").first().inputValue(), "面向招聘表单建立字段识别与自动填写流程");
    return scan.data;
  } finally {
    await browser.close();
  }
}

async function testBackgroundValidation(pageStructure) {
  const source = fs.readFileSync(path.join(extensionRoot, "ai-project-optimizer.js"), "utf8");
  const allowed = pageStructure.fields.find((field) => field.semanticHint === "project_description");
  const storage = {
    "resumeAutofill.ai.settings.v2": {
      mode: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "TEST_API_KEY_PLACEHOLDER"
    },
    "resumeAutofill.resume.v1": {
      resume: {
        projects: [{name: "表单自动化演示", description: "识别网页字段并生成填写计划", phone: "TEST_PHONE_SHOULD_BE_FILTERED"}],
        skills: ["JavaScript", "Browser Automation"]
      }
    }
  };
  const modelOutput = {
    summary: "按字段规划完成",
    fields: [
      {
        fieldId: allowed.id,
        semanticType: "project_description",
        sourcePath: "projects[0].description",
        value: "围绕招聘表单场景完成字段识别、内容规划与自动填写验证",
        confidence: 0.94,
        reason: "对应项目介绍字段"
      },
      {
        fieldId: "ai-field-not-allowed",
        semanticType: "project_description",
        sourcePath: "projects[0]",
        value: "不应被接受",
        confidence: 1,
        reason: "越权字段"
      }
    ]
  };
  const context = vm.createContext({
    console,
    URL,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    STORAGE_JSON: JSON.stringify(storage),
    MODEL_OUTPUT_JSON: JSON.stringify(modelOutput)
  });
  vm.runInContext(`
    globalThis.chrome = {
      storage: {local: {get: async () => JSON.parse(STORAGE_JSON)}},
      runtime: {onMessage: {addListener: (listener) => { globalThis.__optimizerListener = listener; }}}
    };
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      if (!request.messages[1].content.includes("RESUME_FACTS")) throw new Error("resume facts missing");
      return {
        ok: true,
        status: 200,
        json: async () => ({choices: [{message: {content: MODEL_OUTPUT_JSON}}]})
      };
    };
  `, context);
  vm.runInContext(source, context, {filename: "ai-project-optimizer.js"});
  context.TEST_MESSAGE = JSON.stringify({
    type: "OPTIMIZE_PAGE_STRUCTURE",
    jobDescription: "负责浏览器自动化、表单识别与 AI 辅助内容生成",
    pageStructure
  });
  const response = await vm.runInContext("__optimizerListener(JSON.parse(TEST_MESSAGE))", context);
  assert.equal(response.ok, true);
  assert.equal(response.data.fields.length, 1);
  assert.equal(response.data.fields[0].fieldId, allowed.id);
  assert.equal(response.data.model, "deepseek-v4-flash");
}

async function testPackagedExtensionLoads() {
  if (!browserExecutable) return;
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    executablePath: browserExecutable,
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]
  });
  try {
    let workers = context.serviceWorkers();
    if (workers.length === 0) {
      try {
        await context.waitForEvent("serviceworker", {timeout: 5000});
      } catch {}
      workers = context.serviceWorkers();
    }
    assert.ok(workers.length > 0, "extension service worker should load");
    const extensionId = new URL(workers[0].url()).hostname;
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForSelector("#ai-v3-card", {timeout: 5000});
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  } finally {
    await context.close();
  }
}

(async () => {
  const pageStructure = await testContentScannerAndFiller();
  await testBackgroundValidation(pageStructure);
  await testPackagedExtensionLoads();
  console.log("V3 smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
