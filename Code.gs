// ============================================================
//  Goal Tracker – Google Apps Script 後端
//  請將此檔案貼到 Google Apps Script 編輯器，並重新部署為網路應用程式
//  執行身分：我（your Google account）
//  存取權限：所有人（Anyone, even anonymous）
// ============================================================

const TOKEN       = "goaltracker2026";
const GOALS_SHEET = "Goals";
const MS_SHEET    = "Milestones";

// ── 主入口 ─────────────────────────────────────────────────
function doGet(e) {
  try {
    // CORS header
    if (!e || !e.parameter) return jsonResp({ success: false, error: "No parameters" });
    if (e.parameter.token !== TOKEN) return jsonResp({ success: false, error: "Unauthorized" });

    const action = e.parameter.action;
    switch (action) {
      case "getGoals":        return jsonResp(getGoals());
      case "createGoal":      return jsonResp(createGoal(e.parameter));
      case "updateGoal":      return jsonResp(updateGoal(e.parameter));
      case "deleteGoal":      return jsonResp(deleteGoal(e.parameter));
      case "createMilestone": return jsonResp(createMilestone(e.parameter));
      case "updateMilestone": return jsonResp(updateMilestone(e.parameter));
      case "deleteMilestone": return jsonResp(deleteMilestone(e.parameter));
      case "toggleMilestone": return jsonResp(toggleMilestone(e.parameter));
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
      sheet.appendRow(["goal_id", "title", "category", "target_date", "description", "status", "created_at"]);
    } else if (name === MS_SHEET) {
      sheet.appendRow(["milestone_id", "goal_id", "title", "status", "completed_at", "created_at"]);
    }
  }
  return sheet;
}

function genId(prefix) {
  return prefix + "_" + new Date().getTime() + "_" + Math.random().toString(36).substr(2, 5);
}

// 將 sheet row 轉成 object
function rowsToObjects(data) {
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ── getGoals ───────────────────────────────────────────────
function getGoals() {
  const goalsSheet = getSheet(GOALS_SHEET);
  const msSheet    = getSheet(MS_SHEET);

  const goals = rowsToObjects(goalsSheet.getDataRange().getValues())
    .filter(g => g.status !== "deleted");

  const allMs = rowsToObjects(msSheet.getDataRange().getValues())
    .filter(m => m.status !== "deleted");

  // 建立 milestones map（以 goal_id 為 key）
  const msMap = {};
  allMs.forEach(m => {
    if (!msMap[m.goal_id]) msMap[m.goal_id] = [];
    msMap[m.goal_id].push({
      milestone_id: String(m.milestone_id),
      goal_id:      String(m.goal_id),
      title:        m.title,
      status:       m.status || "pending",
      completed_at: m.completed_at ? String(m.completed_at).slice(0, 10) : null
    });
  });

  const result = goals.map(g => ({
    goal_id:     String(g.goal_id),
    title:       g.title,
    category:    g.category || "work",
    target_date: g.target_date ? String(g.target_date).slice(0, 10) : "",
    description: g.description || "",
    status:      g.status || "active",
    milestones:  msMap[String(g.goal_id)] || []
  }));

  return { success: true, data: result };
}

// ── createGoal ─────────────────────────────────────────────
function createGoal(p) {
  if (!p.title) return { success: false, error: "缺少目標名稱" };
  const sheet = getSheet(GOALS_SHEET);
  const id    = genId("g");
  const now   = new Date().toISOString().slice(0, 10);
  sheet.appendRow([id, p.title, p.category || "work", p.target_date || "", p.description || "", "active", now]);
  return { success: true, goal_id: id };
}

// ── updateGoal ─────────────────────────────────────────────
function updateGoal(p) {
  if (!p.goal_id) return { success: false, error: "缺少 goal_id" };
  const sheet   = getSheet(GOALS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const col     = {};
  headers.forEach((h, i) => col[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col.goal_id]) === String(p.goal_id)) {
      if (p.title       !== undefined) sheet.getRange(i + 1, col.title + 1).setValue(p.title);
      if (p.category    !== undefined) sheet.getRange(i + 1, col.category + 1).setValue(p.category);
      if (p.target_date !== undefined) sheet.getRange(i + 1, col.target_date + 1).setValue(p.target_date);
      if (p.description !== undefined) sheet.getRange(i + 1, col.description + 1).setValue(p.description);
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
  const headers = data[0];
  const col     = {};
  headers.forEach((h, i) => col[h] = i);

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col.goal_id]) === String(p.goal_id)) {
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
  const headers = data[0];
  const col     = {};
  headers.forEach((h, i) => col[h] = i);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col.goal_id]) === String(goalId)) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ── createMilestone ────────────────────────────────────────
function createMilestone(p) {
  if (!p.goal_id) return { success: false, error: "缺少 goal_id" };
  if (!p.title)   return { success: false, error: "缺少里程碑名稱" };
  const sheet = getSheet(MS_SHEET);
  const id    = genId("m");
  const now   = new Date().toISOString().slice(0, 10);
  sheet.appendRow([id, p.goal_id, p.title, "pending", "", now]);
  return { success: true, milestone_id: id };
}

// ── updateMilestone ────────────────────────────────────────
function updateMilestone(p) {
  if (!p.milestone_id) return { success: false, error: "缺少 milestone_id" };
  const sheet   = getSheet(MS_SHEET);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const col     = {};
  headers.forEach((h, i) => col[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col.milestone_id]) === String(p.milestone_id)) {
      if (p.title !== undefined) sheet.getRange(i + 1, col.title + 1).setValue(p.title);
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
  const headers = data[0];
  const col     = {};
  headers.forEach((h, i) => col[h] = i);

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col.milestone_id]) === String(p.milestone_id)) {
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
  const headers = data[0];
  const col     = {};
  headers.forEach((h, i) => col[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col.milestone_id]) === String(p.milestone_id)) {
      const current    = data[i][col.status];
      const newStatus  = current === "done" ? "pending" : "done";
      const completedAt = newStatus === "done" ? new Date().toISOString().slice(0, 10) : "";
      sheet.getRange(i + 1, col.status + 1).setValue(newStatus);
      sheet.getRange(i + 1, col.completed_at + 1).setValue(completedAt);
      return { success: true };
    }
  }
  return { success: false, error: "找不到里程碑" };
}
