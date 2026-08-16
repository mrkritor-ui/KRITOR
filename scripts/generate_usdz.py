import json
import os
import shutil
import subprocess
import tempfile
import zipfile

from pxr import Usd, UsdGeom, UsdShade, Sdf


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ARTWORKS_FILE = os.path.join(ROOT, "artworks.js")
AR_ROOT = os.path.join(ROOT, "ar")
AR_IMAGE_ROOT = os.path.join(ROOT, "images", "ar")


# ==========================================================
# READ ARTWORKS
# Supports JSON-style artworks.js and normal JavaScript
# const ARTWORKS = [...]
# ==========================================================

def read_artworks():

    if not os.path.isfile(ARTWORKS_FILE):
        raise RuntimeError(
            f"Artwork file not found: {ARTWORKS_FILE}"
        )

    with open(
        ARTWORKS_FILE,
        "r",
        encoding="utf-8"
    ) as f:
        text = f.read()

    start = text.find("const ARTWORKS")

    if start == -1:
        raise RuntimeError(
            "const ARTWORKS was not found in artworks.js"
        )

    array_start = text.find("[", start)

    if array_start == -1:
        raise RuntimeError(
            "ARTWORKS array was not found."
        )

    # Find matching closing bracket while respecting strings.
    depth = 0
    in_string = False
    string_char = ""
    escaped = False
    array_end = -1

    for i in range(array_start, len(text)):

        char = text[i]

        if in_string:

            if escaped:
                escaped = False

            elif char == "\\":
                escaped = True

            elif char == string_char:
                in_string = False

            continue

        if char in ('"', "'", "`"):
            in_string = True
            string_char = char
            continue

        if char == "[":
            depth += 1

        elif char == "]":

            depth -= 1

            if depth == 0:
                array_end = i
                break

    if array_end == -1:
        raise RuntimeError(
            "Could not find end of ARTWORKS array."
        )

    array_text = text[array_start:array_end + 1]

    # First try strict JSON.
    try:
        artworks = json.loads(array_text)

    except json.JSONDecodeError:

        # artworks.js is JavaScript rather than strict JSON.
        # Use Node, which is already available in GitHub Actions,
        # to evaluate the ARTWORKS array safely enough for this
        # repository-controlled source file.
        node_script = r"""
const fs = require("fs");

const file = process.argv[1];
const text = fs.readFileSync(file, "utf8");

const start = text.indexOf("const ARTWORKS");

if (start === -1) {
    throw new Error("const ARTWORKS not found");
}

const arrayStart = text.indexOf("[", start);

if (arrayStart === -1) {
    throw new Error("ARTWORKS array not found");
}

let depth = 0;
let inString = false;
let stringChar = "";
let escaped = false;
let arrayEnd = -1;

for (let i = arrayStart; i < text.length; i++) {

    const char = text[i];

    if (inString) {

        if (escaped) {
            escaped = false;
        } else if (char === "\\") {
            escaped = true;
        } else if (char === stringChar) {
            inString = false;
        }

        continue;
    }

    if (char === '"' || char === "'" || char === "`") {
        inString = true;
        stringChar = char;
        continue;
    }

    if (char === "[") {
        depth++;
    } else if (char === "]") {
        depth--;

        if (depth === 0) {
            arrayEnd = i;
            break;
        }
    }
}

if (arrayEnd === -1) {
    throw new Error("Could not find end of ARTWORKS array");
}

const arrayText = text.slice(arrayStart, arrayEnd + 1);

const ARTWORKS = Function(
    '"use strict"; return (' + arrayText + ');'
)();

process.stdout.write(JSON.stringify(ARTWORKS));
"""

        try:
            result = subprocess.run(
                [
                    "node",
                    "-e",
                    node_script,
                    ARTWORKS_FILE
                ],
                capture_output=True,
                text=True,
                check=True
            )

            artworks = json.loads(result.stdout)

        except Exception as error:
            raise RuntimeError(
                f"Could not parse artworks.js: {error}"
            )

    if not isinstance(artworks, list):
        raise RuntimeError(
            "ARTWORKS is not an array."
        )

    return artworks


# ==========================================================
# FIND AR IMAGE
# ==========================================================

