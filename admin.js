(function () {

"use strict";

/* =========================================================
   CONFIG
========================================================= */

const DATA_PATH = "artworks.js";
const IMAGES_PATH = "images";


/* =========================================================
   ELEMENTS
========================================================= */

const settingsToggle =
  document.getElementById("settings-toggle");

const settingsPanel =
  document.getElementById("settings-panel");

const setOwner =
  document.getElementById("set-owner");

const setRepo =
  document.getElementById("set-repo");

const setBranch =
  document.getElementById("set-branch");

const setToken =
  document.getElementById("set-token");

const settingsSave =
  document.getElementById("settings-save");

const settingsClear =
  document.getElementById("settings-clear");

const statusBar =
  document.getElementById("status-bar");

const list =
  document.getElementById("admin-list");

const addBtn =
  document.getElementById("add-work");

const refreshBtn =
  document.getElementById("refresh");


let ARTWORKS = [];
let busy = false;


/* =========================================================
   SETTINGS
========================================================= */

function getSettings() {

  return {

    owner:
      localStorage.getItem(
        "works_gh_owner"
      ) || "",

    repo:
      localStorage.getItem(
        "works_gh_repo"
      ) || "",

    branch:
      localStorage.getItem(
        "works_gh_branch"
      ) || "main",

    token:
      localStorage.getItem(
        "works_gh_token"
      ) || ""

  };

}


function haveSettings() {

  const s = getSettings();

  return !!(
    s.owner &&
    s.repo &&
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


settingsToggle.addEventListener(
  "click",
  function () {

    settingsPanel.hidden =
      !settingsPanel.hidden;

  }
);


settingsSave.addEventListener(
  "click",
  async function () {

    const owner =
      setOwner.value.trim();

    const repo =
      setRepo.value.trim();

    const branch =
      setBranch.value.trim() || "main";

    const token =
      setToken.value.trim();


    if (
      !owner ||
      !repo ||
      !token
    ) {

      setStatus(
        "Enter repo owner, repo name and access token.",
        "error"
      );

      return;

    }


    localStorage.setItem(
      "works_gh_owner",
      owner
    );

    localStorage.setItem(
      "works_gh_repo",
      repo
    );

    localStorage.setItem(
      "works_gh_branch",
      branch
    );

    localStorage.setItem(
      "works_gh_token",
      token
    );


    settingsPanel.hidden = true;

    await loadArtworks();

  }
);


settingsClear.addEventListener(
  "click",
  function () {

    localStorage.removeItem(
      "works_gh_token"
    );

    setToken.value = "";

    setStatus(
      "Token forgotten.",
      "info"
    );

  }
);


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  message,
  kind
) {

  statusBar.textContent =
    message;

  statusBar.className =
    "status-bar " +
    (kind || "info");

  statusBar.hidden = false;

}


function clearStatus() {

  statusBar.hidden = true;

}


/* =========================================================
   GITHUB
========================================================= */

function apiBase() {

  const s =
    getSettings();

  return (
    "https://api.github.com/repos/" +
    encodeURIComponent(s.owner) +
    "/" +
    encodeURIComponent(s.repo) +
    "/contents/"
  );

}


function githubPath(path) {

  return path
    .split("/")
    .map(
      function (part) {
        return encodeURIComponent(part);
      }
    )
    .join("/");

}


function authHeaders() {

  const s =
    getSettings();

  return {

    Authorization:
      "Bearer " + s.token,

    Accept:
      "application/vnd.github+json"

  };

}


async function ghGet(path) {

  const s =
    getSettings();

  const response =
    await fetch(
      apiBase() +
      githubPath(path) +
      "?ref=" +
      encodeURIComponent(
        s.branch
      ),
      {
        headers:
          authHeaders(),

        cache:
          "no-store"
      }
    );


  if (
    response.status === 404
  ) {

    return null;

  }


  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      "GitHub request failed: " +
      response.status +
      " " +
      text
    );

  }


  return response.json();

}


function encodeBase64(text) {

  const bytes =
    new TextEncoder()
      .encode(text);

  let binary = "";

  for (
    let i = 0;
    i < bytes.length;
    i += 0x8000
  ) {

    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + 0x8000
        )
      );

  }

  return btoa(binary);

}


