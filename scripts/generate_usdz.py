"""KRITOR — build the AR (USDZ) file for every artwork that enables it.

Source image
------------
The texture comes from the artwork's own `image` in artworks.js. Adding a work
to the catalogue is therefore all it takes to get AR — there is no second upload
to remember, and no way for the two to drift apart. One image per work, full
stop — no separate AR override, so there is nothing that can show one picture
on the wall and a different one in the catalogue.

Transparency
------------
Whatever transparency the PNG has is what appears on the wall. Nothing here
inspects the picture, guesses at a background, or crops anything — the only
question asked is whether the alpha channel carries any information at all, and
a channel that is uniformly opaque is dropped because it encodes nothing. That
is the same rule the web renditions follow.

Upload a good PNG and it comes out the other side intact.

Depth
-----
Every work is a real object, not a poster — see CANVAS_DEPTH_CM. The mesh is
a box that deep, back face flush against the wall, front face (the artwork's
own texture) proud of it by the stretcher's depth. The sides and back carry a
plain canvas tint (CANVAS_EDGE_COLOR); there is no photograph of the actual
edge to texture them with.
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

# Every work ships on 38mm gallery-wrap stretcher bars. A flat plane made the
# painting vanish edge-on in AR — real canvases have real depth — so the mesh
# is a box this deep, not a card. Change this if a particular run of works
# uses a different stretcher.
CANVAS_DEPTH_CM = 3.8

# The stretcher's own edge, not the painting — there is no photograph of it
# to go on, so this is a plain raw-canvas tint rather than a guess at
# whatever the front photo would look like stretched around the side.
CANVAS_EDGE_COLOR = Gf.Vec3f(0.86, 0.83, 0.76)

# A USDZ is downloaded over mobile data the moment someone taps "View in AR",
# so the texture is capped. Beyond this, detail is invisible at arm's length
# and only costs the viewer time.
MAX_TEXTURE = 2048


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
    """The artwork's own catalogue image — the only source AR ever reads."""
    relative = (artwork.get("image") or "").lstrip("/")
    if relative:
        base = os.path.join(ROOT, relative)
        if os.path.isfile(base):
            return base
    return None


def prepare_texture(source_path, destination_dir):
    """Copy the texture in at a sane size, keeping any real transparency.

    Returns (path, transparent). `transparent` is simply whether the alpha
    channel holds anything other than "fully opaque" — no thresholds, no
    judgement about what the picture contains."""
    with Image.open(source_path) as im:
        transparent = False
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            im = im.convert("RGBA")
            # A uniformly opaque alpha channel encodes nothing, so it is dropped
            # and the texture ships as a much smaller JPEG.
            transparent = im.getchannel("A").getextrema() != (255, 255)
        if not transparent:
            im = im.convert("RGB")

        if max(im.size) > MAX_TEXTURE:
            im.thumbnail((MAX_TEXTURE, MAX_TEXTURE), Image.Resampling.LANCZOS)

        # USDZ textures must be PNG or JPEG; PNG is what carries alpha.
        name = "texture.png" if transparent else "texture.jpg"
        out = os.path.join(destination_dir, name)
        if transparent:
            im.save(out, "PNG", optimize=True)
        else:
            im.save(out, "JPEG", quality=88, optimize=True)
        return out, transparent


def set_no_subdivision(mesh):
    # Apple Quick Look / USD defaults an unspecified mesh to Catmull-Clark.
    # Explicitly disable subdivision so the painting remains rectangular.
    mesh.GetSubdivisionSchemeAttr().Set(UsdGeom.Tokens.none)


