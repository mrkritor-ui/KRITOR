(function () {
  "use strict";

  /* ---------------------------------------------------------
     CONFIG
  --------------------------------------------------------- */

  const DATA_PATH = "artworks.js";

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
  let fileSha = null;
  let fileText = "";
  let busy = false;


  /* ---------------------------------------------------------
     SETTINGS
  --------------------------------------------------------- */

  function getSettings() {
    return {
      owner: localStorage.getItem("works_gh_owner") || "",
      repo: localStorage.getItem("works_gh_repo") || "",
      branch: localStorage.getItem("works_gh_branch") || "main",
      token: localStorage.getItem("works_gh_token") || ""
    };
  }

  function haveSettings() {
    const s = getSettings();

    return !!(
      s.owner &&
      s.repo &&
      s.branch &&
      s.token
    );
  }

  function fillSettingsForm() {
    const s = getSettings();

    setOwner.value = s.owner;
    setRepo.value = s.repo;
    setBranch.value = s.branch;
    setToken.value = s.token;
  }

  function openSettings() {
    settingsPanel.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");

    setTimeout(function () {
      if (!setOwner.value) {
        setOwner.focus();
      }
    }, 50);
  }

  function closeSettings() {
    settingsPanel.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
  }

  settingsToggle.addEventListener("click", function () {
    if (settingsPanel.hidden) {
      openSettings();
    } else {
      closeSettings();
    }
  });

  settingsSave.addEventListener("click", function () {
    const owner = setOwner.value.trim();
    const repo = setRepo.value.trim();
    const branch = setBranch.value.trim() || "main";
    const token = setToken.value.trim();

    if (!owner || !repo || !token) {
      setStatus(
        "Enter the repo owner, repo name and access token.",
        "error"
      );
      return;
    }

    localStorage.setItem("works_gh_owner", owner);
    localStorage.setItem("works_gh_repo", repo);
    localStorage.setItem("works_gh_branch", branch);
    localStorage.setItem("works_gh_token", token);

    closeSettings();

    loadArtworks();
  });

  settingsClear.addEventListener("click", function () {
    localStorage.removeItem("works_gh_token");

    setToken.value = "";

    setStatus(
      "Token forgotten.",
      "info"
    );
  });


  /* ---------------------------------------------------------
     STATUS
  --------------------------------------------------------- */

  function setStatus(message, kind) {
    statusBar.textContent = message;
    statusBar.className = "status-bar " + (kind || "info");
    statusBar.hidden = false;
  }

  function clearStatus() {
    statusBar.hidden = true;
  }


  /* ---------------------------------------------------------
     GITHUB
  --------------------------------------------------------- */

  function apiBase() {
    const s = getSettings();

    return (
      "https://api.github.com/repos/" +
      encodeURIComponent(s.owner) +
      "/" +
      encodeURIComponent(s.repo) +
      "/contents/"
    );
  }

  function authHeaders() {
    const s = getSettings();

    return {
      Authorization: "Bearer " + s.token,
      Accept: "application/vnd.github+json"
    };
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);

    let binary = "";

    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, i + chunkSize)
      );
    }

    return btoa(binary);
  }

  function encodeBinary(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);

    let binary = "";

    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, i + chunkSize)
      );
    }

    return btoa(binary);
  }

  function decodeBase64(base64) {
    const clean = base64.replace(/\s/g, "");

    const binary = atob(clean);

    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
  }

  async function ghGet(path) {
    const s = getSettings();

    const url =
      apiBase() +
      path +
      "?ref=" +
      encodeURIComponent(s.branch);

    const response = await fetch(url, {
      headers: authHeaders()
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        "GitHub GET failed: " +
        response.status +
        " " +
        text
      );
    }

    return response.json();
  }

  async function ghPut(
    path,
    contentBase64,
    message,
    existingSha
  ) {
    const s = getSettings();

    const body = {
      message: message,
      content: contentBase64,
      branch: s.branch
    };

    if (existingSha) {
      body.sha = existingSha;
    }

    const response = await fetch(
      apiBase() + path,
      {
        method: "PUT",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        "GitHub save failed: " +
        response.status +
        " " +
        text
      );
    }

    return response.json();
  }


  /* ---------------------------------------------------------
     ARTWORKS.JS PARSING
  --------------------------------------------------------- */

  function parseArtworksJS(text) {
    /*
      Finds:

      const ARTWORKS = [
        ...
      ];

      and extracts the array.

      JSON.parse works because the existing catalogue uses
      normal JSON-compatible objects.
    */

    const match = text.match(
      /const\s+ARTWORKS\s*=\s*(\[[\s\S]*?\])\s*;/
    );

    if (!match) {
      throw new Error(
        "Couldn't find the ARTWORKS array in artworks.js."
      );
    }

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      throw new Error(
        "artworks.js contains an invalid artwork list."
      );
    }
  }

  function buildArtworksJS(originalText, artworks) {
    const replacement =
      "const ARTWORKS = " +
      JSON.stringify(artworks, null, 2) +
      ";";

    const match = originalText.match(
      /const\s+ARTWORKS\s*=\s*(\[[\s\S]*?\])\s*;/
    );

    if (!match) {
      throw new Error(
        "Couldn't find the ARTWORKS array in artworks.js."
      );
    }

    return originalText.replace(
      match[0],
      replacement
    );
  }


  /* ---------------------------------------------------------
     LOAD
  --------------------------------------------------------- */

  async function loadArtworks() {
    if (!haveSettings()) {
      setStatus(
        "Connect this admin to your GitHub repository.",
        "info"
      );

      openSettings();

      list.innerHTML = "";

      return;
    }

    setStatus(
      "Loading catalogue…",
      "info"
    );

    try {
      const file = await ghGet(DATA_PATH);

      if (!file) {
        throw new Error(
          "artworks.js was not found in the repository."
        );
      }

      fileSha = file.sha;
      fileText = decodeBase64(file.content);

      ARTWORKS = parseArtworksJS(fileText);

      clearStatus();

      renderList();

    } catch (error) {
      console.error(error);

      setStatus(
        error.message ||
        "Couldn't load the catalogue.",
        "error"
      );
    }
  }


  /* ---------------------------------------------------------
     SAVE ARTWORKS.JS
  --------------------------------------------------------- */

  async function commitArtworks(message) {
    const latest = await ghGet(DATA_PATH);

    if (!latest) {
      throw new Error(
        "artworks.js no longer exists in the repository."
      );
    }

    const latestText = decodeBase64(latest.content);

    const newText = buildArtworksJS(
      latestText,
      ARTWORKS
    );

    const encoded = encodeBase64(newText);

    const result = await ghPut(
      DATA_PATH,
      encoded,
      message,
      latest.sha
    );

    fileSha = result.content.sha;
    fileText = newText;
  }


  /* ---------------------------------------------------------
     HTML ESCAPING
  --------------------------------------------------------- */

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  /* ---------------------------------------------------------
     RENDER LIST
  --------------------------------------------------------- */

  function renderList() {
    list.innerHTML = "";

    if (!ARTWORKS.length) {
      list.innerHTML =
        '<div class="empty-admin">' +
        'No works yet. Tap "+ Add work".' +
        "</div>";

      return;
    }

    ARTWORKS.forEach(function (work, index) {
      list.appendChild(
        buildItem(work, index)
      );
    });
  }

  function buildItem(work, index) {
    const item = document.createElement("div");

    item.className = "admin-item";

    const row = document.createElement("button");

    row.type = "button";
    row.className = "admin-item-row";

    const status =
      work.status || "available";

    row.innerHTML = `
      <img
        src="${esc(work.image || "")}"
        alt=""
      >

      <span class="admin-item-dot ${esc(status)}"></span>

      <span class="admin-item-info">
        <span class="title">
          ${esc(work.title || "Untitled")}
        </span>

        <span class="sub">
          ${esc(
            [work.year, work.collection]
              .filter(Boolean)
              .join(" · ")
          )}
        </span>
      </span>

      <span class="admin-item-chevron">
        ›
      </span>
    `;

    row.addEventListener("click", function () {
      item.classList.toggle("open");
    });

    item.appendChild(row);

    item.appendChild(
      buildEditForm(work, index)
    );
/* iPad/iOS keyboard support for dynamically-created fields */

form.querySelectorAll("input, select").forEach(function (input) {
  enableIOSInputFocus(input);
});
    return item;
  }


  /* ---------------------------------------------------------
     EDIT FORM
  --------------------------------------------------------- */

  function buildEditForm(work, index) {
    const form = document.createElement("div");

    form.className = "admin-edit";

    form.innerHTML = `
      <img
        class="admin-edit-preview"
        src="${esc(work.image || "")}"
        alt=""
      >

      <label class="field full">
        <span>Artwork image</span>

        <input
          type="file"
          accept="image/*"
          class="f-image-upload"
        >

        <input
          type="text"
          class="f-image"
          value="${esc(work.image || "")}"
          placeholder="images/work-01.png"
        >
      </label>

      <label class="field">
        <span>Title</span>

        <input
          type="text"
          class="f-title"
          value="${esc(work.title || "")}"
        >
      </label>

      <label class="field">
        <span>Year</span>

        <input
          type="number"
          class="f-year"
          value="${work.year || ""}"
        >
      </label>

      <label class="field">
        <span>Status</span>

        <select class="f-status">
          <option
            value="available"
            ${work.status === "available" ? "selected" : ""}
          >Available</option>

          <option
            value="sold"
            ${work.status === "sold" ? "selected" : ""}
          >Sold</option>

          <option
            value="na"
            ${work.status === "na" ? "selected" : ""}
          >Not for sale</option>
        </select>
      </label>

      <label class="field">
        <span>Price (AUD)</span>

        <input
          type="number"
          min="0"
          step="1"
          class="f-price"
          value="${work.price || 0}"
        >
      </label>

      <label class="field full">
        <span>Collection</span>

        <input
          type="text"
          class="f-collection"
          value="${esc(work.collection || "")}"
          placeholder="Leave blank for standalone"
        >
      </label>

      <label class="field full">
        <span>Size</span>

        <input
          type="text"
          class="f-size"
          value="${esc(work.size || "")}"
          placeholder="60 × 90 cm"
        >
      </label>

      <div class="admin-edit-actions">
        <div class="left">

          <button
            type="button"
            class="btn btn-primary f-save"
          >
            Save changes
          </button>

          <button
            type="button"
            class="btn btn-danger f-delete"
          >
            Delete
          </button>

        </div>
      </div>
    `;

    const $ = function (selector) {
      return form.querySelector(selector);
    };

    const preview = $(".admin-edit-preview");


    /* -------------------------------------------------------
       SAVE
    ------------------------------------------------------- */

    $(".f-save").addEventListener(
      "click",
      async function () {

        const current = ARTWORKS[index];

        current.title =
          $(".f-title").value.trim();

        current.year =
          Number($(".f-year").value) || 0;

        current.status =
          $(".f-status").value;

        current.price =
          Number($(".f-price").value) || 0;

        current.collection =
          $(".f-collection").value.trim();

        current.size =
          $(".f-size").value.trim();

        current.image =
          $(".f-image").value.trim();


        await withBusy(async function () {

          setStatus(
            'Saving "' +
            (current.title || "Untitled") +
            '"…',
            "info"
          );

          await commitArtworks(
            "Update " +
            (current.title || "artwork")
          );

          setStatus(
            "Saved to GitHub.",
            "success"
          );

          renderList();

        });
      }
    );


    /* -------------------------------------------------------
       DELETE
    ------------------------------------------------------- */

    $(".f-delete").addEventListener(
      "click",
      async function () {

        const current = ARTWORKS[index];

        const confirmed = confirm(
          'Delete "' +
          (current.title || "Untitled") +
          '"?\n\nThis will permanently remove it from the catalogue.'
        );

        if (!confirmed) {
          return;
        }

        await withBusy(async function () {

          setStatus(
            "Deleting…",
            "info"
          );

          ARTWORKS.splice(index, 1);

          await commitArtworks(
            "Remove " +
            (current.title || "artwork")
          );

          setStatus(
            "Deleted.",
            "success"
          );

          renderList();
        });
      }
    );


    /* -------------------------------------------------------
       IMAGE UPLOAD
    ------------------------------------------------------- */

    $(".f-image-upload").addEventListener(
      "change",
      async function (event) {

        const file =
          event.target.files[0];

        if (!file) {
          return;
        }

        await withBusy(async function () {

          setStatus(
            "Uploading image…",
            "info"
          );

          const path =
            await uploadBinaryFile(
              file,
              "images",
              index
            );

          $(".f-image").value =
            path;

          preview.src =
            path;

          setStatus(
            "Image uploaded. Save changes to update the catalogue.",
            "success"
          );
        });
      }
    );


    return form;
  }


  /* ---------------------------------------------------------
     IMAGE UPLOAD
  --------------------------------------------------------- */

  async function uploadBinaryFile(
    file,
    folder,
    index
  ) {
    const extension =
      file.name
        .split(".")
        .pop()
        .toLowerCase();

    const artwork =
      ARTWORKS[index];

    let filename =
      artwork.image
        ? artwork.image
            .split("/")
            .pop()
        : "";

    if (!filename) {
      filename =
        "work-" +
        String(index + 1).padStart(2, "0") +
        "." +
        extension;
    } else {
      filename =
        filename.replace(
          /\.[^.]+$/,
          "." + extension
        );
    }

    const path =
      folder +
      "/" +
      filename;

    const existing =
      await ghGet(path);

    const buffer =
      await file.arrayBuffer();

    const encoded =
      encodeBinary(buffer);

    await ghPut(
      path,
      encoded,
      "Upload " + path,
      existing ? existing.sha : undefined
    );

    return path;
  }


  /* ---------------------------------------------------------
     ADD WORK
  --------------------------------------------------------- */

  addBtn.addEventListener(
    "click",
    async function () {

      if (!haveSettings()) {

        openSettings();

        setStatus(
          "Connect to GitHub first.",
          "info"
        );

        return;
      }

      const newWork = {
        title: "Untitled",
        year: new Date().getFullYear(),
        price: 0,
        status: "available",
        collection: "",
        size: "— × — cm",
        image: ""
      };

      ARTWORKS.unshift(newWork);

      renderList();

      const first =
        list.querySelector(
          ".admin-item"
        );

      if (first) {

        first.classList.add("open");

        first.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }

      setStatus(
        'New work added. Fill it in and press "Save changes".',
        "info"
      );
    }
  );


  /* ---------------------------------------------------------
     REFRESH
  --------------------------------------------------------- */

  refreshBtn.addEventListener(
    "click",
    loadArtworks
  );


  /* ---------------------------------------------------------
     BUSY
  --------------------------------------------------------- */

  async function withBusy(fn) {

    if (busy) {
      return;
    }

    busy = true;

    addBtn.disabled = true;
    refreshBtn.disabled = true;

    try {

      await fn();

    } catch (error) {

      console.error(error);

      setStatus(
        error.message ||
        "Something went wrong.",
        "error"
      );

    } finally {

      busy = false;

      addBtn.disabled = false;
      refreshBtn.disabled = false;
    }
  }


  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */

  fillSettingsForm();

  loadArtworks();

})();
const refreshBtn = document.getElementById("refresh");
/* =========================================================
   iOS / iPAD INPUT FOCUS
========================================================= */

function enableIOSInputFocus(input) {
  if (!input) return;

  input.addEventListener(
    "touchend",
    function (event) {
      event.stopPropagation();

      setTimeout(function () {
        input.focus();
      }, 0);
    },
    { passive: true }
  );
}

[
  setOwner,
  setRepo,
  setBranch,
  setToken
].forEach(enableIOSInputFocus);
