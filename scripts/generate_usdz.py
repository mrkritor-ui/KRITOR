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

```
start = text.find("const ARTWORKS =")

if start == -1:
    raise RuntimeError("const ARTWORKS was not found.")

array_start = text.find("[", start)

if array_start == -1:
    raise RuntimeError("ARTWORKS array was not found.")

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
    raise RuntimeError("Could not find end of ARTWORKS array.")

array_text = text[array_start:array_end + 1]
artworks = json.loads(array_text)

if not isinstance(artworks, list):
    raise RuntimeError("ARTWORKS is not an array.")

return artworks
```

def create_usdz(artwork):
artwork_id = str(artwork.get("id", ""))
ar = artwork.get("ar")

```
if not ar or not ar.get("enabled", False):
    return

width_cm = float(ar.get("width", 0))
height_cm = float(ar.get("height", 0))

if width_cm <= 0 or height_cm <= 0:
    print("Skipping", artwork_id, "- invalid dimensions.")
    return

ar_image = ar.get("arImage", "")

if not ar_image:
    print("Skipping", artwork_id, "- no arImage specified.")
    return

image_path = os.path.join(ROOT, ar_image)

if not os.path.isfile(image_path):
    print(
        "Skipping",
        artwork_id,
        "- AR image missing:",
        image_path
    )
    return

width_m = width_cm / 100.0
height_m = height_cm / 100.0

os.makedirs(AR_ROOT, exist_ok=True)

output_path = os.path.join(
    AR_ROOT,
    artwork_id + ".usdz"
)

with tempfile.TemporaryDirectory() as temp:
    usda_path = os.path.join(temp, "model.usda")

    texture_name = os.path.basename(image_path)
    texture_path = os.path.join(temp, texture_name)

    shutil.copy2(image_path, texture_path)

    stage = Usd.Stage.CreateNew(usda_path)

    stage.SetMetadata("metersPerUnit", 1.0)
    stage.SetMetadata("upAxis", "Y")

    root = UsdGeom.Xform.Define(
        stage,
        "/Painting"
    )

    stage.SetDefaultPrim(root.GetPrim())

    mesh = UsdGeom.Mesh.Define(
        stage,
        "/Painting/Artwork"
    )

    mesh.CreatePointsAttr([
        (-width_m / 2, -height_m / 2, 0),
        (width_m / 2, -height_m / 2, 0),
        (width_m / 2, height_m / 2, 0),
        (-width_m / 2, height_m / 2, 0)
    ])

    mesh.CreateFaceVertexCountsAttr([4])

    mesh.CreateFaceVertexIndicesAttr([
        0,
        1,
        2,
        3
    ])

    mesh.CreateNormalsAttr([
        (0, 0, 1)
    ])

    mesh.SetNormalsInterpolation(
        UsdGeom.Tokens.constant
    )

    primvars = UsdGeom.PrimvarsAPI(mesh)

    uv = primvars.CreatePrimvar(
        "st",
        Sdf.ValueTypeNames.TexCoord2fArray,
        UsdGeom.Tokens.faceVarying
    )

    uv.Set([
        (0, 0),
        (1, 0),
        (1, 1),
        (0, 1)
    ])

    material = UsdShade.Material.Define(
        stage,
        "/Painting/Material"
    )

    shader = UsdShade.Shader.Define(
        stage,
        "/Painting/Material/Shader"
    )

    shader.CreateIdAttr("UsdPreviewSurface")

    shader.CreateInput(
        "roughness",
        Sdf.ValueTypeNames.Float
    ).Set(0.8)

    shader.CreateInput(
        "metallic",
        Sdf.ValueTypeNames.Float
    ).Set(0.0)

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

    texture = UsdShade.Shader.Define(
        stage,
        "/Painting/Material/Texture"
    )

    texture.CreateIdAttr("UsdUVTexture")

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

    diffuse = shader.CreateInput(
        "diffuseColor",
        Sdf.ValueTypeNames.Color3f
    )

    diffuse.ConnectToSource(texture_rgb)

    texture_alpha = texture.CreateOutput(
        "a",
        Sdf.ValueTypeNames.Float
    )

    opacity = shader.CreateInput(
        "opacity",
        Sdf.ValueTypeNames.Float
    )

    opacity.ConnectToSource(texture_alpha)

    shader_surface = shader.CreateOutput(
        "surface",
        Sdf.ValueTypeNames.Token
    )

    material_surface = material.CreateSurfaceOutput()

    material_surface.ConnectToSource(
        shader_surface
    )

    UsdShade.MaterialBindingAPI(
        mesh.GetPrim()
    ).Bind(material)

    stage.GetRootLayer().Save()

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

print("Generated:", output_path)
```

def main():
os.makedirs(
AR_ROOT,
exist_ok=True
)

```
artworks = read_artworks()

print(
    "Found",
    len(artworks),
    "artworks."
)

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
```

if **name** == "**main**":
main()
