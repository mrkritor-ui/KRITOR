import json
import os
import shutil
import tempfile

from pxr import (
    Usd,
    UsdGeom,
    UsdShade,
    UsdUtils,
    Sdf,
    Gf,
)


ROOT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
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
# READ ARTWORKS
# ==========================================================

def read_artworks():

    if not os.path.isfile(ARTWORKS_FILE):
        raise RuntimeError(
            f"artworks.js not found: {ARTWORKS_FILE}"
        )

    with open(
        ARTWORKS_FILE,
        "r",
        encoding="utf-8"
    ) as f:
        text = f.read()

    start = text.find(
        "const ARTWORKS ="
    )

    if start == -1:
        raise RuntimeError(
            "const ARTWORKS was not found in artworks.js."
        )

    array_start = text.find(
        "[",
        start
    )

    if array_start == -1:
        raise RuntimeError(
            "ARTWORKS array was not found."
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
            "Could not find the end of the ARTWORKS array."
        )

    array_text = text[
        array_start:
        array_end + 1
    ]

    try:
        artworks = json.loads(
            array_text
        )
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"ARTWORKS is not valid JSON: {error}"
        )

    if not isinstance(
        artworks,
        list
    ):
        raise RuntimeError(
            "ARTWORKS is not an array."
        )

    return artworks


# ==========================================================
# FIND AR IMAGE
# ==========================================================

def find_ar_image(
    artwork_id
):

    extensions = [
        ".png",
        ".PNG",
        ".jpg",
        ".JPG",
        ".jpeg",
        ".JPEG"
    ]

    for extension in extensions:

        path = os.path.join(
            AR_IMAGE_ROOT,
            artwork_id + extension
        )

        if os.path.isfile(path):
            return path

    return None


# ==========================================================
# CREATE USD
# ==========================================================

