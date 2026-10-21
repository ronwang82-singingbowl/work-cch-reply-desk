const state = {data: null, baseData: null, customSections: [], replyChanges: {overrides: {}, added: []}, phoneChanges: {}, deletedItems: [], section: "常用", audience: "全部", query: "", order: [], itemOrders: {}};
const $ = (id) => document.getElementById(id);
const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/\s+/g, "");
const orderKey = "reply-desk-section-order-v1";
const itemOrderKey = "reply-desk-item-order-v1";
const replyChangesKey = "reply-desk-reply-changes-v1";
const customSectionsKey = "reply-desk-custom-sections-v1";
const phoneChangesKey = "reply-desk-phone-changes-v1";
const deletedItemsKey = "reply-desk-deleted-items-v1";
let toastTimer;
let sortDrag = null;
let inlineDrag = null;
let sortMode = "sections";
let replyDialogTrigger = null;
let sectionDialogTrigger = null;
let phoneDialogTrigger = null;
let deleteDialogTrigger = null;
let deleteTarget = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2400);
}

async function copy(text) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error("Clipboard unavailable");
  } catch (_) {
    const input = node("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const success = document.execCommand("copy");
    input.remove();
    if (!success) { toast("複製失敗，請手動選取文字"); return; }
  }
  toast("已複製到剪貼簿");
}

function copyButton(label, value) {
  const button = node("button", "copy-button", label);
  button.type = "button";
  button.addEventListener("click", () => copy(value));
  return button;
}

function loadOrder() {
  const names = state.data.sections.map((section) => section.name);
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(orderKey) || "[]"); } catch (_) { /* Browser storage may be disabled. */ }
  if (!Array.isArray(saved)) saved = [];
  return [...new Set([...saved.filter((name) => names.includes(name)), ...names])];
}

function saveOrder() {
  try { localStorage.setItem(orderKey, JSON.stringify(state.order)); }
  catch (_) { toast("瀏覽器未允許儲存排序，重新開啟後可能恢復原順序"); }
}

function loadItemOrders() {
  try {
    const saved = JSON.parse(localStorage.getItem(itemOrderKey) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
  } catch (_) { /* Browser storage may be disabled. */ }
  return {};
}

function getItemOrder(section) {
  const ids = section.items.map((item) => item.id);
  const saved = state.itemOrders[section.name];
  return [...new Set([...(Array.isArray(saved) ? saved.filter((id) => ids.includes(id)) : []), ...ids])];
}

function saveItemOrders() {
  try { localStorage.setItem(itemOrderKey, JSON.stringify(state.itemOrders)); }
  catch (_) { toast("瀏覽器未允許儲存排序，重新開啟後可能恢復原順序"); }
}

function loadReplyChanges() {
  try {
    const saved = JSON.parse(localStorage.getItem(replyChangesKey) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return {
        overrides: saved.overrides && typeof saved.overrides === "object" && !Array.isArray(saved.overrides) ? saved.overrides : {},
        added: Array.isArray(saved.added) ? saved.added : []
      };
    }
  } catch (_) { /* Invalid saved data falls back to the source content. */ }
  return {overrides: {}, added: []};
}

function loadCustomSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(customSectionsKey) || "[]");
    if (!Array.isArray(saved)) return [];
    const used = new Set(state.baseData.sections.map((section) => normalize(section.name)));
    return saved.filter((value) => {
      if (typeof value !== "string" || !value.trim() || value.length > 40 || used.has(normalize(value))) return false;
      used.add(normalize(value));
      return true;
    });
  } catch (_) { return []; }
}

