import fs from "node:fs/promises";
import path from "node:path";

let chromium;

const WORKSPACE_ROOT = "/Volumes/HARDDRIVE1/project/private/SlothVault/docx/slothvault-thesis";
const OUTPUT_DIR = path.join(WORKSPACE_ROOT, "artifacts", "screenshots");
const REPORT_PATH = path.join(OUTPUT_DIR, "capture-report.json");
const STORAGE_STATE_PATH = path.join(
  WORKSPACE_ROOT,
  ".codex",
  "session",
  "thesis-page-capture",
  "slothvault-local",
  "storage-state.json",
);

const USERNAME = process.env.THESIS_CAPTURE_USERNAME || "admin";
const PASSWORD = process.env.THESIS_CAPTURE_PASSWORD || "123456789";
const BASE_URL_CANDIDATES = [
  "http://[::1]:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const FIGURES = [
  { figure_id: "图4-5", caption: "图4-5 管理员登录页面截图", placeholder: "[此处插入图4-5 管理员登录页面截图]" },
  { figure_id: "图4-6", caption: "图4-6 项目管理页面截图", placeholder: "[此处插入图4-6 项目管理页面截图]" },
  { figure_id: "图4-7", caption: "图4-7 项目版本配置页面截图", placeholder: "[此处插入图4-7 项目版本配置页面截图]" },
  { figure_id: "图4-8", caption: "图4-8 分类与笔记管理页面截图", placeholder: "[此处插入图4-8 分类与笔记管理页面截图]" },
  { figure_id: "图4-9", caption: "图4-9 Markdown 内容编辑页面截图", placeholder: "[此处插入图4-9 Markdown 内容编辑页面截图]" },
  { figure_id: "图4-10", caption: "图4-10 前台项目首页截图", placeholder: "[此处插入图4-10 前台项目首页截图]" },
  { figure_id: "图4-11", caption: "图4-11 前台文档阅读页面截图", placeholder: "[此处插入图4-11 前台文档阅读页面截图]" },
  { figure_id: "图4-12", caption: "图4-12 Solana Merkle Tree 管理页面截图", placeholder: "[此处插入图4-12 Solana Merkle Tree 管理页面截图]" },
  { figure_id: "图4-13", caption: "图4-13 cNFT 管理页面截图", placeholder: "[此处插入图4-13 cNFT 管理页面截图]" },
  { figure_id: "图4-14", caption: "图4-14 数据备份页面截图", placeholder: "[此处插入图4-14 数据备份页面截图]" },
];

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function detectBaseUrl() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const candidate of BASE_URL_CANDIDATES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const response = await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 5000 });
        if (response) {
          await page.close();
          return candidate;
        }
      } catch {
        // keep trying
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  throw new Error("Unable to reach local SlothVault server.");
}

async function newContext(baseUrl) {
  try {
    await fs.access(STORAGE_STATE_PATH);
    return chromium.launch({ headless: true }).then(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        storageState: STORAGE_STATE_PATH,
      });
      return { browser, context, baseUrl };
    });
  } catch {
    return chromium.launch({ headless: true }).then(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      return { browser, context, baseUrl };
    });
  }
}

async function waitBrief(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}

async function saveLoginState(context) {
  await ensureDir(path.dirname(STORAGE_STATE_PATH));
  await context.storageState({ path: STORAGE_STATE_PATH });
}

async function loginAndCapture(page, baseUrl, reportItems) {
  await page.goto(`${baseUrl}/admin/auth/login`, { waitUntil: "domcontentloaded" });
  await waitBrief(page);
  const loginImagePath = path.join(OUTPUT_DIR, "fig-4-5-login-page.png");
  await page.screenshot({ path: loginImagePath });
  reportItems.push({
    ...FIGURES[0],
    target: "/admin/auth/login",
    wait_for: "selector:input[type='password']",
    image_path: loginImagePath,
    relative_image_path: "artifacts/screenshots/fig-4-5-login-page.png",
    captured: true,
  });

  const userInput = page.locator("input").filter({ hasNot: page.locator("input[type='password']") }).first();
  const passwordInput = page.locator("input[type='password']").first();
  await userInput.fill(USERNAME);
  await passwordInput.fill(PASSWORD);
  const submit = page.locator("button").filter({ hasText: /登录|Login|Sign in/i }).first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await passwordInput.press("Enter");
  }
  await page.waitForTimeout(1200);
}

