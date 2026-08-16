import json
import os
import shutil
import subprocess
import tempfile

from pxr import (
    Usd,
    UsdGeom,
    UsdShade,
    Sdf,
    Gf,
    UsdUtils,
)


ROOT = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)

ARTWORKS_FILE = os.path.join(
    ROOT,
    "artworks.js"
)

AR_ROOT = os.path.join(
    ROOT,
    "ar"
)

AR_IMAGE_ROOT = os.path.join(
    ROOT,
    "images",
    "ar"
)


# ==========================================================
# ARTWORKS
# ==========================================================

def read_artworks():

    with open(
        ARTWORKS_FILE,
        "r",
        encoding="utf-8"
    ) as f:
        text = f.read()

    start = text.find(
        "const ARTWORKS"
    )

    if start == -1:
        raise RuntimeError(
            "const ARTWORKS not found."
        )

    array_start = text.find(
        "[",
        start
    )

    if array_start == -1:
        raise RuntimeError(
            "ARTWORKS array not found."
        )

    depth = 0
    in_string = False
    string_char = ""
    escaped = False
    array_end = -1

    for i in range(
        array_start,
        len(text)
    ):

        char = text[i]

        if in_string:

            if escaped:
                escaped = False

            elif char == "\\":
                escaped = True

            elif char == string_char:
                in_string = False

            continue

        if char in (
            '"',
            "'",
            "`"
        ):

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

    array_text = text[
        array_start:
        array_end + 1
    ]

    try:

        return json.loads(
            array_text
        )

    except json.JSONDecodeError:

        node_script = r"""
const fs = require("fs");

const file = process.argv[1];
const text = fs.readFileSync(file, "utf8");

const start = text.indexOf("const ARTWORKS");
const arrayStart = text.indexOf("[", start);

let depth = 0;
let inString = false;
let stringChar = "";
let escaped = false;
let arrayEnd = -1;

for (
    let i = arrayStart;
    i < text.length;
    i++
) {

    const char = text[i];

    if (inString) {

        if (escaped) {
            escaped = false;
        }

        else if (char === "\\") {
            escaped = true;
        }

        else if (char === stringChar) {
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
        stringChar = char;
        continue;
    }

    if (char === "[") {
        depth++;
    }

    else if (char === "]") {

        depth--;

        if (depth === 0) {
            arrayEnd = i;
            break;
        }
    }
}

const arrayText = text.slice(
    arrayStart,
    arrayEnd + 1
);

const ARTWORKS = Function(
    '"use strict"; return (' +
    arrayText +
    ');'
)();

process.stdout.write(
    JSON.stringify(ARTWORKS)
);
"""

        result = subprocess.run(
            [
                "node",
                "-e",
                node_script,
                ARTWORKS_FILE
            ],
            capture_output=True,
            text=True
        )

        if result.returncode != 0:

            raise RuntimeError(
                "Could not parse artworks.js:\n" +
                result.stderr
            )

        return json.loads(
            result.stdout
        )


# ==========================================================
# FIND IMAGE
# ==========================================================