function loadPhoneChanges() {
  try {
    const saved = JSON.parse(localStorage.getItem(phoneChangesKey) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch (_) { return {}; }
}

function loadDeletedItems() {
  try {
    const saved = JSON.parse(localStorage.getItem(deletedItemsKey) || "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch (_) { return []; }
}

function applyReplyChanges() {
  const sections = [
    ...state.baseData.sections.map((section) => ({...section, items: section.items.map((item) => ({...item}))})),
    ...state.customSections.map((name) => ({name, kind: "reply", items: []}))
  ];
  const replySections = new Map(sections.filter((section) => section.kind === "reply").map((section) => [section.name, section]));
  const originalReplies = sections.filter((section) => section.kind === "reply")
    .flatMap((section) => section.items.map((item) => ({item, sectionName: section.name})));
  for (const section of replySections.values()) section.items = [];
  for (const {item, sectionName} of originalReplies) {
    const change = state.replyChanges.overrides[item.id];
    const target = replySections.get(change?.section) || replySections.get(sectionName);
    target.items.push({
      ...item,
      audience: typeof change?.audience === "string" ? change.audience : item.audience,
      title: typeof change?.title === "string" ? change.title : item.title,
      body: typeof change?.body === "string" ? change.body : item.body
    });
  }
  const ids = new Set(originalReplies.map(({item}) => item.id));
  for (const item of state.replyChanges.added) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) || !replySections.has(item.section)) continue;
    if (!["audience", "title", "body"].every((key) => typeof item[key] === "string")) continue;
    ids.add(item.id);
    replySections.get(item.section).items.push({id: item.id, audience: item.audience, title: item.title, body: item.body});
  }
  const deleted = new Set(state.deletedItems);
  for (const section of sections) {
    if (section.kind === "phone") {
      section.items = section.items.map((item) => {
        const change = state.phoneChanges[item.id];
        if (!change || !["group", "name", "surname", "phone", "note"].every((key) => typeof change[key] === "string")) return item;
        return {...item, ...change};
      });
    }
    section.items = section.items.filter((item) => !deleted.has(item.id));
  }
  state.data = {...state.baseData, sections};
  $("total-tabs").textContent = sections.length;
  $("total-replies").textContent = sections.filter((section) => section.kind === "reply")
    .reduce((total, section) => total + section.items.length, 0);
}

function openSectionDialog(trigger = document.activeElement) {
  if (!state.data) return;
  sectionDialogTrigger = trigger;
  $("section-name").value = "";
  $("section-error").hidden = true;
  $("section-dialog").hidden = false;
  document.body.classList.add("dialog-open");
  $("section-name").focus();
}

function closeSectionDialog() {
  $("section-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
  if (sectionDialogTrigger?.isConnected) sectionDialogTrigger.focus();
  sectionDialogTrigger = null;
}

function saveSectionForm(event) {
  event.preventDefault();
  const name = $("section-name").value.trim().replace(/\s+/g, " ");
  const error = $("section-error");
  if (!name) { error.textContent = "請輸入分類名稱"; error.hidden = false; return; }
  if (state.data.sections.some((section) => normalize(section.name) === normalize(name))) {
    error.textContent = "這個分類已存在，請換一個名稱";
    error.hidden = false;
    $("section-name").focus();
    return;
  }
  const next = [...state.customSections, name];
  try { localStorage.setItem(customSectionsKey, JSON.stringify(next)); }
  catch (_) { error.textContent = "無法儲存分類，請檢查瀏覽器的網站資料設定"; error.hidden = false; return; }
  state.customSections = next;
  applyReplyChanges();
  state.order = [name, ...state.order];
  saveOrder();
  state.section = name;
  state.audience = "全部";
  state.query = "";
  $("search").value = "";
  history.replaceState(null, "", `#${encodeURIComponent(name)}`);
  closeSectionDialog();
  renderNav();
  render();
  $("section-nav").scrollTo?.({left: 0, top: 0, behavior: "smooth"});
  toast("分類已建立，可以新增回覆或移入現有回覆");
}

function openReplyDialog(item = null, sectionName = state.section, trigger = document.activeElement) {
  if (!state.data) return;
  replyDialogTrigger = trigger;
  const select = $("reply-section");
  select.replaceChildren();
  for (const section of state.data.sections.filter((entry) => entry.kind === "reply")) {
    const option = node("option", "", section.name);
    option.value = section.name;
    select.append(option);
  }
  $("reply-dialog").dataset.itemId = item?.id || "";
  $("reply-dialog-title").textContent = item ? "編輯回覆" : "新增回覆";
  $("reply-section").value = sectionName;
  $("reply-audience").value = item?.audience || "房客";
  $("reply-title").value = item?.title || "";
  $("reply-body").value = item?.body || "";
  $("reply-dialog").hidden = false;
  document.body.classList.add("dialog-open");
  $("reply-title").focus();
}

function closeReplyDialog() {
  $("reply-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
  if (replyDialogTrigger?.isConnected) replyDialogTrigger.focus();
  else $("add-reply").focus();
  replyDialogTrigger = null;
}

function saveReplyForm(event) {
  event.preventDefault();
  const sectionName = $("reply-section").value;
  const section = state.data.sections.find((entry) => entry.name === sectionName && entry.kind === "reply");
  const audience = $("reply-audience").value;
  const title = $("reply-title").value.trim();
  const body = $("reply-body").value.trim();
  if (!section || !["房東", "房客", "房東／房客"].includes(audience)) return;
  if (!title || !body) {
    toast("請填寫情境標題與回覆內容");
    $(title ? "reply-body" : "reply-title").focus();
    return;
  }

  const id = $("reply-dialog").dataset.itemId;
  const previousSection = state.data.sections.find((entry) => entry.kind === "reply" && entry.items.some((item) => item.id === id));
  const previous = state.replyChanges;
  const next = {overrides: {...previous.overrides}, added: [...previous.added]};
  let savedId = id;
  const addedIndex = next.added.findIndex((item) => item.id === id);
  if (addedIndex >= 0) next.added[addedIndex] = {id, section: sectionName, audience, title, body};
  else if (id) next.overrides[id] = {section: sectionName, audience, title, body};
  else {
    savedId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    next.added.push({id: savedId, section: sectionName, audience, title, body});
  }
  try { localStorage.setItem(replyChangesKey, JSON.stringify(next)); }
  catch (_) { toast("無法儲存文案，請檢查瀏覽器的網站資料設定"); return; }

  state.replyChanges = next;
  applyReplyChanges();
  state.section = sectionName;
  state.audience = "全部";
  state.query = "";
  $("search").value = "";
  history.replaceState(null, "", `#${encodeURIComponent(sectionName)}`);
  if (!id || previousSection?.name !== sectionName) {
    state.itemOrders[sectionName] = [savedId, ...getItemOrder(section).filter((itemId) => itemId !== savedId)];
    saveItemOrders();
  }
  closeReplyDialog();
  renderNav();
  render();
  toast(id ? "回覆已更新" : "回覆已新增");
}

function openPhoneDialog(item, trigger) {
  phoneDialogTrigger = trigger;
  $("phone-dialog").dataset.itemId = item.id;
  for (const field of ["group", "name", "surname", "phone", "note"]) {
    $(field === "phone" ? "phone-number" : `phone-${field}`).value = item[field] || "";
  }
  $("phone-dialog").hidden = false;
  document.body.classList.add("dialog-open");
  $("phone-name").focus();
}

function closePhoneDialog() {
  $("phone-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
  if (phoneDialogTrigger?.isConnected) phoneDialogTrigger.focus();
  phoneDialogTrigger = null;
}

function savePhoneForm(event) {
  event.preventDefault();
  const id = $("phone-dialog").dataset.itemId;
  const changes = {};
  for (const field of ["group", "name", "surname", "phone", "note"]) {
    changes[field] = $(field === "phone" ? "phone-number" : `phone-${field}`).value.trim();
  }
  if (!changes.name || !changes.group) return;
  const next = {...state.phoneChanges, [id]: changes};
  try { localStorage.setItem(phoneChangesKey, JSON.stringify(next)); }
  catch (_) { toast("無法儲存電話資料，請檢查瀏覽器的網站資料設定"); return; }
  state.phoneChanges = next;
  closePhoneDialog();
  applyReplyChanges();
  renderNav();
  render();
  toast("電話資料已更新");
}

function deleteButton(item, label) {
  const button = node("button", "delete-item-button", "刪除");
  button.type = "button";
  button.setAttribute("aria-label", `刪除「${label}」`);
  button.addEventListener("click", () => {
    deleteDialogTrigger = button;
    deleteTarget = item.id;
    $("delete-item-name").textContent = `「${label}」`;
    $("delete-dialog").hidden = false;
    document.body.classList.add("dialog-open");
    $("cancel-delete").focus();
  });
  return button;
}

function closeDeleteDialog(restoreFocus = true) {
  $("delete-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
  if (restoreFocus && deleteDialogTrigger?.isConnected) deleteDialogTrigger.focus();
  deleteDialogTrigger = null;
  deleteTarget = null;
}

function confirmDelete() {
  if (!deleteTarget) return;
  const next = [...new Set([...state.deletedItems, deleteTarget])];
  try { localStorage.setItem(deletedItemsKey, JSON.stringify(next)); }
  catch (_) { toast("無法刪除項目，請檢查瀏覽器的網站資料設定"); return; }
  state.deletedItems = next;
  closeDeleteDialog(false);
  applyReplyChanges();
  renderNav();
  render();
  $("section-title").focus();
  toast("項目已刪除");
}

function currentSection() { return state.data.sections.find((section) => section.name === state.section); }
function currentSortOrder() { return sortMode === "sections" ? state.order : getItemOrder(currentSection()); }

function moveSectionToTop() {
  if (state.order[0] === state.section) return;
  state.order = [state.section, ...state.order.filter((name) => name !== state.section)];
  saveOrder();
  renderNav();
  render();
  $("section-nav").scrollTo?.({left: 0, top: 0, behavior: "smooth"});
  toast("分頁已移到最上面");
}

function moveItemToTop(item) {
  const section = currentSection();
  const order = getItemOrder(section);
  if (order[0] === item.id) return;
  state.itemOrders[section.name] = [item.id, ...order.filter((id) => id !== item.id)];
  saveItemOrders();
  render();
  $("section-title").scrollIntoView({block: "start", behavior: "smooth"});
  toast("已移到本分類最上面");
}

function pinButton(item, firstId) {
  if (item.id === firstId) return null;
  const button = node("button", "pin-button", "↑ 置頂");
  button.type = "button";
  button.setAttribute("aria-label", `將 ${item.title || item.name} 移到本分類最上面`);
  button.addEventListener("click", () => moveItemToTop(item));
  return button;
}

function inlineHandle(key, label, row, kind) {
  const handle = node("button", "inline-handle", "⠿");
  handle.type = "button";
  handle.title = `按住滑鼠左鍵拖曳「${label}」`;
  handle.setAttribute("aria-label", `拖曳 ${label} 調整順序；方向鍵可移動`);
  handle.addEventListener("pointerdown", (event) => beginInlineDrag(event, {key, label, row, handle, kind}));
  handle.addEventListener("keydown", (event) => {
    const horizontal = kind === "sections" && window.innerWidth < 651;
    const beforeKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const afterKey = horizontal ? "ArrowRight" : "ArrowDown";
    if (![beforeKey, afterKey, "Home"].includes(event.key)) return;
    event.preventDefault();
    const section = currentSection();
    const order = kind === "sections" ? state.order : getItemOrder(section);
    const index = order.indexOf(key);
    const next = event.key === "Home" ? 0 : index + (event.key === beforeKey ? -1 : 1);
    const remaining = order.filter((id) => id !== key);
    const bounded = Math.max(0, Math.min(next, remaining.length));
    if (bounded === index) return;
    remaining.splice(bounded, 0, key);
    saveInlineOrder(kind, section.name, remaining);
    const container = kind === "sections" ? $("section-nav") : $("cards");
    [...container.querySelectorAll(".drag-entry")].find((entry) => entry.dataset.dragKey === key)?.querySelector(".inline-handle")?.focus();
  });
  return handle;
}

function saveInlineOrder(kind, sectionName, order) {
  if (kind === "sections") {
    state.order = order;
    saveOrder();
    renderNav();
    render();
  } else {
    state.itemOrders[sectionName] = order;
    saveItemOrders();
    render();
  }
}

function updateInlineTarget() {
  if (!inlineDrag) return;
  const drag = inlineDrag;
  drag.container.querySelectorAll(".drag-entry").forEach((entry) => entry.classList.remove("drop-before", "drop-after"));
  drag.targetKey = null;
  const hit = document.elementFromPoint(drag.x, drag.y)?.closest(".drag-entry");
  if (!hit || !drag.container.contains(hit) || hit === drag.row) return;
  drag.targetKey = hit.dataset.dragKey;
  const bounds = hit.getBoundingClientRect();
  const point = drag.horizontal ? drag.x : drag.y;
  const middle = drag.horizontal ? bounds.left + bounds.width / 2 : bounds.top + bounds.height / 2;
  drag.after = point >= middle;
  hit.classList.add(drag.after ? "drop-after" : "drop-before");
}

function autoScrollInline() {
  if (!inlineDrag) return;
  const drag = inlineDrag;
  if (drag.horizontal) {
    const bounds = drag.container.getBoundingClientRect();
    if (drag.x < bounds.left + 38) drag.container.scrollLeft -= 12;
    else if (drag.x > bounds.right - 38) drag.container.scrollLeft += 12;
  } else if (drag.kind === "sections") {
    const sidebar = document.querySelector(".sidebar");
    const bounds = sidebar.getBoundingClientRect();
    if (drag.y < bounds.top + 48) sidebar.scrollTop -= 10;
    else if (drag.y > bounds.bottom - 48) sidebar.scrollTop += 10;
  } else {
    if (drag.y < 72) window.scrollBy(0, -10);
    else if (drag.y > window.innerHeight - 72) window.scrollBy(0, 10);
  }
  updateInlineTarget();
  drag.frame = requestAnimationFrame(autoScrollInline);
}

function beginInlineDrag(event, {key, label, row, handle, kind}) {
  if (event.button !== 0 || inlineDrag || sortDrag) return;
  event.preventDefault();
  const container = kind === "sections" ? $("section-nav") : $("cards");
  const horizontal = kind === "sections" && window.innerWidth < 651;
  handle.setPointerCapture(event.pointerId);
  const ghost = node("div", "inline-ghost", label);
  ghost.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 252)}px`;
  ghost.style.top = `${event.clientY + 12}px`;
  document.body.append(ghost);
  row.classList.add("drag-source");
  inlineDrag = {key, row, handle, ghost, kind, container, horizontal, x: event.clientX, y: event.clientY, targetKey: null, after: false};
  handle.addEventListener("pointermove", onInlineMove);
  handle.addEventListener("pointerup", endInlineDrag);
  handle.addEventListener("pointercancel", cancelInlineDrag);
  inlineDrag.frame = requestAnimationFrame(autoScrollInline);
}

function onInlineMove(event) {
  if (!inlineDrag) return;
  inlineDrag.x = event.clientX;
  inlineDrag.y = event.clientY;
  inlineDrag.ghost.style.left = `${Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 252))}px`;
  inlineDrag.ghost.style.top = `${Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 54))}px`;
  updateInlineTarget();
}

function cleanInlineDrag() {
  if (!inlineDrag) return null;
  const drag = inlineDrag;
  cancelAnimationFrame(drag.frame);
  drag.handle.removeEventListener("pointermove", onInlineMove);
  drag.handle.removeEventListener("pointerup", endInlineDrag);
  drag.handle.removeEventListener("pointercancel", cancelInlineDrag);
  drag.row.classList.remove("drag-source");
  drag.container.querySelectorAll(".drag-entry").forEach((entry) => entry.classList.remove("drop-before", "drop-after"));
  drag.ghost.remove();
  inlineDrag = null;
  return drag;
}

function endInlineDrag(event) {
  if (inlineDrag && event) {
    inlineDrag.x = event.clientX;
    inlineDrag.y = event.clientY;
    updateInlineTarget();
  }
  const drag = cleanInlineDrag();
  if (!drag?.targetKey) return;
  const section = currentSection();
  const order = drag.kind === "sections" ? state.order : getItemOrder(section);
  const remaining = order.filter((key) => key !== drag.key);
  const targetIndex = remaining.indexOf(drag.targetKey);
  if (targetIndex < 0) return;
  remaining.splice(targetIndex + (drag.after ? 1 : 0), 0, drag.key);
  if (remaining.every((key, index) => key === order[index])) return;
  saveInlineOrder(drag.kind, section.name, remaining);
  toast("順序已儲存");
}

function cancelInlineDrag() { cleanInlineDrag(); }

function renderNav() {
  const nav = $("section-nav");
  nav.replaceChildren();
  for (const name of state.order) {
    const section = state.data.sections.find((entry) => entry.name === name);
    if (!section) continue;
    const button = node("button", "nav-button");
    button.type = "button";
    button.dataset.section = section.name;
    button.append(node("span", "", section.name), node("span", "nav-count", section.items.length));
    button.classList.toggle("active", section.name === state.section && !state.query.trim());
    if (section.name === state.section && !state.query.trim()) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => {
      state.section = section.name;
      state.audience = "全部";
      state.query = "";
      $("search").value = "";
      history.replaceState(null, "", `#${encodeURIComponent(section.name)}`);
      render();
      if (window.innerWidth < 651) $("search").scrollIntoView({block: "start", behavior: "smooth"});
    });
    const entry = node("div", "nav-entry drag-entry");
    entry.dataset.dragKey = section.name;
    entry.append(inlineHandle(section.name, section.name, entry, "sections"), button);
    nav.appendChild(entry);
  }
}

