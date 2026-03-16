// ============================================================
//  Goal Tracker – Google Apps Script 後端
//  請將此檔案貼到 Google Apps Script 編輯器，並重新部署為網路應用程式
//  執行身分：我（your Google account）
//  存取權限：所有人（Anyone, even anonymous）
// ============================================================

const TOKEN       = "goaltracker2026";
const GOALS_SHEET = "Goals";
const MS_SHEET    = "Milestones";
const CAT_SHEET   = "Categories";

// ── 主入口 ─────────────────────────────────────────────────
function doGet(e) {
  try {
    if (!e || !e.parameter) return jsonResp({ success: false, error: "No parameters" });
    if (e.parameter.token !== TOKEN) return jsonResp({ success: false, error: "Unauthorized" });

    const action = e.parameter.action;
    switch (action) {
      case "getGoals":         return jsonResp(getGoals());
      case "createGoal":       return jsonResp(createGoal(e.parameter));
      case "updateGoal":       return jsonResp(updateGoal(e.parameter));
      case "deleteGoal":       return jsonResp(deleteGoal(e.parameter));
      case "createMilestone":  return jsonResp(createMilestone(e.parameter));
      case "updateMilestone":  return jsonResp(updateMilestone(e.parameter));
      case "deleteMilestone":  return jsonResp(deleteMilestone(e.parameter));
      case "toggleMilestone":  return jsonResp(toggleMilestone(e.parameter));
      case "getCategories":    return jsonResp(getCategories());
      case "createCategory":   return jsonResp(createCategory(e.parameter));
      case "updateCategory":   return jsonResp(updateCategory(e.parameter));
      case "deleteCategory":   return jsonResp(deleteCategory(e.parameter));
      case "generateAiSummary": return jsonResp(generateAiSummary());
      case "askAi":            return jsonResp(askAi(e.parameter));
      default: return jsonResp({ success: false, error: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonResp({ success: false, error: err.message });
  }
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 取得或建立工作表 ────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === GOALS_SHEET) {
      sheet.appendRow(["goal_id", "title", "category", "description", "target_date", "status"]);
    } else if (name === MS_SHEET) {
      sheet.appendRow(["milestone_id", "goal_id", "title", "status", "completed_at", "note"]);
    } else if (name === CAT_SHEET) {
      sheet.appendRow(["category_id", "name", "icon", "color", "created_at"]);
      const now = new Date().toISOString().slice(0, 10);
      sheet.appendRow(["work", "工作", "💼", "purple", now]);
      sheet.appendRow(["life", "生活", "🌿", "green",  now]);
    }
  }
  return sheet;
}

// 將 Date 物件或字串統一格式化為 yyyy-MM-dd
function fmtDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(val).slice(0, 10);
}

