"""KRITOR — build the AR (USDZ) file for every artwork that enables it.

Source image
------------
The texture comes from the artwork's own `image` in artworks.js. Adding a work
to the catalogue is therefore all it takes to get AR — there is no second upload
to remember, and no way for the two to drift apart.

`images/ar/<id>.<ext>` is still honoured as an optional override, for the cases
where the AR texture genuinely should differ from the catalogue image — a crop
without the studio floor, say, or a straightened photograph.

Transparency
------------
Catalogue images are moving to PNG with a transparent background. When the
source has a meaningful alpha channel the painting is built as a flat cutout,
with alpha driving opacity, so the shape of the work is what appears on the
wall. An opaque source keeps the shallow canvas body behind it, which is what
makes a rectangular painting read as an object rather than a sticker.
"""

import json
import os
import shutil
import tempfile

from PIL import Image
from pxr import Usd, UsdGeom, UsdShade, UsdUtils, Sdf, Gf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ARTWORKS_FILE = os.path.join(ROOT, "artworks.js")
AR_ROOT = os.path.join(ROOT, "ar")
AR_OVERRIDE_ROOT = os.path.join(ROOT, "images", "ar")

# A USDZ is downloaded over mobile data the moment someone taps "View in AR",
# so the texture is capped. Beyond this, detail is invisible at arm's length
# and only costs the viewer time.
MAX_TEXTURE = 2048

# Below this fraction of non-opaque pixels, an alpha channel is assumed to be
# incidental (a stray soft edge) rather than a deliberate cutout.
ALPHA_CUTOUT_THRESHOLD = 0.005

CANVAS_DEPTH = 0.03
IMAGE_EXTENSIONS = (".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG", ".webp", ".WEBP")


def read_artworks():
    with open(ARTWORKS_FILE, "r", encoding="utf-8") as f:
        text = f.read()
    start = text.find("const ARTWORKS =")
    if start < 0:
        raise RuntimeError("const ARTWORKS was not found in artworks.js")
    start = text.find("[", start)
    end = text.rfind("];", start)
    if start < 0 or end < 0:
        raise RuntimeError("ARTWORKS array was not found")
    return json.loads(text[start:end + 1])


def resolve_source(artwork):
    """The override if one exists, otherwise the artwork's catalogue image."""
    artwork_id = str(artwork.get("id", ""))
    for extension in IMAGE_EXTENSIONS:
        override = os.path.join(AR_OVERRIDE_ROOT, artwork_id + extension)
        if os.path.isfile(override):
            return override, True

    relative = (artwork.get("image") or "").lstrip("/")
    if relative:
        base = os.path.join(ROOT, relative)
        if os.path.isfile(base):
            return base, False
    return None, False


def prepare_texture(source_path, destination_dir):
    """Copy the texture in at a sane size. Returns (path, has_cutout)."""
    with Image.open(source_path) as im:
        has_alpha = im.mode in ("RGBA", "LA") or (
            im.mode == "P" and "transparency" in im.info
        )

        if has_alpha:
            im = im.convert("RGBA")
            alpha = im.getchannel("A")
            transparent = sum(count for value, count in
                              enumerate(alpha.histogram()) if value < 250)
            has_cutout = transparent / float(im.width * im.height) > ALPHA_CUTOUT_THRESHOLD
        else:
            im = im.convert("RGB")
            has_cutout = False

        if max(im.size) > MAX_TEXTURE:
            im.thumbnail((MAX_TEXTURE, MAX_TEXTURE), Image.Resampling.LANCZOS)

        # USDZ textures must be PNG or JPEG; PNG keeps the alpha a cutout needs.
        name = "texture.png" if has_cutout else "texture.jpg"
        out = os.path.join(destination_dir, name)
        if has_cutout:
            im.save(out, "PNG", optimize=True)
        else:
            im.convert("RGB").save(out, "JPEG", quality=88, optimize=True)
        return out, has_cutout


def set_no_subdivision(mesh):
    # Apple Quick Look / USD defaults an unspecified mesh to Catmull-Clark.
    # Explicitly disable subdivision so the painting remains rectangular.
    mesh.GetSubdivisionSchemeAttr().Set(UsdGeom.Tokens.none)


def add_canvas_body(stage, x, y, z):
    """The shallow box behind an opaque painting, so it reads as an object."""
    body = UsdGeom.Mesh.Define(stage, "/Painting/Body")
    set_no_subdivision(body)
    body.CreatePointsAttr([
        Gf.Vec3f(-x, -y, z), Gf.Vec3f(x, -y, z),
        Gf.Vec3f(x, y, z), Gf.Vec3f(-x, y, z),
        Gf.Vec3f(-x, -y, -z), Gf.Vec3f(x, -y, -z),
        Gf.Vec3f(x, y, -z), Gf.Vec3f(-x, y, -z),
    ])
    body.CreateFaceVertexCountsAttr([4, 4, 4, 4, 4, 4])
    body.CreateFaceVertexIndicesAttr([
        0, 1, 2, 3, 5, 4, 7, 6,
        1, 5, 6, 2, 4, 0, 3, 7,
        3, 2, 6, 7, 4, 5, 1, 0,
    ])

    material = UsdShade.Material.Define(stage, "/Painting/BodyMaterial")
    shader = UsdShade.Shader.Define(stage, "/Painting/BodyMaterial/Shader")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(0.82, 0.82, 0.82))
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.85)
    shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    material.CreateSurfaceOutput().ConnectToSource(shader.GetOutput("surface"))
    UsdShade.MaterialBindingAPI(body.GetPrim()).Bind(material)