function moveSortEntry(key, index, showTop = false) {
  const order = currentSortOrder();
  const previous = order.indexOf(key);
  if (previous < 0) return;
  order.splice(previous, 1);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, key);
  if (sortMode === "sections") {
    state.order = order;
    saveOrder();
    renderNav();
  } else {
    state.itemOrders[state.section] = order;
    saveItemOrders();
    render();
  }
  renderSortList();
  if (showTop) $("sort-list").scrollTop = 0;
}

function renderSortList() {
  const list = $("sort-list");
  const scrollPosition = list.scrollTop;
  list.replaceChildren();
  const section = currentSection();
  const entries = sortMode === "sections"
    ? state.data.sections.map((item) => ({key: item.name, label: item.name, hint: item.kind === "reply" ? `${item.items.length} 則` : "聯絡"}))
    : section.items.map((item) => ({key: item.id, label: item.title || item.name, hint: section.kind === "reply" ? item.audience : section.kind === "phone" ? item.group : "廠商"}));
  for (const key of currentSortOrder()) {
    const entry = entries.find((item) => item.key === key);
    if (!entry) continue;
    const row = node("div", "sort-row");
    row.dataset.entry = key;
    const handle = node("button", "sort-handle", "⠿");
    handle.type = "button";
    handle.setAttribute("aria-label", `拖曳 ${entry.label} 調整順序；方向鍵可移動`);
    handle.addEventListener("pointerdown", (event) => beginSortDrag(event, key, row, handle));
    handle.addEventListener("keydown", (event) => {
      const index = currentSortOrder().indexOf(key);
      if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
      event.preventDefault();
      moveSortEntry(key, event.key === "Home" ? 0 : index + (event.key === "ArrowUp" ? -1 : 1));
      [...list.querySelectorAll(".sort-row")].find((item) => item.dataset.entry === key)?.querySelector(".sort-handle")?.focus();
    });
    const label = node("span", "sort-name", entry.label);
    const kind = node("span", "sort-kind", entry.hint || "");
    const top = node("button", "sort-top", "置頂");
    top.type = "button";
    top.setAttribute("aria-label", `將 ${entry.label} 移到最上面`);
    top.addEventListener("click", () => moveSortEntry(key, 0, true));
    row.append(handle, label, kind, top);
    list.append(row);
  }
  list.scrollTop = scrollPosition;
}