// 依據工作表第一欄（ID 欄）找出最大純數字 ID，回傳 max+1 的字串
function genSequentialId(sheet) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const n = parseInt(data[i][0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

// 將 sheet rows 轉成 object array
function rowsToObjects(data) {
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// 解析欄位對應，同時支援舊欄位名稱
function buildColMap(headers) {
  const col = {};
  headers.forEach((h, i) => { col[String(h).trim()] = i; });
  return col;
}

// 找里程碑 ID 欄位（相容舊版可能叫 'id'）
function getMsIdCol(col) {
  if (col["milestone_id"] !== undefined) return col["milestone_id"];
  if (col["id"] !== undefined) return col["id"];
  return undefined;
}

// 找目標 ID 欄位（相容舊版可能叫 'id'）
function getGoalIdCol(col) {
  if (col["goal_id"] !== undefined) return col["goal_id"];
  if (col["id"] !== undefined) return col["id"];
  return undefined;
}

// ── getGoals ───────────────────────────────────────────────
function getGoals() {
  const goalsSheet = getSheet(GOALS_SHEET);
  const msSheet    = getSheet(MS_SHEET);

  const goalsData = goalsSheet.getDataRange().getValues();
  const msData    = msSheet.getDataRange().getValues();

  const goals = rowsToObjects(goalsData).filter(g => g.status !== "deleted");
  const allMs = rowsToObjects(msData).filter(m => m.status !== "deleted");

  // 建立 milestones map（相容舊版 ID 欄位名稱）
  const msMap = {};
  allMs.forEach(m => {
    const msId   = String(m.milestone_id || m.id || "");
    const goalId = String(m.goal_id || "");
    if (!goalId) return;
    if (!msMap[goalId]) msMap[goalId] = [];
    msMap[goalId].push({
      milestone_id: msId,
      goal_id:      goalId,
      title:        m.title || "",
      status:       m.status || "pending",
      completed_at: m.completed_at ? fmtDate(m.completed_at) : null
    });
  });

  const result = goals.map(g => {
    const goalId = String(g.goal_id || g.id || "");
    return {
      goal_id:     goalId,
      title:       g.title || "",
      category:    g.category || "work",
      target_date: g.target_date ? fmtDate(g.target_date) : "",
      description: g.description || "",
      status:      g.status || "active",
      milestones:  msMap[goalId] || []
    };
  });

  return { success: true, data: result };
}

// ── createGoal ─────────────────────────────────────────────
function createGoal(p) {
  if (!p.title) return { success: false, error: "缺少目標名稱" };
  const sheet = getSheet(GOALS_SHEET);
  const id    = genSequentialId(sheet);
  sheet.appendRow([id, p.title, p.category || "work", p.description || "", p.target_date || "", "active"]);
  return { success: true, goal_id: id };
}

// ── updateGoal ─────────────────────────────────────────────
function updateGoal(p) {
  if (!p.goal_id) return { success: false, error: "缺少 goal_id" };
  const sheet   = getSheet(GOALS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const col     = buildColMap(data[0]);
  const idCol   = getGoalIdCol(col);
  if (idCol === undefined) return { success: false, error: "找不到 goal_id 欄位" };

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(p.goal_id)) {
      if (p.title       !== undefined && col["title"]       !== undefined) sheet.getRange(i+1, col["title"]+1).setValue(p.title);
      if (p.category    !== undefined && col["category"]    !== undefined) sheet.getRange(i+1, col["category"]+1).setValue(p.category);
      if (p.target_date !== undefined && col["target_date"] !== undefined) sheet.getRange(i+1, col["target_date"]+1).setValue(p.target_date);
      if (p.description !== undefined && col["description"] !== undefined) sheet.getRange(i+1, col["description"]+1).setValue(p.description);
      return { success: true };
    }
  }
  return { success: false, error: "找不到目標" };
}

// ── deleteGoal ─────────────────────────────────────────────
function deleteGoal(p) {
  if (!p.goal_id) return { success: false, error: "缺少 goal_id" };
  const sheet   = getSheet(GOALS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const col     = buildColMap(data[0]);
  const idCol   = getGoalIdCol(col);
  if (idCol === undefined) return { success: false, error: "找不到 goal_id 欄位" };

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(p.goal_id)) {
      sheet.deleteRow(i + 1);
      _deleteMilestonesByGoal(p.goal_id);
      return { success: true };
    }
  }
  return { success: false, error: "找不到目標" };
}

function _deleteMilestonesByGoal(goalId) {
  const sheet   = getSheet(MS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const col     = buildColMap(data[0]);
  const goalCol = col["goal_id"] !== undefined ? col["goal_id"] : col["goal"];
  if (goalCol === undefined) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][goalCol]) === String(goalId)) sheet.deleteRow(i + 1);
  }
}

// ── createMilestone ────────────────────────────────────────
function createMilestone(p) {
  if (!p.goal_id) return { success: false, error: "缺少 goal_id" };
  if (!p.title)   return { success: false, error: "缺少里程碑名稱" };
  const sheet = getSheet(MS_SHEET);
  const id    = genSequentialId(sheet);
  sheet.appendRow([id, p.goal_id, p.title, "pending", ""]);
  return { success: true, milestone_id: id };
}

