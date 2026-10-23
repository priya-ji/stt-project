(() => {
  const PAGE_SIZE = 8;
  const listEl = document.getElementById("list");
  const statsEl = document.getElementById("stats");
  const searchEl = document.getElementById("search");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageInfo = document.getElementById("pageInfo");
  const newBtn = document.getElementById("newBtn");
  const editor = document.getElementById("editor");
  const form = document.getElementById("editForm");
  const cancelBtn = document.getElementById("cancelBtn");
  const editorTitle = document.getElementById("editorTitle");

  let page = 1;
  let total = 0;
  let query = "";
  let editingId = null;
  let searchTimer = null;

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  const fmtDate = (iso) => new Date(iso).toLocaleString();

  // ---------- Rendering ----------
  function itemHtml(t) {
    const snippet = t.text.length > 180 ? t.text.slice(0, 180) + "…" : t.text;
    return `
      <article class="item">
        <div>
          <h3 class="item-title">${esc(t.title)}</h3>
          <p class="snippet">${esc(snippet) || "<em>(empty)</em>"}</p>
          <div class="meta">
            <span class="tag">${esc(t.source)}</span>
            <span class="tag">${esc(t.language || "auto")}</span>
            <span>${fmtDate(t.created_at)}</span>
            <span>${Math.round(t.duration_seconds)}s</span>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn ghost" data-action="edit" data-id="${t.id}">View / Edit</button>
          <button class="btn danger" data-action="delete" data-id="${t.id}">Delete</button>
        </div>
      </article>`;
  }

  async function loadStats() {
    try {
      const s = await API.stats();
      const cards = [
        ["Transcriptions", s.total],
        ["Live recordings", s.live],
        ["Manual notes", s.manual],
        ["Words", s.total_words],
        ["Minutes recorded", (s.total_seconds / 60).toFixed(1)],
      ];
      statsEl.innerHTML = cards
        .map(([label, value]) => `<div class="stat"><div class="num">${value}</div><div class="label">${label}</div></div>`)
        .join("");
    } catch (err) {
      statsEl.innerHTML = "";
    }
  }

  async function load() {
    try {
      const data = await API.list({ page, page_size: PAGE_SIZE, q: query });
      total = data.total;
      listEl.innerHTML = data.items.length
        ? data.items.map(itemHtml).join("")
        : `<p class="empty">No transcriptions yet. Record one or create one manually.</p>`;
    } catch (err) {
      listEl.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    pageInfo.textContent = `Page ${page} of ${pages} · ${total} total`;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= pages;
    loadStats();
  }

  // ---------- Editor dialog (create + update) ----------
  async function openEditor(id = null) {
    editingId = id;
    form.reset();
    if (id) {
      try {
        const t = await API.get(id);
        editorTitle.textContent = "View / edit transcription";
        form.title.value = t.title;
        form.language.value = t.language || "";
        form.text.value = t.text;
      } catch (err) {
        alert(err.message);
        return;
      }
    } else {
      editorTitle.textContent = "New transcription";
    }
    editor.showModal();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      title: form.title.value.trim() || "Untitled",
      text: form.text.value,
      language: form.language.value || null,
    };
    try {
      if (editingId) {
        await API.update(editingId, body);
      } else {
        await API.create({ ...body, source: "manual" });
        page = 1;
      }
      editor.close();
      load();
    } catch (err) {
      alert(err.message);
    }
  });

  cancelBtn.addEventListener("click", () => editor.close());
  newBtn.addEventListener("click", () => openEditor(null));

  // ---------- List actions (event delegation) ----------
  listEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);

    if (button.dataset.action === "edit") {
      openEditor(id);
    } else if (button.dataset.action === "delete") {
      if (!confirm("Delete this transcription? This cannot be undone.")) return;
      try {
        await API.remove(id);
        if (listEl.children.length === 1 && page > 1) page -= 1;
        load();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // ---------- Search & paging ----------
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = searchEl.value.trim();
      page = 1;
      load();
    }, 300);
  });

  prevBtn.addEventListener("click", () => { page -= 1; load(); });
  nextBtn.addEventListener("click", () => { page += 1; load(); });

  load();
})();