function updateDropTarget() {
  if (!sortDrag) return;
  const hit = document.elementFromPoint(sortDrag.x, sortDrag.y)?.closest(".sort-row");
  $("sort-list").querySelectorAll(".sort-row").forEach((row) => row.classList.remove("drop-before", "drop-after"));
  sortDrag.targetKey = null;
  if (!hit || hit.dataset.entry === sortDrag.key || !$("sort-list").contains(hit)) return;
  sortDrag.targetKey = hit.dataset.entry;
  sortDrag.after = sortDrag.y >= hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2;
  hit.classList.add(sortDrag.after ? "drop-after" : "drop-before");
}

function autoScrollSort() {
  if (!sortDrag) return;
  const list = $("sort-list");
  const bounds = list.getBoundingClientRect();
  if (sortDrag.y < bounds.top + 42) list.scrollTop -= 9;
  else if (sortDrag.y > bounds.bottom - 42) list.scrollTop += 9;
  updateDropTarget();
  sortDrag.frame = requestAnimationFrame(autoScrollSort);
}

function beginSortDrag(event, key, row, handle) {
  if (event.button !== 0 || sortDrag) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  const bounds = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.className = "sort-ghost";
  ghost.style.left = `${bounds.left}px`;
  ghost.style.top = `${bounds.top}px`;
  ghost.style.width = `${bounds.width}px`;
  document.body.append(ghost);
  row.classList.add("drag-source");
  sortDrag = {key, row, handle, ghost, startY: event.clientY, top: bounds.top, x: event.clientX, y: event.clientY, targetKey: null, after: false};
  handle.addEventListener("pointermove", onSortMove);
  handle.addEventListener("pointerup", endSortDrag);
  handle.addEventListener("pointercancel", cancelSortDrag);
  sortDrag.frame = requestAnimationFrame(autoScrollSort);
}