// ── updateMilestone ────────────────────────────────────────
function updateMilestone(p) {
  if (!p.milestone_id) return { success: false, error: "缺少 milestone_id" };
  const sheet   = getSheet(MS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const col     = buildColMap(data[0]);
  const idCol   = getMsIdCol(col);
  if (idCol === undefined) return { success: false, error: "找不到里程碑 ID 欄位" };

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(p.milestone_id)) {
      if (p.title !== undefined && col["title"] !== undefined) {
        sheet.getRange(i + 1, col["title"] + 1).setValue(p.title);
      }
      return { success: true };
    }
  }
  return { success: false, error: "找不到里程碑" };
}

// ── deleteMilestone ────────────────────────────────────────
function deleteMilestone(p) {
  if (!p.milestone_id) return { success: false, error: "缺少 milestone_id" };
  const sheet   = getSheet(MS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const col     = buildColMap(data[0]);
  const idCol   = getMsIdCol(col);
  if (idCol === undefined) return { success: false, error: "找不到里程碑 ID 欄位" };

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(p.milestone_id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: "找不到里程碑" };
}

// ── toggleMilestone ────────────────────────────────────────
function toggleMilestone(p) {
  if (!p.milestone_id) return { success: false, error: "缺少 milestone_id" };

  const sheet   = getSheet(MS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const col     = buildColMap(data[0]);
  const idCol   = getMsIdCol(col);

  if (idCol === undefined) {
    return { success: false, error: "找不到里程碑 ID 欄位，現有欄位：" + Object.keys(col).join(", ") };
  }

  const statusCol      = col["status"];
  const completedAtCol = col["completed_at"];

  if (statusCol === undefined) {
    return { success: false, error: "找不到 status 欄位，現有欄位：" + Object.keys(col).join(", ") };
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(p.milestone_id)) {
      const current     = String(data[i][statusCol] || "").trim();
      const newStatus   = current === "done" ? "pending" : "done";
      const completedAt = newStatus === "done" ? new Date().toISOString().slice(0, 10) : "";
      sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
      if (completedAtCol !== undefined) {
        sheet.getRange(i + 1, completedAtCol + 1).setValue(completedAt);
      }
      return { success: true };
    }
  }

  // 回傳除錯資訊，幫助診斷 ID 不符合的問題
  const sampleIds = data.slice(1, 4).map(row => String(data.length > 1 ? row[idCol] : ""));
  return {
    success: false,
    error: `找不到里程碑 (尋找: "${p.milestone_id}"，前幾筆ID: ${sampleIds.join(", ")})`
  };
}

// ── getCategories ──────────────────────────────────────────
function getCategories() {
  const sheet = getSheet(CAT_SHEET);
  const data  = sheet.getDataRange().getValues();
  const cats  = rowsToObjects(data);
  return {
    success: true,
    data: cats.map(c => ({
      category_id: String(c.category_id || ""),
      name:        c.name  || "",
      icon:        c.icon  || "",
      color:       c.color || "purple",
      created_at:  c.created_at ? String(c.created_at).slice(0, 10) : ""
    }))
  };
}

// ── createCategory ─────────────────────────────────────────
function createCategory(p) {
  if (!p.name) return { success: false, error: "缺少類別名稱" };
  const sheet = getSheet(CAT_SHEET);
  const id    = genSequentialId(sheet);
  const now   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  sheet.appendRow([id, p.name, p.icon || "📌", p.color || "purple", now]);
  return { success: true, category_id: id };
}

// ── updateCategory ─────────────────────────────────────────
function updateCategory(p) {
  if (!p.category_id) return { success: false, error: "缺少 category_id" };
  const sheet = getSheet(CAT_SHEET);
  const data  = sheet.getDataRange().getValues();
  const col   = buildColMap(data[0]);
  const idCol = col["category_id"];
  if (idCol === undefined) return { success: false, error: "找不到 category_id 欄位" };

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(p.category_id)) {
      if (p.name  !== undefined && col["name"]  !== undefined) sheet.getRange(i+1, col["name"]+1).setValue(p.name);
      if (p.icon  !== undefined && col["icon"]  !== undefined) sheet.getRange(i+1, col["icon"]+1).setValue(p.icon);
      if (p.color !== undefined && col["color"] !== undefined) sheet.getRange(i+1, col["color"]+1).setValue(p.color);
      return { success: true };
    }
  }
  return { success: false, error: "找不到類別" };
}

