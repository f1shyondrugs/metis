from pathlib import Path
from PIL import Image
import shutil

root = Path(__file__).resolve().parent
source = root.parents[1] / "public" / "favicon.ico"
assets = root / "assets"
assets.mkdir(exist_ok=True)
shutil.copyfile(source, assets / "icon.ico")
with Image.open(source) as icon:
    icon.convert("RGBA").resize((256, 256), Image.LANCZOS).save(assets / "icon.png")