def find_ar_image(artwork_id):

    if not os.path.isdir(AR_IMAGE_ROOT):
        return None

    for filename in os.listdir(AR_IMAGE_ROOT):

        name, extension = os.path.splitext(filename)

        if (
            name.lower() == artwork_id.lower()
            and extension.lower() in (
                ".png",
                ".jpg",
                ".jpeg"
            )
        ):
            return os.path.join(
                AR_IMAGE_ROOT,
                filename
            )

    return None


# ==========================================================
# CREATE USDZ
# ==========================================================

def create_usdz(artwork):

    artwork_id = str(
        artwork.get("id", "")
    ).strip()

    if not artwork_id:
        print("Skipping artwork with no ID.")
        return

    ar = artwork.get("ar")

    if not isinstance(ar, dict):
        return

    if not ar.get("enabled", False):
        return

    try:
        width_cm = float(
            ar.get("width", 0)
        )

        height_cm = float(
            ar.get("height", 0)
        )

    except (TypeError, ValueError):

        print(
            "Skipping",
            artwork_id,
            "- invalid dimensions."
        )

        return

    if width_cm <= 0 or height_cm <= 0:

        print(
            "Skipping",
            artwork_id,
            "- invalid dimensions."
        )

        return

    # ------------------------------------------------------
    # FIND AR IMAGE
    # ------------------------------------------------------

    image_path = find_ar_image(
        artwork_id
    )

    if not image_path:

        print(
            "Skipping",
            artwork_id,
            "- AR image missing."
        )

        print(
            "Expected:",
            os.path.join(
                AR_IMAGE_ROOT,
                artwork_id + ".png"
            )
        )

        return

    print(
        "Using AR image:",
        image_path
    )

    # ------------------------------------------------------
    # CM → METRES
    # ------------------------------------------------------

    width_m = width_cm / 100.0
    height_m = height_cm / 100.0

    os.makedirs(
        AR_ROOT,
        exist_ok=True
    )

    output_path = os.path.join(
        AR_ROOT,
        artwork_id + ".usdz"
    )

    # Remove old file first.
    if os.path.isfile(output_path):
        os.remove(output_path)

    # ------------------------------------------------------
    # TEMPORARY FILES
    # ------------------------------------------------------

    with tempfile.TemporaryDirectory() as temp:

        usda_path = os.path.join(
            temp,
            "model.usda"
        )

        texture_name = os.path.basename(
            image_path
        )

        texture_path = os.path.join(
            temp,
            texture_name
        )

        shutil.copy2(
            image_path,
            texture_path
        )

        # --------------------------------------------------
        # USD STAGE
        # --------------------------------------------------

        stage = Usd.Stage.CreateNew(
            usda_path
        )

        stage.SetMetadata(
            "metersPerUnit",
            1.0
        )

        stage.SetMetadata(
            "upAxis",
            "Y"
        )

        # --------------------------------------------------
        # ROOT
        # --------------------------------------------------

        root = UsdGeom.Xform.Define(
            stage,
            "/Painting"
        )

        stage.SetDefaultPrim(
            root.GetPrim()
        )

        # --------------------------------------------------
        # RECTANGULAR PAINTING
        # Exactly four vertices and two triangles.
        # --------------------------------------------------

        mesh = UsdGeom.Mesh.Define(
            stage,
            "/Painting/Artwork"
        )

        mesh.CreatePointsAttr([
            (
                -width_m / 2,
                -height_m / 2,
                0
            ),
            (
                width_m / 2,
                -height_m / 2,
                0
            ),
            (
                width_m / 2,
                height_m / 2,
                0
            ),
            (
                -width_m / 2,
                height_m / 2,
                0
            )
        ])

        mesh.CreateFaceVertexCountsAttr([
            3,
            3
        ])

        mesh.CreateFaceVertexIndicesAttr([
            0, 1, 2,
            0, 2, 3
        ])

        # --------------------------------------------------
        # NORMALS
        # --------------------------------------------------

        mesh.CreateNormalsAttr([
            (0, 0, 1)
        ])

        mesh.SetNormalsInterpolation(
            UsdGeom.Tokens.constant
        )

        # --------------------------------------------------
        # UV COORDINATES
        # --------------------------------------------------

        primvars = UsdGeom.PrimvarsAPI(
            mesh
        )

        uv = primvars.CreatePrimvar(
            "st",
            Sdf.ValueTypeNames.TexCoord2fArray,
            UsdGeom.Tokens.faceVarying
        )

        uv.Set([
            (0, 0),
            (1, 0),
            (1, 1),

            (0, 0),
            (1, 1),
            (0, 1)
        ])

        # --------------------------------------------------
        # MATERIAL
        # --------------------------------------------------

        material = UsdShade.Material.Define(
            stage,
            "/Painting/Material"
        )

        shader = UsdShade.Shader.Define(
            stage,
            "/Painting/Material/Shader"
        )

        shader.CreateIdAttr(
            "UsdPreviewSurface"
        )

        shader.CreateInput(
            "roughness",
            Sdf.ValueTypeNames.Float
        ).Set(0.85)

        shader.CreateInput(
            "metallic",
            Sdf.ValueTypeNames.Float
        ).Set(0.0)

        # --------------------------------------------------
        # UV READER
        # --------------------------------------------------

        uv_reader = UsdShade.Shader.Define(
            stage,
            "/Painting/Material/UVReader"
        )

        uv_reader.CreateIdAttr(
            "UsdPrimvarReader_float2"
        )

        uv_reader.CreateInput(
            "varname",
            Sdf.ValueTypeNames.Token
        ).Set("st")

        uv_output = uv_reader.CreateOutput(
            "result",
            Sdf.ValueTypeNames.Float2
        )

        # --------------------------------------------------
        # TEXTURE
        # --------------------------------------------------

        texture = UsdShade.Shader.Define(
            stage,
            "/Painting/Material/Texture"
        )

        texture.CreateIdAttr(
            "UsdUVTexture"
        )

        texture.CreateInput(
            "file",
            Sdf.ValueTypeNames.Asset
        ).Set(
            Sdf.AssetPath(texture_name)
        )

        texture.CreateInput(
            "st",
            Sdf.ValueTypeNames.Float2
        ).ConnectToSource(
            uv_output
        )

        texture_rgb = texture.CreateOutput(
            "rgb",
            Sdf.ValueTypeNames.Float3
        )

        shader.CreateInput(
            "diffuseColor",
            Sdf.ValueTypeNames.Color3f
        ).ConnectToSource(
            texture_rgb
        )

        # --------------------------------------------------
        # SURFACE
        # --------------------------------------------------

        shader_surface = shader.CreateOutput(
            "surface",
            Sdf.ValueTypeNames.Token
        )

        material_surface = (
            material.CreateSurfaceOutput()
        )

        material_surface.ConnectToSource(
            shader_surface
        )

        # --------------------------------------------------
        # MATERIAL BINDING
        # --------------------------------------------------

        UsdShade.MaterialBindingAPI(
            mesh.GetPrim()
        ).Bind(material)

        # --------------------------------------------------
        # SAVE USD
        # --------------------------------------------------

        stage.GetRootLayer().Save()

        # --------------------------------------------------
        # PACKAGE USDZ
        # USDZ requires uncompressed ZIP storage.
        # --------------------------------------------------

        with zipfile.ZipFile(
            output_path,
            "w",
            compression=zipfile.ZIP_STORED
        ) as archive:

            archive.write(
                usda_path,
                "model.usda"
            )

            archive.write(
                texture_path,
                texture_name
            )

    print(
        "Generated:",
        output_path
    )


# ==========================================================
# MAIN
# ==========================================================

def main():

    os.makedirs(
        AR_ROOT,
        exist_ok=True
    )

    artworks = read_artworks()

    print(
        "Found",
        len(artworks),
        "artworks."
    )

    generated = 0

    for artwork in artworks:

        try:

            before = set(
                os.listdir(AR_ROOT)
            )

            create_usdz(artwork)

            after = set(
                os.listdir(AR_ROOT)
            )

            if after != before:
                generated += 1

        except Exception as error:

            artwork_id = artwork.get(
                "id",
                "unknown"
            )

            print(
                "ERROR generating",
                artwork_id,
                ":",
                error
            )

    print(
        "USDZ generation complete."
    )

    print(
        "Generated files:",
        generated
    )


if __name__ == "__main__":
    main()