function decodeBase64(base64) {

  const binary =
    atob(
      base64.replace(
        /\s/g,
        ""
      )
    );

  const bytes =
    new Uint8Array(
      binary.length
    );


  for (
    let i = 0;
    i < binary.length;
    i++
  ) {

    bytes[i] =
      binary.charCodeAt(i);

  }


  return new TextDecoder()
    .decode(bytes);

}


async function ghPut(
  path,
  content,
  message,
  sha
) {

  const s =
    getSettings();

  const body = {

    message:
      message,

    content:
      content,

    branch:
      s.branch

  };


  if (sha) {

    body.sha = sha;

  }


  const response =
    await fetch(
      apiBase() +
      githubPath(path),
      {

        method:
          "PUT",

        headers: {

          ...authHeaders(),

          "Content-Type":
            "application/json"

        },

        body:
          JSON.stringify(body)

      }
    );


  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      "GitHub save failed: " +
      response.status +
      " " +
      text
    );

  }


  return response.json();

}


/* =========================================================
   ARTWORKS.JS PARSER
========================================================= */

function parseArtworksJS(text) {

  try {

    const factory =
      new Function(
        text +
        "\nreturn ARTWORKS;"
      );

    const result =
      factory();


    if (
      !Array.isArray(result)
    ) {

      throw new Error(
        "ARTWORKS is not an array."
      );

    }


    return result;

  }

  catch (error) {

    console.error(
      "artworks.js parsing error:",
      error
    );

    throw new Error(
      "Could not read artworks.js."
    );

  }

}


/* =========================================================
   STABLE ARTWORK IDS
========================================================= */

function makeArtworkId(
  artwork,
  index
) {

  if (
    artwork.id
  ) {

    return String(
      artwork.id
    );

  }


  if (
    artwork.image
  ) {

    const filename =
      artwork.image
        .split("/")
        .pop()
        .replace(
          /\.[^.]+$/,
          ""
        );

    if (
      filename
    ) {

      return filename;

    }

  }


  return (
    "work-" +
    String(
      index + 1
    ).padStart(
      2,
      "0"
    )
  );

}


function normaliseArtworks(
  artworks
) {

  return artworks.map(
    function (
      artwork,
      index
    ) {

      return {

        ...artwork,

        id:
          makeArtworkId(
            artwork,
            index
          )

      };

    }
  );

}


/* =========================================================
   ARTWORK DIMENSIONS
========================================================= */

function parseArtworkDimensions(size) {

  if (!size) {
    return null;
  }


  const match =
    String(size).match(
      /([\d.]+)\s*[×xX*]\s*([\d.]+)/
    );


  if (!match) {
    return null;
  }


  const width =
    Number(match[1]);

  const height =
    Number(match[2]);


  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {

    return null;

  }


  return {

    width,
    height

  };

}


/* =========================================================
   BUILD ARTWORKS.JS
========================================================= */

function buildArtworksJS(
  original,
  artworks
) {

  const start =
    original.indexOf(
      "const ARTWORKS ="
    );


  if (
    start === -1
  ) {

    throw new Error(
      "const ARTWORKS was not found in artworks.js."
    );

  }


  const arrayStart =
    original.indexOf(
      "[",
      start
    );


  if (
    arrayStart === -1
  ) {

    throw new Error(
      "ARTWORKS array was not found."
    );

  }


  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;
  let arrayEnd = -1;


  for (
    let i = arrayStart;
    i < original.length;
    i++
  ) {

    const char =
      original[i];


    if (inString) {

      if (escaped) {

        escaped = false;

      }

      else if (
        char === "\\"
      ) {

        escaped = true;

      }

      else if (
        char === stringChar
      ) {

        inString = false;

      }

      continue;

    }


    if (
      char === '"' ||
      char === "'" ||
      char === "`"
    ) {

      inString = true;

      stringChar =
        char;

      continue;

    }


    if (
      char === "["
    ) {

      depth++;

    }


    else if (
      char === "]"
    ) {

      depth--;

      if (
        depth === 0
      ) {

        arrayEnd = i;

        break;

      }

    }

  }


  if (
    arrayEnd === -1
  ) {

    throw new Error(
      "Could not find the end of ARTWORKS."
    );

  }


  const newArray =
    JSON.stringify(
      artworks,
      null,
      2
    );


  return (

    original.slice(
      0,
      arrayStart
    ) +

    newArray +

    original.slice(
      arrayEnd + 1
    )

  );

}