def create_usd(artwork, texture_path, usd_path, has_cutout):
    ar = artwork["ar"]
    width = float(ar["width"]) / 100.0
    height = float(ar["height"]) / 100.0
    x, y = width / 2.0, height / 2.0
    z = CANVAS_DEPTH / 2.0
    front_z = z + 0.0001

    stage = Usd.Stage.CreateNew(usd_path)
    stage.SetMetadata("metersPerUnit", 1.0)
    stage.SetMetadata("upAxis", "Y")

    root = UsdGeom.Xform.Define(stage, "/Painting")
    stage.SetDefaultPrim(root.GetPrim())

    # A cutout has no rectangle to give depth to — a box behind it would show
    # through wherever the source is transparent.
    if not has_cutout:
        add_canvas_body(stage, x, y, z)

    art = UsdGeom.Mesh.Define(stage, "/Painting/Artwork")
    set_no_subdivision(art)
    art.CreatePointsAttr([
        Gf.Vec3f(-x, -y, front_z), Gf.Vec3f(x, -y, front_z),
        Gf.Vec3f(x, y, front_z), Gf.Vec3f(-x, y, front_z),
    ])
    art.CreateFaceVertexCountsAttr([4])
    art.CreateFaceVertexIndicesAttr([0, 1, 2, 3])

    primvars = UsdGeom.PrimvarsAPI(art)
    uv = primvars.CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
    uv.Set([Gf.Vec2f(0, 0), Gf.Vec2f(1, 0), Gf.Vec2f(1, 1), Gf.Vec2f(0, 1)])

    material = UsdShade.Material.Define(stage, "/Painting/ArtworkMaterial")
    shader = UsdShade.Shader.Define(stage, "/Painting/ArtworkMaterial/Shader")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.85)
    shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)

    reader = UsdShade.Shader.Define(stage, "/Painting/ArtworkMaterial/UVReader")
    reader.CreateIdAttr("UsdPrimvarReader_float2")
    reader.CreateInput("varname", Sdf.ValueTypeNames.Token).Set("st")
    reader.CreateOutput("result", Sdf.ValueTypeNames.Float2)

    texture = UsdShade.Shader.Define(stage, "/Painting/ArtworkMaterial/Texture")
    texture.CreateIdAttr("UsdUVTexture")
    texture.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(
        Sdf.AssetPath(os.path.basename(texture_path))
    )
    texture.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(
        reader.GetOutput("result")
    )
    # Explicitly author the outputs used by the Preview Surface connections.
    # Without this, GetOutput() returns an invalid/null attribute.
    texture.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)

    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(
        texture.GetOutput("rgb")
    )

    if has_cutout:
        # Alpha drives opacity, and a threshold makes it a hard cutout — Quick
        # Look sorts blended surfaces unreliably, which shows up as flickering
        # edges when you walk around the work.
        texture.CreateOutput("a", Sdf.ValueTypeNames.Float)
        shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).ConnectToSource(
            texture.GetOutput("a")
        )
        shader.CreateInput("opacityThreshold", Sdf.ValueTypeNames.Float).Set(0.5)
        art.CreateDoubleSidedAttr(True)

    shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    material.CreateSurfaceOutput().ConnectToSource(shader.GetOutput("surface"))
    UsdShade.MaterialBindingAPI(art.GetPrim()).Bind(material)

    stage.GetRootLayer().Save()


def create_usdz(artwork, problems):
    artwork_id = str(artwork.get("id", ""))
    ar = artwork.get("ar") or {}
    if not ar.get("enabled", False):
        return False

    width = float(ar.get("width", 0) or 0)
    height = float(ar.get("height", 0) or 0)
    if width <= 0 or height <= 0:
        # AR is on but the work has no physical size, so it cannot be placed on
        # a wall at the right scale. Silence here is what left five works with
        # a "View in AR" button and no file behind it.
        problems.append(f"{artwork_id}: ar.enabled but width/height are {width}x{height}")
        return False

    source_path, is_override = resolve_source(artwork)
    if not source_path:
        problems.append(f"{artwork_id}: ar.enabled but no image found")
        return False

    os.makedirs(AR_ROOT, exist_ok=True)
    output_path = os.path.join(AR_ROOT, artwork_id + ".usdz")

    with tempfile.TemporaryDirectory() as temp:
        texture_path, has_cutout = prepare_texture(source_path, temp)
        usd_path = os.path.join(temp, "Painting.usda")
        create_usd(artwork, texture_path, usd_path, has_cutout)

        if not UsdUtils.CreateNewARKitUsdzPackage(
            Sdf.AssetPath(usd_path), output_path, "Painting.usda"
        ):
            raise RuntimeError(f"USDZ packaging failed for {artwork_id}")

    size = os.path.getsize(output_path) / 1024.0
    print(f"  {artwork_id:<9} {width:g}x{height:g}cm  "
          f"{'cutout' if has_cutout else 'canvas'}  "
          f"{'override' if is_override else 'catalogue image'}  ->  {size:.0f} KB")
    return True


def main():
    artworks = read_artworks()
    problems = []
    built = 0

    print("Building AR assets\n")
    for artwork in artworks:
        if create_usdz(artwork, problems):
            built += 1

    print(f"\n{built} USDZ file(s) written to ar/")

    if problems:
        # Loud, and a non-zero exit: an artwork offering AR that cannot produce
        # it is a broken button on the live site, not a warning to scroll past.
        print("\nAR is enabled on works that could not be built:")
        for problem in problems:
            print(f"  - {problem}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