async function gotoAndShot(page, baseUrl, route, filename, figure, waitForSelector) {
  const url = route.startsWith("http") ? route : `${baseUrl}${route}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {});
  }
  await waitBrief(page);
  const imagePath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: imagePath });
  return {
    ...figure,
    target: route,
    wait_for: waitForSelector ? `selector:${waitForSelector}` : `url:${route}`,
    image_path: imagePath,
    relative_image_path: `artifacts/screenshots/${filename}`,
    captured: true,
  };
}

async function firstVisibleButton(page, regex) {
  const buttons = page.locator("button");
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const text = (await button.innerText().catch(() => "")).trim();
    if (regex.test(text)) {
      return button;
    }
  }
  return null;
}

async function fetchProjectData(page, baseUrl) {
  return page.evaluate(async (origin) => {
    const fetchJson = async (pathname) => {
      const res = await fetch(`${origin}${pathname}`, { credentials: "include" });
      return res.json();
    };
    const listPayload = await fetchJson("/api/project/list");
    const firstProject = listPayload?.data?.[0] || listPayload?.data?.list?.[0];
    if (!firstProject) return null;
    const projectId = firstProject.id;
    const versionsPayload = await fetchJson(`/api/project/${projectId}/versions`);
    const versions = versionsPayload?.data || [];
    const firstVersion = versions[0];
    if (!firstVersion) {
      return { projectId };
    }
    const versionId = firstVersion.id;
    const sidebarPayload = await fetchJson(`/api/project/${projectId}/v/${versionId}/sidebar`);
    const categories = sidebarPayload?.data || [];
    let noteId = null;
    for (const category of categories) {
      if (category.notes?.length) {
        noteId = category.notes[0].id;
        break;
      }
    }
    return { projectId, versionId, noteId };
  }, baseUrl);
}

async function main() {
  const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH || "playwright";
  ({ chromium } = await import(playwrightModulePath));
  await ensureDir(OUTPUT_DIR);
  const baseUrl = await detectBaseUrl();
  const { browser, context } = await newContext(baseUrl);
  const page = await context.newPage();
  const reportItems = [];

  try {
    await loginAndCapture(page, baseUrl, reportItems);
    await saveLoginState(context);

    reportItems.push(await gotoAndShot(page, baseUrl, "/admin/mm/projects", "fig-4-6-projects-page.png", FIGURES[1], "body"));

    const versionButton = await firstVisibleButton(page, /版本|Version/i);
    if (versionButton) {
      await versionButton.click();
      await page.waitForTimeout(800);
      const imagePath = path.join(OUTPUT_DIR, "fig-4-7-project-version-dialog.png");
      await page.screenshot({ path: imagePath });
      reportItems.push({
        ...FIGURES[2],
        target: "/admin/mm/projects",
        wait_for: "selector:body",
        image_path: imagePath,
        relative_image_path: "artifacts/screenshots/fig-4-7-project-version-dialog.png",
        captured: true,
      });
      await page.keyboard.press("Escape").catch(() => {});
    }

    reportItems.push(await gotoAndShot(page, baseUrl, "/admin/mm/notes", "fig-4-8-notes-page.png", FIGURES[3], "body"));

    let contentRoute = null;
    const contentLinks = page.locator("a");
    const linkCount = await contentLinks.count();
    for (let i = 0; i < linkCount; i += 1) {
      const href = await contentLinks.nth(i).getAttribute("href").catch(() => null);
      if (href && /\/admin\/mm\/notes\/.+\/content/.test(href)) {
        contentRoute = href;
        break;
      }
    }
    if (contentRoute) {
      reportItems.push(await gotoAndShot(page, baseUrl, contentRoute, "fig-4-9-markdown-editor-page.png", FIGURES[4], "body"));
    }

    const projectData = await fetchProjectData(page, baseUrl);
    if (projectData?.projectId) {
      reportItems.push(await gotoAndShot(page, baseUrl, `/project/${projectData.projectId}/home`, "fig-4-10-project-home-page.png", FIGURES[5], "body"));
      if (projectData.versionId && projectData.noteId) {
        reportItems.push(
          await gotoAndShot(
            page,
            baseUrl,
            `/project/${projectData.projectId}/v/${projectData.versionId}/docs/${projectData.noteId}`,
            "fig-4-11-project-doc-page.png",
            FIGURES[6],
            "body",
          ),
        );
      }
    }

    reportItems.push(await gotoAndShot(page, baseUrl, "/admin/mm/solana/trees", "fig-4-12-solana-trees-page.png", FIGURES[7], "body"));
    reportItems.push(await gotoAndShot(page, baseUrl, "/admin/mm/solana/cnfts", "fig-4-13-solana-cnfts-page.png", FIGURES[8], "body"));
    reportItems.push(await gotoAndShot(page, baseUrl, "/admin/mm/backup", "fig-4-14-backup-page.png", FIGURES[9], "body"));

    await fs.writeFile(
      REPORT_PATH,
      JSON.stringify(
        {
          base_url: baseUrl,
          items: reportItems,
        },
        null,
        2,
      ),
      "utf-8",
    );

    console.log(JSON.stringify({ base_url: baseUrl, captured_count: reportItems.length, report_path: REPORT_PATH }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