/* =========================================================
   LOAD FROM GITHUB
========================================================= */

async function getLatestArtworks() {

  const file =
    await ghGet(
      DATA_PATH
    );


  if (!file) {

    throw new Error(
      "artworks.js was not found."
    );

  }


  const text =
    decodeBase64(
      file.content
    );


  const artworks =
    parseArtworksJS(
      text
    );


  return {

    file:
      file,

    text:
      text,

    artworks:
      normaliseArtworks(
        artworks
      )

  };

}


/* =========================================================
   AUTO-CREATE ARTWORKS FROM IMAGES
========================================================= */

function isImageFile(file) {

  if (
    !file ||
    file.type !== "file"
  ) {

    return false;

  }


  return /\.(jpg|jpeg|png|webp|gif)$/i
    .test(file.name);

}


function imagePathMatches(
  artwork,
  imagePath
) {

  return (
    String(
      artwork.image || ""
    ).toLowerCase()
    ===
    imagePath.toLowerCase()
  );

}


function createArtworkFromImage(
  file,
  existingArtworks
) {

  const imagePath =
    IMAGES_PATH +
    "/" +
    file.name;


  const filename =
    file.name.replace(
      /\.[^.]+$/,
      ""
    );


  let baseId =
    filename
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );


  if (!baseId) {

    baseId =
      "work";

  }


  let id =
    baseId;

  let counter = 2;


  const existingIds =
    new Set(
      existingArtworks.map(
        function (artwork) {
          return String(
            artwork.id || ""
          );
        }
      )
    );


  while (
    existingIds.has(id)
  ) {

    id =
      baseId +
      "-" +
      counter;

    counter++;

  }


  return {

    id,

    title:
      "Untitled",

    year:
      new Date()
        .getFullYear(),

    price:
      0,

    status:
      "available",

    collection:
      "",

    size:
      "— × — cm",

    image:
      imagePath,

    ar: {

      enabled:
        false,

      file:
        "ar/" +
        id +
        ".usdz",

      width:
        0,

      height:
        0

    }

  };

}


async function syncImagesToArtworks(
  latest
) {

  const files =
    await ghGet(
      IMAGES_PATH
    );


  if (!Array.isArray(files)) {

    return latest;

  }


  const imageFiles =
    files.filter(
      isImageFile
    );


  if (!imageFiles.length) {

    return latest;

  }


  const existingArtworks =
    latest.artworks.slice();


  const missingArtworks = [];


  for (
    const file of imageFiles
  ) {

    const imagePath =
      IMAGES_PATH +
      "/" +
      file.name;


    const alreadyExists =
      existingArtworks.some(
        function (artwork) {

          return imagePathMatches(
            artwork,
            imagePath
          );

        }
      );


    if (
      alreadyExists
    ) {

      continue;

    }


    const newArtwork =
      createArtworkFromImage(
        file,
        [
          ...existingArtworks,
          ...missingArtworks
        ]
      );


    missingArtworks.push(
      newArtwork
    );

  }


  if (
    !missingArtworks.length
  ) {

    return latest;

  }


  setStatus(
    missingArtworks.length === 1
      ? "New image found. Creating artwork…"
      : "New images found. Creating artworks…",
    "info"
  );


  const updatedArtworks =
    [
      ...missingArtworks,
      ...existingArtworks
    ];


  const updatedText =
    buildArtworksJS(
      latest.text,
      updatedArtworks
    );


  const result =
    await ghPut(
      DATA_PATH,

      encodeBase64(
        updatedText
      ),

      missingArtworks.length === 1
        ? "Automatically create artwork"
        : "Automatically create artworks",

      latest.file.sha
    );


  return {

    file:
      result.content,

    text:
      updatedText,

    artworks:
      normaliseArtworks(
        updatedArtworks
      )

  };

}


/* =========================================================
   LOAD CATALOGUE
========================================================= */