def find_ar_image(
    artwork_id
):

    if not os.path.isdir(
        AR_IMAGE_ROOT
    ):
        return None

    target = artwork_id.lower()

    for filename in os.listdir(
        AR_IMAGE_ROOT
    ):

        name, extension = os.path.splitext(
            filename
        )

        if (
            name.lower() == target
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
# CREATE SOURCE USDC
# ==========================================================

def create_source_usdc(
    artwork,
    image_path,
    output_path
):

    artwork_id = str(
        artwork["id"]
    )

    ar = artwork["ar"]

    width_cm = float(
        ar["width"]
    )

    height_cm = float(
        ar["height"]
    )

    width_m = (
        width_cm / 100.0
    )

    height_m = (
        height_cm / 100.0
    )

    texture_name = os.path.basename(
        image_path
    )

    # ------------------------------------------------------
    # CREATE STAGE
    # ------------------------------------------------------

    stage = Usd.Stage.CreateNew(
        output_path
    )

    stage.SetMetadata(
        "metersPerUnit",
        1.0
    )

    stage.SetMetadata(
        "upAxis",
        "Y"
    )

    # ------------------------------------------------------
    # ROOT
    # ------------------------------------------------------

    root = UsdGeom.Xform.Define(
        stage,
        "/Painting"
    )

    stage.SetDefaultPrim(
        root.GetPrim()
    )

    # ------------------------------------------------------
    # MESH
    # ------------------------------------------------------

    mesh = UsdGeom.Mesh.Define(
        stage,
        "/Painting/Artwork"
    )

    mesh.CreatePointsAttr([
        Gf.Vec3f(
            -width_m / 2,
            -height_m / 2,
            0
        ),

        Gf.Vec3f(
            width_m / 2,
            -height_m / 2,
            0
        ),

        Gf.Vec3f(
            width_m / 2,
            height_m / 2,
            0
        ),

        Gf.Vec3f(
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

    # ------------------------------------------------------
    # NORMALS
    # ------------------------------------------------------

    mesh.CreateNormalsAttr([
        Gf.Vec3f(
            0,
            0,
            1
        )
    ])

    mesh.SetNormalsInterpolation(
        UsdGeom.Tokens.constant
    )

    # ------------------------------------------------------
    # UV
    # ------------------------------------------------------

    primvars = UsdGeom.PrimvarsAPI(
        mesh
    )

    uv = primvars.CreatePrimvar(
        "st",
        Sdf.ValueTypeNames.TexCoord2fArray,
        UsdGeom.Tokens.faceVarying
    )

    uv.Set([
        Gf.Vec2f(0, 0),
        Gf.Vec2f(1, 0),
        Gf.Vec2f(1, 1),

        Gf.Vec2f(0, 0),
        Gf.Vec2f(1, 1),
        Gf.Vec2f(0, 1)
    ])

    # ------------------------------------------------------
    # MATERIAL
    # ------------------------------------------------------

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
    ).Set(
        0.8
    )

    shader.CreateInput(
        "metallic",
        Sdf.ValueTypeNames.Float
    ).Set(
        0.0
    )

    # ------------------------------------------------------
    # UV READER
    # ------------------------------------------------------

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
    ).Set(
        "st"
    )

    uv_output = uv_reader.CreateOutput(
        "result",
        Sdf.ValueTypeNames.Float2
    )

    # ------------------------------------------------------
    # TEXTURE
    # ------------------------------------------------------

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
        Sdf.AssetPath(
            texture_name
        )
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

    # ------------------------------------------------------
    # SURFACE
    # ------------------------------------------------------

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

    # ------------------------------------------------------
    # BIND
    # ------------------------------------------------------

    UsdShade.MaterialBindingAPI(
        mesh.GetPrim()
    ).Bind(
        material
    )

    # ------------------------------------------------------
    # SAVE
    # ------------------------------------------------------

    stage.GetRootLayer().Save()


# ==========================================================
# PACKAGE ARKIT USDZ
# ==========================================================

def package_usdz(
    source_usdc,
    image_path,
    output_usdz
):

    # Create a temporary directory containing
    # the source USD and its texture.

    with tempfile.TemporaryDirectory() as temp:

        temp_usdc = os.path.join(
            temp,
            "model.usdc"
        )

        temp_texture = os.path.join(
            temp,
            os.path.basename(
                image_path
            )
        )

        shutil.copy2(
            source_usdc,
            temp_usdc
        )

        shutil.copy2(
            image_path,
            temp_texture
        )

        # Reopen the copied USD so its texture dependency
        # is resolved relative to the USD file.

        stage = Usd.Stage.Open(
            temp_usdc
        )

        if not stage:

            raise RuntimeError(
                "Could not reopen generated USDC."
            )

        success = UsdUtils.CreateNewARKitUsdzPackage(
            Sdf.AssetPath(
                temp_usdc
            ),
            output_usdz
        )

        if not success:

            raise RuntimeError(
                "UsdUtils failed to create ARKit USDZ."
            )


# ==========================================================
# VALIDATE
# ==========================================================

def validate_usdz(
    path
):

    if not os.path.isfile(
        path
    ):

        raise RuntimeError(
            f"USDZ was not created: {path}"
        )

    stage = Usd.Stage.Open(
        path
    )

    if not stage:

        raise RuntimeError(
            f"USDZ could not be opened by USD: {path}"
        )

    default_prim = (
        stage.GetDefaultPrim()
    )

    if not default_prim:

        raise RuntimeError(
            f"USDZ has no defaultPrim: {path}"
        )

    print(
        "Validated:",
        path
    )


# ==========================================================
# CREATE ONE
# ==========================================================

def create_usdz(
    artwork
):

    artwork_id = str(
        artwork.get(
            "id",
            ""
        )
    )

    ar = artwork.get(
        "ar"
    )

    if not isinstance(
        ar,
        dict
    ):
        return

    if not ar.get(
        "enabled",
        False
    ):
        return

    image_path = find_ar_image(
        artwork_id
    )

    if not image_path:

        print(
            "Skipping",
            artwork_id,
            "- AR image missing."
        )

        return

    width = float(
        ar.get(
            "width",
            0
        )
    )

    height = float(
        ar.get(
            "height",
            0
        )
    )

    if width <= 0 or height <= 0:

        print(
            "Skipping",
            artwork_id,
            "- invalid dimensions."
        )

        return

    print(
        "Processing:",
        artwork_id
    )

    with tempfile.TemporaryDirectory() as temp:

        source_usdc = os.path.join(
            temp,
            "model.usdc"
        )

        create_source_usdc(
            artwork,
            image_path,
            source_usdc
        )

        output_usdz = os.path.join(
            AR_ROOT,
            artwork_id + ".usdz"
        )

        if os.path.isfile(
            output_usdz
        ):
            os.remove(
                output_usdz
            )

        package_usdz(
            source_usdc,
            image_path,
            output_usdz
        )

    validate_usdz(
        output_usdz
    )

    print(
        "Generated:",
        output_usdz
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

    for artwork in artworks:

        try:

            create_usdz(
                artwork
            )

        except Exception as error:

            print(
                "ERROR:",
                artwork.get(
                    "id",
                    "unknown"
                ),
                error
            )

    print(
        "USDZ generation complete."
    )


if __name__ == "__main__":
    main()