def create_usd(
    artwork,
    image_path,
    usd_path
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

    if not ar:
        raise RuntimeError(
            f"{artwork_id}: missing ar configuration."
        )

    width_cm = float(
        ar.get(
            "width",
            0
        )
    )

    height_cm = float(
        ar.get(
            "height",
            0
        )
    )

    if width_cm <= 0 or height_cm <= 0:
        raise RuntimeError(
            f"{artwork_id}: invalid dimensions "
            f"{width_cm} x {height_cm} cm."
        )

    width_m = width_cm / 100.0
    height_m = height_cm / 100.0

    # Real physical depth.
    # 30 mm gives the artwork an actual solid body
    # instead of a zero-thickness plane.
    depth_m = 0.03

    # Tiny offset so the textured front surface
    # sits cleanly in front of the solid body.
    front_offset = 0.0001

    texture_name = os.path.basename(
        image_path
    )

    stage = Usd.Stage.CreateNew(
        usd_path
    )

    stage.SetMetadata(
        "metersPerUnit",
        1.0
    )

    stage.SetMetadata(
        "upAxis",
        "Y"
    )

    # ======================================================
    # ROOT
    # ======================================================

    root = UsdGeom.Xform.Define(
        stage,
        "/Painting"
    )

    stage.SetDefaultPrim(
        root.GetPrim()
    )

    # ======================================================
    # BODY
    #
    # Actual rectangular solid.
    # ======================================================

    body = UsdGeom.Mesh.Define(
        stage,
        "/Painting/Body"
    )

    x = width_m / 2.0
    y = height_m / 2.0
    z = depth_m / 2.0

    body_points = [

        # Front
        Gf.Vec3f(-x, -y,  z),
        Gf.Vec3f( x, -y,  z),
        Gf.Vec3f( x,  y,  z),
        Gf.Vec3f(-x,  y,  z),

        # Back
        Gf.Vec3f(-x, -y, -z),
        Gf.Vec3f( x, -y, -z),
        Gf.Vec3f( x,  y, -z),
        Gf.Vec3f(-x,  y, -z),
    ]

    body.CreatePointsAttr(
        body_points
    )

    body.CreateFaceVertexCountsAttr([
        4,
        4,
        4,
        4,
        4,
        4
    ])

    body.CreateFaceVertexIndicesAttr([

        # Front
        0, 1, 2, 3,

        # Back
        5, 4, 7, 6,

        # Right
        1, 5, 6, 2,

        # Left
        4, 0, 3, 7,

        # Top
        3, 2, 6, 7,

        # Bottom
        4, 5, 1, 0
    ])

    # ======================================================
    # BODY MATERIAL
    # ======================================================

    body_material = UsdShade.Material.Define(
        stage,
        "/Painting/BodyMaterial"
    )

    body_shader = UsdShade.Shader.Define(
        stage,
        "/Painting/BodyMaterial/Shader"
    )

    body_shader.CreateIdAttr(
        "UsdPreviewSurface"
    )

    body_shader.CreateInput(
        "diffuseColor",
        Sdf.ValueTypeNames.Color3f
    ).Set(
        Gf.Vec3f(
            0.82,
            0.82,
            0.82
        )
    )

    body_shader.CreateInput(
        "roughness",
        Sdf.ValueTypeNames.Float
    ).Set(
        0.85
    )

    body_shader.CreateInput(
        "metallic",
        Sdf.ValueTypeNames.Float
    ).Set(
        0.0
    )

    body_surface = body_shader.CreateOutput(
        "surface",
        Sdf.ValueTypeNames.Token
    )

    body_material_surface = (
        body_material.CreateSurfaceOutput()
    )

    body_material_surface.ConnectToSource(
        body_surface
    )

    UsdShade.MaterialBindingAPI(
        body.GetPrim()
    ).Bind(
        body_material
    )

    # ======================================================
    # FRONT ARTWORK SURFACE
    #
    # Separate rectangular surface.
    # Exact artwork dimensions.
    # ======================================================

    artwork_mesh = UsdGeom.Mesh.Define(
        stage,
        "/Painting/Artwork"
    )

    front_z = z + front_offset

    artwork_mesh.CreatePointsAttr([

        Gf.Vec3f(
            -x,
            -y,
            front_z
        ),

        Gf.Vec3f(
            x,
            -y,
            front_z
        ),

        Gf.Vec3f(
            x,
            y,
            front_z
        ),

        Gf.Vec3f(
            -x,
            y,
            front_z
        )
    ])

    artwork_mesh.CreateFaceVertexCountsAttr([
        4
    ])

    artwork_mesh.CreateFaceVertexIndicesAttr([
        0,
        1,
        2,
        3
    ])

    # ======================================================
    # FRONT UV
    # ======================================================

    primvars = UsdGeom.PrimvarsAPI(
        artwork_mesh
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
        Gf.Vec2f(0, 1)
    ])

    # ======================================================
    # ARTWORK MATERIAL
    # ======================================================

    artwork_material = UsdShade.Material.Define(
        stage,
        "/Painting/ArtworkMaterial"
    )

    artwork_shader = UsdShade.Shader.Define(
        stage,
        "/Painting/ArtworkMaterial/Shader"
    )

    artwork_shader.CreateIdAttr(
        "UsdPreviewSurface"
    )

    artwork_shader.CreateInput(
        "roughness",
        Sdf.ValueTypeNames.Float
    ).Set(
        0.85
    )

    artwork_shader.CreateInput(
        "metallic",
        Sdf.ValueTypeNames.Float
    ).Set(
        0.0
    )

    # ======================================================
    # UV READER
    # ======================================================

    uv_reader = UsdShade.Shader.Define(
        stage,
        "/Painting/ArtworkMaterial/UVReader"
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

    # ======================================================
    # TEXTURE
    # ======================================================

    texture = UsdShade.Shader.Define(
        stage,
        "/Painting/ArtworkMaterial/Texture"
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

    artwork_shader.CreateInput(
        "diffuseColor",
        Sdf.ValueTypeNames.Color3f
    ).ConnectToSource(
        texture_rgb
    )

    # ======================================================
    # SURFACE
    # ======================================================

    artwork_surface = artwork_shader.CreateOutput(
        "surface",
        Sdf.ValueTypeNames.Token
    )

    artwork_material_surface = (
        artwork_material.CreateSurfaceOutput()
    )

    artwork_material_surface.ConnectToSource(
        artwork_surface
    )

    # ======================================================
    # BIND ARTWORK MATERIAL
    # ======================================================

    UsdShade.MaterialBindingAPI(
        artwork_mesh.GetPrim()
    ).Bind(
        artwork_material
    )

    # ======================================================
    # SAVE
    # ======================================================

    stage.GetRootLayer().Save()

    # Close stage before USDZ packaging.
    stage = None


# ==========================================================
# CREATE USDZ
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

    if not ar or not ar.get(
        "enabled",
        False
    ):
        return False

    width_cm = float(
        ar.get(
            "width",
            0
        )
    )

    height_cm = float(
        ar.get(
            "height",
            0
        )
    )

    if width_cm <= 0 or height_cm <= 0:

        print(
            "Skipping",
            artwork_id,
            "- invalid dimensions."
        )

        return False

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
            "Expected one of:"
        )

        for extension in [
            ".png",
            ".PNG",
            ".jpg",
            ".JPG",
            ".jpeg",
            ".JPEG"
        ]:
            print(
                " ",
                os.path.join(
                    AR_IMAGE_ROOT,
                    artwork_id + extension
                )
            )

        return False

    print(
        "Processing:",
        artwork_id
    )

    print(
        "Using AR image:",
        image_path
    )

    os.makedirs(
        AR_ROOT,
        exist_ok=True
    )

    output_path = os.path.join(
        AR_ROOT,
        artwork_id + ".usdz"
    )

    with tempfile.TemporaryDirectory() as temp:

        usd_path = os.path.join(
            temp,
            "Painting.usda"
        )

        texture_path = os.path.join(
            temp,
            os.path.basename(
                image_path
            )
        )

        shutil.copy2(
            image_path,
            texture_path
        )

        create_usd(
            artwork,
            image_path,
            usd_path
        )

        # ==================================================
        # ARKIT USDZ PACKAGE
        # ==================================================

        success = UsdUtils.CreateNewARKitUsdzPackage(
            Sdf.AssetPath(
                usd_path
            ),
            output_path,
            "Painting.usda"
        )

        if not success:
            raise RuntimeError(
                f"USDZ packaging failed for {artwork_id}"
            )

    if not os.path.isfile(
        output_path
    ):
        raise RuntimeError(
            f"USDZ was not created: {output_path}"
        )

    if os.path.getsize(
        output_path
    ) <= 0:
        raise RuntimeError(
            f"USDZ is empty: {output_path}"
        )

    print(
        "Generated:",
        output_path
    )

    return True


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
    skipped = 0
    failed = 0

    for artwork in artworks:

        artwork_id = artwork.get(
            "id",
            "unknown"
        )

        try:

            result = create_usdz(
                artwork
            )

            if result:
                generated += 1
            else:
                skipped += 1

        except Exception as error:

            failed += 1

            print(
                "ERROR generating",
                artwork_id,
                ":",
                error
            )

    print()
    print(
        "USDZ generation complete."
    )

    print(
        "Generated files:",
        generated
    )

    print(
        "Skipped:",
        skipped
    )

    print(
        "Failed:",
        failed
    )

    if failed > 0:
        raise SystemExit(1)


# ==========================================================
# ENTRY POINT
# ==========================================================

if __name__ == "__main__":
    main()