async function loadArtworks() {

  if (
    !haveSettings()
  ) {

    setStatus(
      "Connect to GitHub first.",
      "info"
    );

    settingsPanel.hidden =
      false;

    list.innerHTML = "";

    return;

  }


  setStatus(
    "Loading catalogue from GitHub…",
    "info"
  );


  try {

    let latest =
      await getLatestArtworks();


    /*
      Scan /images and automatically create
      any missing artwork records.
    */

    latest =
      await syncImagesToArtworks(
        latest
      );


    ARTWORKS =
      latest.artworks;


    clearStatus();

    renderList();

  }

  catch (error) {

    console.error(
      error
    );

    setStatus(
      error.message ||
      "Couldn't load catalogue.",
      "error"
    );

  }

}


/* =========================================================
   SAVE TO GITHUB
========================================================= */

async function saveLatestArtworks(
  updater,
  message
) {

  /*
    Fetch GitHub immediately before saving.

    This prevents an iPad from blindly overwriting
    a newer version saved from the PC.
  */

  const latest =
    await getLatestArtworks();


  const latestArtworks =
    latest.artworks;


  const updatedArtworks =
    await updater(
      latestArtworks
    );


  const updatedText =
    buildArtworksJS(
      latest.text,
      updatedArtworks
    );


  const result =
    await ghPut(
      DATA_PATH,

      encodeBase64(
        updatedText
      ),

      message,

      latest.file.sha
    );


  ARTWORKS =
    normaliseArtworks(
      updatedArtworks
    );


  return result;

}


/* =========================================================
   FIND ARTWORK
========================================================= */

function findArtwork(
  artworks,
  id
) {

  return artworks.find(
    function (artwork) {

      return String(
        artwork.id
      ) === String(id);

    }
  );

}


/* =========================================================
   ESCAPE HTML
========================================================= */