def create_usd(artwork, texture_path, usd_path, transparent):
    ar = artwork["ar"]
    width = float(ar["width"]) / 100.0
    height = float(ar["height"]) / 100.0
    x, y = width / 2.0, height / 2.0
    depth = CANVAS_DEPTH_CM / 100.0
    # The back face sits flush against the wall; the front sits proud of it
    # by the stretcher's depth — this is what an AR wall placement anchors to.
    back_z, front_z = 0.0, depth

    stage = Usd.Stage.CreateNew(usd_path)
    stage.SetMetadata("metersPerUnit", 1.0)
    stage.SetMetadata("upAxis", "Y")

    root = UsdGeom.Xform.Define(stage, "/Painting")
    stage.SetDefaultPrim(root.GetPrim())

    # The front face only — the painting itself. Transparency in the source
    # photo (a trimmed canvas corner, work-20/21/22 today) shows straight
    # through to the wall behind it, the same as before this face gained a
    # box behind it: whatever is back there is a separate mesh (see below),
    # not something a hole in this face would reveal.
    art = UsdGeom.Mesh.Define(stage, "/Painting/Artwork")
    set_no_subdivision(art)
    art.CreatePointsAttr([
        Gf.Vec3f(-x, -y, front_z), Gf.Vec3f(x, -y, front_z),
        Gf.Vec3f(x, y, front_z), Gf.Vec3f(-x, y, front_z),
    ])
    art.CreateFaceVertexCountsAttr([4])
    art.CreateFaceVertexIndicesAttr([0, 1, 2, 3])
    art.CreateDoubleSidedAttr(True)

    primvars = UsdGeom.PrimvarsAPI(art)
    uv = primvars.CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
    uv.Set([Gf.Vec2f(0, 0), Gf.Vec2f(1, 0), Gf.Vec2f(1, 1), Gf.Vec2f(0, 1)])

    if depth > 0:
        # The stretcher itself: back face plus the four side edges, in a
        # plain raw-canvas tint (see CANVAS_EDGE_COLOR) rather than the
        # artwork's own texture — there is no photograph of the actual edge
        # to put there.
        edge = UsdGeom.Mesh.Define(stage, "/Painting/Edge")
        set_no_subdivision(edge)
        edge.CreatePointsAttr([
            Gf.Vec3f(-x, -y, back_z), Gf.Vec3f(x, -y, back_z),    # 0, 1
            Gf.Vec3f(x, y, back_z), Gf.Vec3f(-x, y, back_z),      # 2, 3
            Gf.Vec3f(-x, -y, front_z), Gf.Vec3f(x, -y, front_z),  # 4, 5
            Gf.Vec3f(x, y, front_z), Gf.Vec3f(-x, y, front_z),    # 6, 7
        ])
        edge.CreateFaceVertexCountsAttr([4, 4, 4, 4, 4])
        edge.CreateFaceVertexIndicesAttr([
            0, 3, 2, 1,  # back
            0, 1, 5, 4,  # bottom
            3, 7, 6, 2,  # top
            0, 4, 7, 3,  # left
            1, 2, 6, 5,  # right
        ])
        edge.CreateDoubleSidedAttr(True)

        edge_material = UsdShade.Material.Define(stage, "/Painting/EdgeMaterial")
        edge_shader = UsdShade.Shader.Define(stage, "/Painting/EdgeMaterial/Shader")
        edge_shader.CreateIdAttr("UsdPreviewSurface")
        edge_shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(CANVAS_EDGE_COLOR)
        edge_shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.9)
        edge_shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)
        edge_shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
        edge_material.CreateSurfaceOutput().ConnectToSource(edge_shader.GetOutput("surface"))
        UsdShade.MaterialBindingAPI(edge.GetPrim()).Bind(edge_material)

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

    if transparent:
        # Alpha drives opacity, and a threshold makes it a hard cutout — Quick
        # Look sorts blended surfaces unreliably, which shows up as flickering
        # edges when you walk around the work.
        texture.CreateOutput("a", Sdf.ValueTypeNames.Float)
        shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).ConnectToSource(
            texture.GetOutput("a")
        )
        shader.CreateInput("opacityThreshold", Sdf.ValueTypeNames.Float).Set(0.5)

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

    source_path = resolve_source(artwork)
    if not source_path:
        problems.append(f"{artwork_id}: ar.enabled but no image found")
        return False

    os.makedirs(AR_ROOT, exist_ok=True)
    output_path = os.path.join(AR_ROOT, artwork_id + ".usdz")

    with tempfile.TemporaryDirectory() as temp:
        texture_path, transparent = prepare_texture(source_path, temp)
        usd_path = os.path.join(temp, "Painting.usda")
        create_usd(artwork, texture_path, usd_path, transparent)

        if not UsdUtils.CreateNewARKitUsdzPackage(
            Sdf.AssetPath(usd_path), output_path, "Painting.usda"
        ):
            raise RuntimeError(f"USDZ packaging failed for {artwork_id}")

    size = os.path.getsize(output_path) / 1024.0
    print(f"  {artwork_id:<9} {width:g}x{height:g}cm  "
          f"{'transparent' if transparent else 'opaque':<11}  ->  {size:.0f} KB")
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