function onSortMove(event) {
  if (!sortDrag) return;
  sortDrag.x = event.clientX;
  sortDrag.y = event.clientY;
  sortDrag.ghost.style.top = `${sortDrag.top + event.clientY - sortDrag.startY}px`;
  updateDropTarget();
}

function cleanSortDrag() {
  if (!sortDrag) return null;
  const drag = sortDrag;
  cancelAnimationFrame(drag.frame);
  drag.handle.removeEventListener("pointermove", onSortMove);
  drag.handle.removeEventListener("pointerup", endSortDrag);
  drag.handle.removeEventListener("pointercancel", cancelSortDrag);
  drag.row.classList.remove("drag-source");
  drag.ghost.remove();
  $("sort-list").querySelectorAll(".sort-row").forEach((row) => row.classList.remove("drop-before", "drop-after"));
  sortDrag = null;
  return drag;
}

function endSortDrag() {
  const drag = cleanSortDrag();
  if (!drag?.targetKey) return;
  const remaining = currentSortOrder().filter((key) => key !== drag.key);
  const targetIndex = remaining.indexOf(drag.targetKey);
  moveSortEntry(drag.key, targetIndex + (drag.after ? 1 : 0));
}

function cancelSortDrag() { cleanSortDrag(); }

function openSortDialog(mode) {
  if (!state.data) return;
  sortMode = mode;
  $("sort-title").textContent = mode === "sections" ? "調整分頁順序" : `調整「${state.section}」項目順序`;
  $("sort-help").textContent = mode === "sections"
    ? "按住左側把手拖曳，或點「置頂」。順序只儲存在目前使用的瀏覽器。"
    : "這裡列出本分類的全部項目。按住左側把手拖曳，或點「置頂」。順序只儲存在目前使用的瀏覽器。";
  renderSortList();
  $("sort-dialog").hidden = false;
  document.body.classList.add("dialog-open");
  $("close-order").focus();
}

