(function () {
  const DATA_PATH = "data/artworks.json";

  const settingsToggle = document.getElementById("settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const setOwner = document.getElementById("set-owner");
  const setRepo = document.getElementById("set-repo");
  const setBranch = document.getElementById("set-branch");
  const setToken = document.getElementById("set-token");
  const settingsSave = document.getElementById("settings-save");
  const settingsClear = document.getElementById("settings-clear");

  const statusBar = document.getElementById("status-bar");
  const list = document.getElementById("admin-list");
  const addBtn = document.getElementById("add-work");
  const refreshBtn = document.getElementById("refresh");

  let ARTWORKS = [];
  let sha = null; // current sha of data/artworks.json, needed to commit updates
  let busy = false;

  /* ---------------- settings / auth ---------------- */

  function getSettings() {
    return {
      owner: localStorage.getItem("works_gh_owner") || "",
      repo: localStorage.getItem("works_gh_repo") || "",
      branch: localStorage.getItem("works_gh_branch") || "main",
      token: localStorage.getItem("works_gh_token") || "",
    };
  }

  function haveSettings() {
    const s = getSettings();
    return !!(s.owner && s.repo && s.token);
  }

  function fillSettingsForm() {
    const s = getSettings();
    setOwner.value = s.owner;
    setRepo.value = s.repo;
    setBranch.value = s.branch;
    setToken.value = s.token;
  }

  settingsToggle.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  settingsSave.addEventListener("click", () => {
    localStorage.setItem("works_gh_owner", setOwner.value.trim());
    localStorage.setItem("works_gh_repo", setRepo.value.trim());
    localStorage.setItem("works_gh_branch", setBranch.value.trim() || "main");
    localStorage.setItem("works_gh_token", setToken.value.trim());
    settingsPanel.hidden = true;
    loadArtworks();
  });

  settingsClear.addEventListener("click", () => {
    localStorage.removeItem("works_gh_token");
    setToken.value = "";
    setStatus("Token forgotten. Add it again to save changes.", "info");
  });

  /* ---------------- status bar ---------------- */

  function setStatus(msg, kind) {
    statusBar.textContent = msg;
    statusBar.className = "status-bar " + (kind || "info");
    statusBar.hidden = false;
  }

  function clearStatus() {
    statusBar.hidden = true;
  }

  /* ---------------- GitHub Contents API ---------------- */

  function apiBase() {
    const s = getSettings();
    return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/`;
  }

  function authHeaders() {
    const s = getSettings();
    return {
      Authorization: `Bearer ${s.token}`,
      Accept: "application/vnd.github+json",
    };
  }

  function b64EncodeUnicode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function b64DecodeUnicode(str) {
    return decodeURIComponent(escape(atob(str.replace(/\n/g, ""))));
  }

  // GET a file's metadata (and content, if text). Returns null on 404.
  async function ghGet(path) {
    const s = getSettings();
    const res = await fetch(apiBase() + path + "?ref=" + encodeURIComponent(s.branch), {
      headers: authHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
    return res.json();
  }

  // PUT (create or update) a file. contentB64 must already be base64.
  async function ghPut(path, contentB64, message, existingSha) {
    const s = getSettings();
    const body = {
      message,
      content: contentB64,
      branch: s.branch,
    };
    if (existingSha) body.sha = existingSha;
    const res = await fetch(apiBase() + path, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GitHub PUT ${path} failed: ${res.status} ${errText}`);
    }
    return res.json();
  }

  async function ghDelete(path, message, existingSha) {
    const s = getSettings();
    const res = await fetch(apiBase() + path, {
      method: "DELETE",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, sha: existingSha, branch: s.branch }),
    });
    if (!res.ok) throw new Error(`GitHub DELETE ${path} failed: ${res.status}`);
    return res.json();
  }

  /* ---------------- load / save catalog ---------------- */

  async function loadArtworks() {
    if (!haveSettings()) {
      setStatus("Add your repo owner, name, and access token to connect.", "info");
      settingsPanel.hidden = false;
      list.innerHTML = "";
      return;
    }
    setStatus("Loading catalog\u2026", "info");
    try {
      const file = await ghGet(DATA_PATH);
      if (!file) {
        ARTWORKS = [];
        sha = null;
        setStatus("No data/artworks.json found yet — add a work to create it.", "info");
      } else {
        ARTWORKS = JSON.parse(b64DecodeUnicode(file.content));
        sha = file.sha;
        clearStatus();
      }
      renderList();
    } catch (err) {
      console.error(err);
      setStatus("Couldn't load the catalog — check your settings and token.", "error");
    }
  }

  async function commitArtworks(message) {
    const content = b64EncodeUnicode(JSON.stringify(ARTWORKS, null, 2));
    const result = await ghPut(DATA_PATH, content, message, sha);
    sha = result.content.sha;
  }

  /* ---------------- rendering ---------------- */

  const STATUS_LABEL = { available: "Available", sold: "Sold", na: "Not for sale" };

  function renderList() {
    list.innerHTML = "";
    if (!ARTWORKS.length) {
      list.innerHTML = '<p class="empty-admin">No works yet. Tap "+ Add work" to start the catalog.</p>';
      return;
    }
    ARTWORKS.forEach((work, index) => list.appendChild(buildItem(work, index)));
  }

  function buildItem(work, index) {
    const item = document.createElement("div");
    item.className = "admin-item";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "admin-item-row";
    row.innerHTML = `
      <img src="${work.image || ""}" alt="">
      <span class="admin-item-dot ${work.status}"></span>
      <span class="admin-item-info">
        <span class="title">${work.title || "Untitled"}</span>
        <span class="sub">${[work.year, work.collection].filter(Boolean).join(" \u00b7 ")}</span>
      </span>
      <span class="admin-item-chevron">&#8250;</span>
    `;
    row.addEventListener("click", () => item.classList.toggle("open"));

    const form = buildEditForm(work, index);

    item.appendChild(row);
    item.appendChild(form);
    return item;
  }

  function buildEditForm(work, index) {
    const form = document.createElement("div");
    form.className = "admin-edit";

    form.innerHTML = `
      <img class="admin-edit-preview" src="${work.image || ""}" alt="">

      <label class="field full">
        <span>Cropped image</span>
        <input type="file" accept="image/*" class="f-image-upload">
        <input type="text" class="f-image" value="${work.image || ""}" placeholder="images/work-01.png">
      </label>

      <label class="field">
        <span>Title</span>
        <input type="text" class="f-title" value="${work.title || ""}">
      </label>
      <label class="field">
        <span>Year</span>
        <input type="number" class="f-year" value="${work.year || ""}">
      </label>

      <label class="field">
        <span>Status</span>
        <select class="f-status">
          <option value="available" ${work.status === "available" ? "selected" : ""}>Available</option>
          <option value="sold" ${work.status === "sold" ? "selected" : ""}>Sold</option>
          <option value="na" ${work.status === "na" ? "selected" : ""}>Not for sale</option>
        </select>
      </label>
      <label class="field">
        <span>Price (AUD)</span>
        <input type="number" class="f-price" value="${work.price || 0}">
      </label>

      <label class="field full">
        <span>Collection</span>
        <input type="text" class="f-collection" value="${work.collection || ""}" placeholder="Leave blank for standalone">
      </label>

      <label class="field">
        <span>Size label</span>
        <input type="text" class="f-size" value="${work.size || ""}" placeholder="60 \u00d7 90 cm">
      </label>
      <label class="field"></label>

      <label class="field">
        <span>Real width (cm)</span>
        <input type="number" step="0.1" class="f-width" value="${work.width_cm || 0}">
      </label>
      <label class="field">
        <span>Real height (cm)</span>
        <input type="number" step="0.1" class="f-height" value="${work.height_cm || 0}">
      </label>

      <p class="ar-note">Width/height must match the physical canvas exactly — AR Quick Look scales the model to these numbers. Generate the .usdz in Reality Composer at this exact size, then upload it below.</p>

      <label class="field full">
        <span>AR model (.usdz)</span>
        <input type="file" accept=".usdz" class="f-usdz-upload">
        <input type="text" class="f-usdz" value="${work.usdz || ""}" placeholder="work-01.usdz">
      </label>

      <div class="admin-edit-actions">
        <div class="left">
          <button type="button" class="btn btn-primary f-save">Save changes</button>
          <button type="button" class="btn btn-danger f-delete">Delete</button>
        </div>
      </div>
    `;

    const $ = (sel) => form.querySelector(sel);
    const preview = $(".admin-edit-preview");

    $(".f-save").addEventListener("click", async () => {
      const w = ARTWORKS[index];
      w.title = $(".f-title").value.trim();
      w.year = Number($(".f-year").value) || 0;
      w.status = $(".f-status").value;
      w.price = Number($(".f-price").value) || 0;
      w.collection = $(".f-collection").value.trim();
      w.size = $(".f-size").value.trim();
      w.width_cm = Number($(".f-width").value) || 0;
      w.height_cm = Number($(".f-height").value) || 0;
      w.image = $(".f-image").value.trim();
      w.usdz = $(".f-usdz").value.trim();

      await withBusy(async () => {
        setStatus(`Saving "${w.title || "Untitled"}"\u2026`, "info");
        await commitArtworks(`Update ${w.title || w.id || "artwork"}`);
        setStatus("Saved.", "success");
        renderList();
      });
    });

    $(".f-delete").addEventListener("click", async () => {
      const w = ARTWORKS[index];
      if (!confirm(`Delete "${w.title || "this work"}"? This can't be undone here.`)) return;
      await withBusy(async () => {
        setStatus("Deleting\u2026", "info");
        ARTWORKS.splice(index, 1);
        await commitArtworks(`Remove ${w.title || w.id || "artwork"}`);
        setStatus("Deleted.", "success");
        renderList();
      });
    });

    $(".f-image-upload").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await withBusy(async () => {
        setStatus("Uploading image\u2026", "info");
        const path = await uploadBinaryFile(file, "images", ARTWORKS[index].id);
        $(".f-image").value = path;
        preview.src = path;
        setStatus("Image uploaded — remember to Save changes.", "success");
      });
    });

    $(".f-usdz-upload").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await withBusy(async () => {
        setStatus("Uploading AR model\u2026", "info");
        const path = await uploadBinaryFile(file, "models", ARTWORKS[index].id);
        $(".f-usdz").value = path.replace(/^models\//, "");
        setStatus("Model uploaded — remember to Save changes.", "success");
      });
    });

    return form;
  }

  async function uploadBinaryFile(file, folder, id) {
    const ext = file.name.split(".").pop();
    const path = `${folder}/${id || "work"}.${ext}`;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1];
    const existing = await ghGet(path);
    await ghPut(path, base64, `Upload ${path}`, existing ? existing.sha : undefined);
    return path;
  }

  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong.", "error");
    } finally {
      busy = false;
    }
  }

  /* ---------------- add work ---------------- */

  addBtn.addEventListener("click", async () => {
    if (!haveSettings()) {
      settingsPanel.hidden = false;
      setStatus("Connect to GitHub first.", "info");
      return;
    }
    const id = "work-" + Date.now().toString(36);
    const blank = {
      id,
      title: "Untitled",
      year: new Date().getFullYear(),
      price: 0,
      status: "available",
      collection: "",
      size: "\u2014 \u00d7 \u2014 cm",
      width_cm: 0,
      height_cm: 0,
      image: "",
      usdz: "",
    };
    ARTWORKS.unshift(blank);
    renderList();
    const first = list.querySelector(".admin-item");
    if (first) {
      first.classList.add("open");
      first.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setStatus('New work added below — fill it in, upload an image, then Save.', "info");
  });

  refreshBtn.addEventListener("click", loadArtworks);

  /* ---------------- init ---------------- */

  fillSettingsForm();
  loadArtworks();
})();