// ── deleteCategory ─────────────────────────────────────────
function deleteCategory(p) {
  if (!p.category_id) return { success: false, error: "缺少 category_id" };
  const sheet = getSheet(CAT_SHEET);
  const data  = sheet.getDataRange().getValues();
  const col   = buildColMap(data[0]);
  const idCol = col["category_id"];
  if (idCol === undefined) return { success: false, error: "找不到 category_id 欄位" };

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(p.category_id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: "找不到類別" };
}

// ── Gemini AI helpers ──────────────────────────────────────
function listGeminiModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log("Status: " + resp.getResponseCode());
  Logger.log(resp.getContentText());
}
function callGemini(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) return { success: false, error: "尚未設定 GEMINI_API_KEY，請至 Apps Script「專案設定 > 指令碼屬性」新增。" };

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=" + apiKey;
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
  });

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: payload,
      muteHttpExceptions: true
    });
    const rawText = resp.getContentText();
    const statusCode = resp.getResponseCode();
    Logger.log("Gemini status: " + statusCode);
    Logger.log("Gemini response: " + rawText);
    const result = JSON.parse(rawText);
    if (result.error) return { success: false, error: "[" + statusCode + "] " + result.error.message };
    const text = result.candidates[0].content.parts[0].text;
    return { success: true, text: text };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function buildSummaryPrompt(goals) {
  const today = new Date();
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

  const dayOfWk  = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dayOfWk);
  weekStart.setHours(0, 0, 0, 0);

  const activeGoals = goals.filter(g => g.status !== "done" && g.status !== "archived");

  const goalsDesc = activeGoals.map(g => {
    const total = (g.milestones || []).length;
    const done  = (g.milestones || []).filter(m => m.status === "done").length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    const weekDone = (g.milestones || []).filter(m => {
      if (m.status !== "done" || !m.completed_at) return false;
      return new Date(m.completed_at) >= weekStart;
    }).length;
    const daysLeft = g.target_date
      ? Math.ceil((new Date(g.target_date) - today) / 86400000)
      : null;
    return `- 目標：${g.title}（類別：${g.category}，進度：${pct}%，${done}/${total} 里程碑完成` +
           (weekDone > 0 ? `，本週完成 ${weekDone} 項` : "") +
           (daysLeft !== null ? `，距截止 ${daysLeft} 天` : "") + ")";
  }).join("\n");

  return `今天是 ${todayStr}，以下是我的目標追蹤狀況：

${goalsDesc}

請用繁體中文，以一段連貫的話（約 80～120 字）幫我總結本週狀況，內容需涵蓋：
1. 亮點（有什麼值得肯定的進展）
2. 注意事項（哪些目標進度落後或即將到期需要注意）
3. 下週建議（最優先應衝刺哪些目標）

語氣輕鬆直接，不要分點列舉，整合成自然流暢的一段話即可。`;
}

// ── generateAiSummary ──────────────────────────────────────
function generateAiSummary() {
  const goalsData = getGoals();
  if (!goalsData.success) return goalsData;

  const prompt = buildSummaryPrompt(goalsData.data);
  const result = callGemini(prompt);
  if (!result.success) return result;

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d");
  return { success: true, summary: result.text, generated_at: today };
}

// ── askAi ──────────────────────────────────────────────────
function askAi(p) {
  if (!p.question) return { success: false, error: "缺少問題內容" };

  const goalsData = getGoals();
  const goals     = goalsData.success ? goalsData.data : [];
  const activeGoals = goals.filter(g => g.status !== "done" && g.status !== "archived");

  const goalsDesc = activeGoals.map(g => {
    const total = (g.milestones || []).length;
    const done  = (g.milestones || []).filter(m => m.status === "done").length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    return `- ${g.title}（${pct}%，截止：${g.target_date || "未設定"}）`;
  }).join("\n");

  const prompt = `以下是使用者的目標追蹤資料：
${goalsDesc || "（目前沒有進行中的目標）"}

使用者問題：${p.question}

請用繁體中文，簡潔地回答（100字以內），聚焦在目標管理相關的實用建議。`;

  const result = callGemini(prompt);
  if (!result.success) return result;
  return { success: true, answer: result.text };
}