function closeSortDialog() {
  const trigger = sortMode === "sections" ? $("edit-order") : $("edit-items");
  cancelSortDrag();
  $("sort-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
  trigger.focus();
}

function matches(item, section) {
  if (!state.query.trim() && section.kind === "reply" && state.audience !== "全部" && !item.audience.includes(state.audience)) return false;
  if (!state.query) return true;
  return normalize(Object.values(item).flat().join(" ")).includes(normalize(state.query));
}

function searchableText(tag, className, value) {
  const element = node(tag, className);
  const query = state.query.trim();
  const content = String(value || "");
  const index = query ? content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (index < 0) element.textContent = content;
  else {
    element.append(document.createTextNode(content.slice(0, index)));
    element.append(node("mark", "search-mark", content.slice(index, index + query.length)));
    element.append(document.createTextNode(content.slice(index + query.length)));
  }
  return element;
}

function replyCard(item, firstId, sectionName) {
  const card = node("article", "card drag-entry");
  card.dataset.dragKey = item.id;
  if (item.audience === "房東") card.classList.add("card-landlord");
  else if (item.audience === "房客") card.classList.add("card-tenant");
  const top = node("div", "card-top");
  const tools = node("div", "card-tools");
  if (firstId !== null) tools.append(inlineHandle(item.id, item.title, card, "items"));
  if (item.audience?.includes("房東")) tools.append(node("span", "badge badge-landlord", "房東"));
  if (item.audience?.includes("房客")) tools.append(node("span", "badge badge-tenant", "房客"));
  if (!item.audience) tools.append(node("span", "badge", "回覆"));
  const pin = firstId === null ? null : pinButton(item, firstId);
  if (pin) tools.append(pin);
  top.append(searchableText("h3", "card-title", item.title), tools);
  card.append(top, searchableText("p", "card-body", item.body));
  const actions = node("div", "card-actions");
  const edit = node("button", "edit-reply-button", "編輯");
  edit.type = "button";
  edit.setAttribute("aria-label", `編輯「${item.title}」`);
  edit.addEventListener("click", () => openReplyDialog(item, sectionName, edit));
  actions.append(edit, deleteButton(item, item.title));
  actions.appendChild(copyButton("複製回覆 ↗", item.body));
  card.appendChild(actions);
  return card;
}

function table(headers, label) {
  const wrap = node("div", "table-scroll");
  const element = node("table", "contact-table");
  element.append(node("caption", "sr-only", label));
  const head = node("thead");
  const row = node("tr");
  for (const heading of headers) row.append(node("th", "", heading));
  head.append(row);
  element.append(head, node("tbody"));
  wrap.append(element);
  return {wrap, body: element.tBodies[0]};
}

function renderPhones(items, container, firstId) {
  const {wrap, body} = table(["姓名", "電話", "稱呼", "備註", "操作"], "電話名單");
  let previousGroup = "";
  for (const item of items) {
    if (item.group !== previousGroup) {
      const groupRow = node("tr", "group-row");
      const heading = node("th", "", item.group || "其他");
      heading.colSpan = 5;
      groupRow.append(heading);
      body.append(groupRow);
      previousGroup = item.group;
    }
    const departed = item.note.includes("離職");
    const row = node("tr", `drag-entry${departed ? " departed" : ""}`);
    row.dataset.dragKey = item.id;
    const nameCell = node("td", "primary-cell");
    if (firstId !== null) nameCell.append(inlineHandle(item.id, item.name, row, "items"));
    nameCell.append(searchableText("span", "", item.name));
    const pin = firstId === null ? null : pinButton(item, firstId);
    if (pin) nameCell.append(pin);
    row.append(nameCell);
    const phoneCell = node("td", "phone-cell");
    if (item.phone) {
      const link = node("a", "phone-link", item.phone);
      link.href = `tel:${item.phone.replace(/[^+0-9]/g, "")}`;
      phoneCell.append(link, copyButton("複製", item.phone));
    } else phoneCell.append(node("span", "muted", "—"));
    row.append(phoneCell);
    row.append(node("td", "", item.surname || "—"));
    const noteCell = node("td");
    if (departed) noteCell.append(node("span", "departed-label", "已離職"));
    if (item.note && item.note !== "離職") noteCell.append(node("span", "", item.note));
    if (!noteCell.hasChildNodes()) noteCell.append(node("span", "muted", "—"));
    row.append(noteCell);
    const actions = node("td", "action-cell");
    const edit = node("button", "edit-reply-button", "編輯");
    edit.type = "button";
    edit.setAttribute("aria-label", `編輯「${item.name}」的電話資料`);
    edit.addEventListener("click", () => openPhoneDialog(item, edit));
    actions.append(edit, deleteButton(item, item.name));
    row.append(actions);
    body.append(row);
  }
  container.append(wrap);
}

function renderVendors(items, container, firstId) {
  const {wrap, body} = table(["廠商／項目", "電話／聯絡方式", "其他資訊", "操作"], "廠商聯絡資訊");
  const hasPhone = (value) => (value.match(/\d/g) || []).length >= 7;
  for (const item of items) {
    const row = node("tr", "drag-entry");
    row.dataset.dragKey = item.id;
    if (item.isMessage) {
      const name = node("td", "primary-cell");
      if (firstId !== null) name.append(inlineHandle(item.id, "派工告知文字", row, "items"));
      name.append(node("span", "", "派工告知文字"));
      row.append(name, node("td", "", "—"), node("td", "detail-cell", item.title));
      const action = node("td", "action-cell");
      action.append(copyButton("複製文字", item.title), deleteButton(item, "派工告知文字"));
      const pin = firstId === null ? null : pinButton(item, firstId);
      if (pin) action.append(pin);
      row.append(action);
      body.append(row);
      continue;
    }
    const name = node("td", "primary-cell");
    if (firstId !== null) name.append(inlineHandle(item.id, item.title, row, "items"));
    name.append(searchableText("span", "", item.title));
    row.append(name);
    for (const fields of [item.fields.filter(hasPhone), item.fields.filter((field) => !hasPhone(field))]) {
      const cell = node("td", "detail-cell");
      if (fields.length) for (const field of fields) cell.append(node("div", "", field));
      else cell.append(node("span", "muted", "—"));
      row.append(cell);
    }
    const action = node("td", "action-cell");
    action.append(copyButton("複製資訊", [item.title, ...item.fields].join("\n")));
    action.append(deleteButton(item, item.title));
    const pin = firstId === null ? null : pinButton(item, firstId);
    if (pin) action.append(pin);
    row.append(action);
    body.append(row);
  }
  container.append(wrap);
}

function renderSearchResults() {
  const cards = $("cards");
  cards.replaceChildren();
  let total = 0;
  for (const name of state.order) {
    const section = state.data.sections.find((entry) => entry.name === name);
    if (!section) continue;
    const byId = new Map(section.items.map((item) => [item.id, item]));
    const items = getItemOrder(section).map((id) => byId.get(id)).filter((item) => item && matches(item, section));
    if (!items.length) continue;
    total += items.length;
    const group = node("section", "search-group");
    const heading = node("div", "search-group-heading");
    heading.append(node("h3", "", section.name), node("span", "search-group-count", `${items.length} 筆`));
    const open = node("button", "search-group-open", "查看分頁 ↗");
    open.type = "button";
    open.addEventListener("click", () => {
      state.section = section.name;
      state.query = "";
      state.audience = "全部";
      $("search").value = "";
      history.replaceState(null, "", `#${encodeURIComponent(section.name)}`);
      render();
      $("section-title").scrollIntoView({block: "start", behavior: "smooth"});
    });
    heading.append(open);
    group.append(heading);
    const results = node("div", "search-group-results");
    if (section.kind === "phone") renderPhones(items, results, null);
    else if (section.kind === "vendor") renderVendors(items, results, null);
    else for (const item of items) results.append(replyCard(item, null, section.name));
    group.append(results);
    cards.append(group);
  }
  $("result-count").textContent = `${total} 筆結果`;
  if (total) return;
  const empty = node("div", "empty");
  empty.append(node("strong", "", "全部分頁都沒有找到符合的內容"), node("span", "", "試試較短的關鍵字，或清除搜尋。"));
  cards.append(empty);
}

function render() {
  const section = state.data.sections.find((s) => s.name === state.section) || state.data.sections[0];
  state.section = section.name;
  const searching = Boolean(state.query.trim());
  document.querySelectorAll(".nav-button").forEach((button) => {
    const active = !searching && button.dataset.section === section.name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("section-title").textContent = searching ? "全部分頁的搜尋結果" : section.name;
  $("section-kicker").textContent = searching ? "快速查找" : section.kind === "reply" ? "回覆範本" : "聯絡資訊";
  $("pin-section").hidden = searching || state.order[0] === section.name;
  $("add-reply").hidden = searching || section.kind !== "reply";
  $("edit-items").hidden = searching || !section.items.length;
  $("item-drag-tip").hidden = searching || !section.items.length;
  $("edit-items").textContent = section.kind === "reply" ? "調整回覆順序" : "調整項目順序";
  $("search").placeholder = "搜尋全部分頁的回覆或聯絡資訊…";

  const filters = $("filters");
  filters.replaceChildren();
  if (!searching && section.kind === "reply") {
    for (const audience of ["全部", "房東", "房客"]) {
      const audienceClass = audience === "房東" ? " filter-landlord" : audience === "房客" ? " filter-tenant" : "";
      const button = node("button", `filter${audienceClass}${state.audience === audience ? " active" : ""}`, audience);
      button.type = "button";
      button.setAttribute("aria-pressed", String(state.audience === audience));
      button.addEventListener("click", () => { state.audience = audience; render(); });
      filters.append(button);
    }
  }

  if (searching) { renderSearchResults(); return; }

  const byId = new Map(section.items.map((item) => [item.id, item]));
  const itemOrder = getItemOrder(section);
  const items = itemOrder.map((id) => byId.get(id)).filter((item) => item && matches(item, section));
  $("result-count").textContent = `${items.length} 筆結果`;
  const cards = $("cards");
  cards.replaceChildren();
  if (!items.length) {
    const empty = node("div", "empty");
    if (section.kind === "reply" && !section.items.length) {
      empty.append(node("strong", "", "這個分類還沒有回覆"), node("span", "", "按「＋ 新增回覆」建立，或到其他分類按「編輯」將回覆移進來。"));
    } else empty.append(node("strong", "", "沒有找到符合的內容"), node("span", "", "換個關鍵字，或切換對象再試試。"));
    cards.append(empty);
    return;
  }
  if (section.kind === "phone") { renderPhones(items, cards, itemOrder[0]); return; }
  if (section.kind === "vendor") { renderVendors(items, cards, itemOrder[0]); return; }
  const fragment = document.createDocumentFragment();
  for (const item of items) fragment.append(replyCard(item, itemOrder[0], section.name));
  cards.append(fragment);
}

async function init() {
  try {
    const platform = navigator.userAgentData?.platform || navigator.platform || "";
    $("shortcut").textContent = /Mac/i.test(platform) ? "⌘ K" : "Ctrl K";
    const response = await fetch("./data.json", {cache: "no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.baseData = await response.json();
    state.customSections = loadCustomSections();
    state.replyChanges = loadReplyChanges();
    state.phoneChanges = loadPhoneChanges();
    state.deletedItems = loadDeletedItems();
    applyReplyChanges();
    $("source-link").href = state.data.sourceUrl;
    state.order = loadOrder();
    state.itemOrders = loadItemOrders();
    state.section = state.order[0];
    const selected = decodeURIComponent(location.hash.slice(1));
    if (state.data.sections.some((s) => s.name === selected)) state.section = selected;
    renderNav();
    render();
  } catch (error) {
    $("cards").replaceChildren(node("div", "empty", "目前無法載入內容，請重新整理頁面。"));
    console.error("Data loading failed", error);
  }
}

$("search").addEventListener("input", (event) => { state.query = event.target.value; if (state.data) render(); });
$("add-reply").addEventListener("click", (event) => openReplyDialog(null, state.section, event.currentTarget));
$("add-section").addEventListener("click", (event) => openSectionDialog(event.currentTarget));
$("section-form").addEventListener("submit", saveSectionForm);
$("close-section").addEventListener("click", closeSectionDialog);
$("cancel-section").addEventListener("click", closeSectionDialog);
$("section-name").addEventListener("input", () => { $("section-error").hidden = true; });
$("section-dialog").addEventListener("click", (event) => { if (event.target === $("section-dialog")) closeSectionDialog(); });
$("reply-form").addEventListener("submit", saveReplyForm);
$("close-reply").addEventListener("click", closeReplyDialog);
$("cancel-reply").addEventListener("click", closeReplyDialog);
$("phone-form").addEventListener("submit", savePhoneForm);
$("close-phone").addEventListener("click", closePhoneDialog);
$("cancel-phone").addEventListener("click", closePhoneDialog);
$("phone-dialog").addEventListener("click", (event) => { if (event.target === $("phone-dialog")) closePhoneDialog(); });
$("cancel-delete").addEventListener("click", () => closeDeleteDialog());
$("close-delete").addEventListener("click", () => closeDeleteDialog());
$("confirm-delete").addEventListener("click", confirmDelete);
$("delete-dialog").addEventListener("click", (event) => { if (event.target === $("delete-dialog")) closeDeleteDialog(); });
$("edit-order").addEventListener("click", () => openSortDialog("sections"));
$("pin-section").addEventListener("click", moveSectionToTop);
$("edit-items").addEventListener("click", () => openSortDialog("items"));
$("close-order").addEventListener("click", closeSortDialog);
$("done-order").addEventListener("click", closeSortDialog);
$("reset-order").addEventListener("click", () => {
  if (sortMode === "sections") {
    state.order = state.data.sections.map((section) => section.name);
    saveOrder(); renderNav();
  } else {
    delete state.itemOrders[state.section];
    saveItemOrders(); render();
  }
  renderSortList();
});
$("sort-dialog").addEventListener("click", (event) => { if (event.target === $("sort-dialog")) closeSortDialog(); });
document.addEventListener("keydown", (event) => {
  if (!$("delete-dialog").hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeDeleteDialog(); return; }
    if (event.key === "Tab") {
      const focusable = [...$("delete-dialog").querySelectorAll("button")];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (!$("phone-dialog").hidden) {
    if (event.key === "Escape") { event.preventDefault(); closePhoneDialog(); return; }
    if (event.key === "Tab") {
      const focusable = [...$("phone-dialog").querySelectorAll("button,input,textarea")];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (!$("section-dialog").hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeSectionDialog(); return; }
    if (event.key === "Tab") {
      const focusable = [...$("section-dialog").querySelectorAll("button,input")];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (!$("reply-dialog").hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeReplyDialog(); return; }
    if (event.key === "Tab") {
      const focusable = [...$("reply-dialog").querySelectorAll("button,input,select,textarea")].filter((element) => !element.hidden);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (!$("sort-dialog").hidden) {
    if (event.key === "Escape") { closeSortDialog(); return; }
    if (event.key === "Tab") {
      const focusable = [...$("sort-dialog").querySelectorAll("button")];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); $("search").focus();
  }
  if (event.key === "Escape" && document.activeElement === $("search")) {
    $("search").value = ""; state.query = ""; if (state.data) render(); $("search").blur();
  }
});
init();