function esc(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/* =========================================================
   RENDER
========================================================= */

function renderList() {

  list.innerHTML = "";


  if (
    !ARTWORKS.length
  ) {

    list.innerHTML =
      '<div class="empty-admin">' +
      "No works yet." +
      "</div>";

    return;

  }


  ARTWORKS.forEach(
    function (
      work,
      index
    ) {

      list.appendChild(
        buildItem(
          work,
          index
        )
      );

    }
  );

}


/* =========================================================
   BUILD ITEM
========================================================= */

function buildItem(
  work,
  index
) {

  const item =
    document.createElement(
      "div"
    );

  item.className =
    "admin-item";


  const row =
    document.createElement(
      "button"
    );


  row.type =
    "button";


  row.className =
    "admin-item-row";


  row.innerHTML = `

    <img
      src="${esc(
        work.image || ""
      )}"
      alt=""
    >

    <span
      class="admin-item-dot ${esc(
        work.status ||
        "available"
      )}"
    ></span>

    <span
      class="admin-item-info"
    >

      <span class="title">
        ${esc(
          work.title ||
          "Untitled"
        )}
      </span>

      <span class="sub">
        ${esc(
          [
            work.year,
            work.collection
          ]
            .filter(Boolean)
            .join(" · ")
        )}
      </span>

    </span>

    <span
      class="admin-item-chevron"
    >
      ›
    </span>

  `;


  row.addEventListener(
    "click",
    function () {

      item.classList.toggle(
        "open"
      );

    }
  );


  item.appendChild(
    row
  );


  item.appendChild(
    buildEditForm(
      work,
      index
    )
  );


  return item;

}


/* =========================================================
   EDIT FORM
========================================================= */

function buildEditForm(
  work,
  index
) {

  const form =
    document.createElement(
      "div"
    );


  form.className =
    "admin-edit";


  form.innerHTML = `

    <img
      class="admin-edit-preview"
      src="${esc(
        work.image || ""
      )}"
      alt=""
    >

    <label class="field full">

      <span>
        Artwork image
      </span>

      <input
        type="file"
        accept="image/*"
        class="f-image-upload"
      >

      <input
        type="text"
        inputmode="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck="false"
        class="f-image"
        value="${esc(
          work.image || ""
        )}"
        placeholder="images/work-01.png"
      >

    </label>


    <label class="field">

      <span>
        Title
      </span>

      <input
        type="text"
        inputmode="text"
        autocomplete="off"
        autocorrect="sentences"
        autocapitalize="sentences"
        spellcheck="true"
        class="f-title"
        value="${esc(
          work.title || ""
        )}"
      >

    </label>


    <label class="field">

      <span>
        Year
      </span>

      <input
        type="number"
        inputmode="numeric"
        class="f-year"
        value="${
          work.year || ""
        }"
      >

    </label>


    <label class="field">

      <span>
        Status
      </span>

      <select
        class="f-status"
      >

        <option
          value="available"
          ${
            work.status ===
            "available"
              ? "selected"
              : ""
          }
        >
          Available
        </option>

        <option
          value="sold"
          ${
            work.status ===
            "sold"
              ? "selected"
              : ""
          }
        >
          Sold
        </option>

        <option
          value="na"
          ${
            work.status ===
            "na"
              ? "selected"
              : ""
          }
        >
          Not for sale
        </option>

      </select>

    </label>


    <label class="field">

      <span>
        Price (AUD)
      </span>

      <input
        type="number"
        inputmode="decimal"
        min="0"
        step="1"
        class="f-price"
        value="${
          work.price || 0
        }"
      >

    </label>


    <label class="field full">

      <span>
        Collection
      </span>

      <input
        type="text"
        inputmode="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="words"
        spellcheck="true"
        class="f-collection"
        value="${esc(
          work.collection || ""
        )}"
        placeholder="Leave blank for standalone"
      >

    </label>


    <label class="field full">

      <span>
        Size
      </span>

      <input
        type="text"
        inputmode="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck="false"
        class="f-size"
        value="${esc(
          work.size || ""
        )}"
        placeholder="60 × 90 cm"
      >

    </label>


    <div
      class="admin-edit-actions"
    >

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


  function $(
    selector
  ) {

    return form.querySelector(
      selector
    );

  }


  /* =======================================================
     SAVE EDIT
  ======================================================= */

  $(".f-save")
    .addEventListener(
      "click",
      async function () {

        const id =
          work.id;


        const size =
          $(".f-size")
            .value
            .trim();


        const image =
          $(".f-image")
            .value
            .trim();


        const dimensions =
          parseArtworkDimensions(
            size
          );


        const values = {

          title:
            $(".f-title")
              .value
              .trim(),

          year:
            Number(
              $(".f-year")
                .value
            ) || 0,

          status:
            $(".f-status")
              .value,

          price:
            Number(
              $(".f-price")
                .value
            ) || 0,

          collection:
            $(".f-collection")
              .value
              .trim(),

          size,

          image,

          ar: {

            enabled:
              !!dimensions && !!image,

            file:
              "ar/" +
              id +
              ".usdz",

            width:
              dimensions
                ? dimensions.width
                : 0,

            height:
              dimensions
                ? dimensions.height
                : 0

          }

        };


        await withBusy(
          async function () {

            setStatus(
              "Checking latest GitHub version…",
              "info"
            );


            await saveLatestArtworks(

              async function (
                latestArtworks
              ) {

                const current =
                  findArtwork(
                    latestArtworks,
                    id
                  );


                if (
                  !current
                ) {

                  throw new Error(
                    "This artwork changed or was deleted on another device. Refresh and try again."
                  );

                }


                Object.assign(
                  current,
                  values
                );


                return latestArtworks;

              },

              "Update " +
              (
                values.title ||
                "artwork"
              )

            );


            setStatus(
              "Saved to GitHub.",
              "success"
            );


            renderList();

          }
        );

      }
    );


  /* =======================================================
     DELETE
  ======================================================= */

  $(".f-delete")
    .addEventListener(
      "click",
      async function () {

        const id =
          work.id;


        if (
          !confirm(
            'Delete "' +
            (
              work.title ||
              "Untitled"
            ) +
            '"?'
          )
        ) {

          return;

        }


        await withBusy(
          async function () {

            setStatus(
              "Checking latest GitHub version…",
              "info"
            );


            await saveLatestArtworks(

              async function (
                latestArtworks
              ) {

                const position =
                  latestArtworks.findIndex(
                    function (
                      artwork
                    ) {

                      return String(
                        artwork.id
                      ) ===
                      String(id);

                    }
                  );


                if (
                  position === -1
                ) {

                  throw new Error(
                    "This artwork no longer exists on GitHub. Refresh the catalogue."
                  );

                }


                latestArtworks.splice(
                  position,
                  1
                );


                return latestArtworks;

              },

              "Remove artwork"

            );


            setStatus(
              "Deleted from GitHub.",
              "success"
            );


            renderList();

          }
        );

      }
    );


  /* =======================================================
     IMAGE UPLOAD
  ======================================================= */

  $(".f-image-upload")
    .addEventListener(
      "change",
      async function (
        event
      ) {

        const file =
          event.target.files[0];


        if (
          !file
        ) {

          return;

        }


        await withBusy(
          async function () {

            setStatus(
              "Uploading image to GitHub…",
              "info"
            );


            const path =
              await uploadImage(
                file,
                work
              );


            $(".f-image").value =
              path;


            const preview =
              form.querySelector(
                ".admin-edit-preview"
              );


            preview.src =
              path;


            setStatus(
              "Image uploaded. Press Save changes.",
              "success"
            );

          }
        );

      }
    );


  return form;

}


/* =========================================================
   IMAGE UPLOAD
========================================================= */

async function uploadImage(
  file,
  artwork
) {

  const extension =
    file.name
      .split(".")
      .pop()
      .toLowerCase();


  let filename;


  if (
    artwork.image
  ) {

    filename =
      artwork.image
        .split("/")
        .pop()
        .replace(
          /\.[^.]+$/,
          "." +
          extension
        );

  }

  else {

    filename =
      artwork.id +
      "." +
      extension;

  }


  const path =
    IMAGES_PATH +
    "/" +
    filename;


  const existing =
    await ghGet(
      path
    );


  const buffer =
    await file.arrayBuffer();


  const bytes =
    new Uint8Array(
      buffer
    );


  let binary = "";


  for (
    let i = 0;
    i < bytes.length;
    i += 0x8000
  ) {

    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + 0x8000
        )
      );

  }


  const base64 =
    btoa(binary);


  await ghPut(
    path,

    base64,

    "Upload " +
    path,

    existing
      ? existing.sha
      : undefined
  );


  return path;

}


/* =========================================================
   ADD WORK — MANUAL FALLBACK
========================================================= */

addBtn.addEventListener(
  "click",
  async function () {

    if (
      !haveSettings()
    ) {

      settingsPanel.hidden =
        false;

      setStatus(
        "Connect to GitHub first.",
        "info"
      );

      return;

    }


    await withBusy(
      async function () {

        setStatus(
          "Adding work to GitHub…",
          "info"
        );


        const id =
          "work-" +
          Date.now()
            .toString(36);


        const newWork = {

          id,

          title:
            "Untitled",

          year:
            new Date()
              .getFullYear(),

          price:
            0,

          status:
            "available",

          collection:
            "",

          size:
            "— × — cm",

          image:
            "",

          ar: {

            enabled:
              false,

            file:
              "ar/" +
              id +
              ".usdz",

            width:
              0,

            height:
              0

          }

        };


        await saveLatestArtworks(

          async function (
            latestArtworks
          ) {

            latestArtworks.unshift(
              newWork
            );

            return latestArtworks;

          },

          "Add new artwork"

        );


        renderList();


        const first =
          list.querySelector(
            ".admin-item"
          );


        if (
          first
        ) {

          first.classList.add(
            "open"
          );


          first.scrollIntoView({

            behavior:
              "smooth",

            block:
              "start"

          });

        }


        setStatus(
          "New work saved to GitHub. Fill it in and save.",
          "success"
        );

      }
    );

  }
);


/* =========================================================
   REFRESH
========================================================= */

refreshBtn.addEventListener(
  "click",
  async function () {

    if (
      busy
    ) {

      return;

    }


    await loadArtworks();

  }
);


/* =========================================================
   BUSY
========================================================= */

async function withBusy(
  fn
) {

  if (
    busy
  ) {

    return;

  }


  busy = true;


  addBtn.disabled =
    true;

  refreshBtn.disabled =
    true;


  try {

    await fn();

  }

  catch (error) {

    console.error(
      error
    );


    setStatus(
      error.message ||
      "Something went wrong.",
      "error"
    );

  }

  finally {

    busy = false;


    addBtn.disabled =
      false;

    refreshBtn.disabled =
      false;

  }

}


/* =========================================================
   START
========================================================= */

fillSettingsForm();

loadArtworks();

})();
