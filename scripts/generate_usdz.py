import json
import os
import shutil
import tempfile
import zipfile

from pxr import Usd, UsdGeom, UsdShade, Sdf


ROOT = os.getcwd()
ARTWORKS_FILE = os.path.join(ROOT, "artworks.js")
AR_ROOT = os.path.join(ROOT, "ar")


def read_artworks():
    with open(ARTWORKS_FILE, "r", encoding="utf-8") as f:
        text = f.read()

    start = text.find("const ARTWORKS =")

    if start == -1:
        raise RuntimeError("ARTWORKS array not found.")

    array_start = text.find("[", start)

    if array_start == -1:
        raise RuntimeError("ARTWORKS array start not found.")

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
        raise RuntimeError("ARTWORKS array end not found.")

    array_text = text[array_start:array_end + 1]

    return json.loads(array_text)


def create_usdz(artwork):

    artwork_id = str(
        artwork.get("id", "")
    )

    ar = artwork.get("ar")

    if not ar:
        return

    if not ar.get("enabled", False):
        return

    width_cm = float(
        ar.get("width", 0)
    )

    height_cm = float(
        ar.get("height", 0)
    )

    if width_cm <= 0 or height_cm <= 0:
        return

    image_path = artwork.get("image", "")

    if not image_path:
        return

    image_path = os.path.join(
        ROOT,
        image_path
    )

    if not os.path.isfile(image_path):
        print("Image missing:", image_path)
        return

    width_m = width_cm / 100.0
    height_m = height_cm / 100.0
    depth_m = 0.02

    os.makedirs(
        AR_ROOT,
        exist_ok=True
    )

    final_usdz = os.path.join(
        AR_ROOT,
        artwork_id + ".usdz"
    )

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

        stage = Usd.Stage.CreateNew(
            usda_path
        )

        root = stage.DefinePrim(
            "/Painting",
            "Xform"
        )

        stage.SetDefaultPrim(root)

        cube = UsdGeom.Cube.Define(
            stage,
            "/Painting/Canvas"
        )

        cube.AddScaleOp().Set(
            (
                width_m / 2,
                height_m / 2,
                depth_m / 2
            )
        )

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
            texture_name
        )

        texture.CreateOutput(
            "rgb",
            Sdf.ValueTypeNames.Float3
        )

        shader.CreateInput(
            "diffuseColor",
            Sdf.ValueTypeNames.Color3f
        ).ConnectToSource(
            texture,
            "rgb"
        )

        shader.CreateInput(
            "roughness",
            Sdf.ValueTypeNames.Float
        ).Set(0.8)

        material.CreateSurfaceOutput().ConnectToSource(
            shader,
            "surface"
        )

        UsdShade.MaterialBindingAPI(
            cube.GetPrim()
        ).Bind(material)

        stage.GetRootLayer().Save()

        with zipfile.ZipFile(
            final_usdz,
            "w",
            compression=zipfile.ZIP_STORED
        ) as z:

            z.write(
                usda_path,
                "model.usda"
            )

            z.write(
                texture_path,
                texture_name
            )

    print(
        "Generated:",
        final_usdz
    )


def main():

    os.makedirs(
        AR_ROOT,
        exist_ok=True
    )

    artworks = read_artworks()

    for artwork in artworks:

        try:
            create_usdz(artwork)

        except Exception as error:

            print(
                "ERROR generating",
                artwork.get("id", "unknown"),
                ":",
                error
            )


if __name__ == "__main__":
    main()
