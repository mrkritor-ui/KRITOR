import json
import os
import shutil
import tempfile

from pxr import Usd, UsdGeom, UsdShade, UsdUtils, Sdf, Gf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ARTWORKS_FILE = os.path.join(ROOT, "artworks.js")
AR_ROOT = os.path.join(ROOT, "ar")
AR_IMAGE_ROOT = os.path.join(ROOT, "images", "ar")


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


def find_ar_image(artwork_id):
    for ext in (".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG"):
        path = os.path.join(AR_IMAGE_ROOT, artwork_id + ext)
        if os.path.isfile(path):
            return path
    return None


def set_no_subdivision(mesh):
    # Prevent USD's default Catmull-Clark subdivision from turning
    # rectangular painting meshes into rounded/oval surfaces in AR Quick Look.
    mesh.GetSubdivisionSchemeAttr().Set(UsdGeom.Tokens.none)


def create_usd(artwork, image_path, usd_path):
    ar = artwork["ar"]
    width = float(ar["width"]) / 100.0
    height = float(ar["height"]) / 100.0
    depth = 0.03
    x, y, z = width / 2.0, height / 2.0, depth / 2.0
    front_z = z + 0.0001

    stage = Usd.Stage.CreateNew(usd_path)
    stage.SetMetadata("metersPerUnit", 1.0)
    stage.SetMetadata("upAxis", "Y")

    root = UsdGeom.Xform.Define(stage, "/Painting")
    stage.SetDefaultPrim(root.GetPrim())

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

    body_mat = UsdShade.Material.Define(stage, "/Painting/BodyMaterial")
    body_shader = UsdShade.Shader.Define(stage, "/Painting/BodyMaterial/Shader")
    body_shader.CreateIdAttr("UsdPreviewSurface")
    body_shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(0.82, 0.82, 0.82))
    body_shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.85)
    body_shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    body_mat.CreateSurfaceOutput().ConnectToSource(body_shader.GetOutput("surface"))
    UsdShade.MaterialBindingAPI(body.GetPrim()).Bind(body_mat)

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

    mat = UsdShade.Material.Define(stage, "/Painting/ArtworkMaterial")
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
    texture.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(Sdf.AssetPath(os.path.basename(image_path)))
    texture.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(reader.GetOutput("result"))

    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(texture.GetOutput("rgb"))
    shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    mat.CreateSurfaceOutput().ConnectToSource(shader.GetOutput("surface"))
    UsdShade.MaterialBindingAPI(art.GetPrim()).Bind(mat)

    stage.GetRootLayer().Save()


def create_usdz(artwork):
    artwork_id = str(artwork.get("id", ""))
    ar = artwork.get("ar") or {}
    if not ar.get("enabled", False):
        return False

    width = float(ar.get("width", 0))
    height = float(ar.get("height", 0))
    if width <= 0 or height <= 0:
        print(f"Skipping {artwork_id}: invalid dimensions")
        return False

    image_path = find_ar_image(artwork_id)
    if not image_path:
        print(f"Skipping {artwork_id}: AR image missing")
        return False

    os.makedirs(AR_ROOT, exist_ok=True)
    output_path = os.path.join(AR_ROOT, artwork_id + ".usdz")

    with tempfile.TemporaryDirectory() as temp:
        usd_path = os.path.join(temp, "Painting.usda")
        texture_path = os.path.join(temp, os.path.basename(image_path))
        shutil.copy2(image_path, texture_path)
        create_usd(artwork, image_path, usd_path)

        if not UsdUtils.CreateNewARKitUsdzPackage(
            Sdf.AssetPath(usd_path), output_path, "Painting.usda"
        ):
            raise RuntimeError(f"USDZ packaging failed for {artwork_id}")

    print(f"Generated {output_path}")
    return True


def main():
    for artwork in read_artworks():
        create_usdz(artwork)


if __name__ == "__main__":
    main()
