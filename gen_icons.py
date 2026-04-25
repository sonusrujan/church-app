from PIL import Image
import os

src = "/Users/sonu/Desktop/Church_Project/WhatsApp Image 2026-03-28 at 09.59.10.jpeg"
pub = "/Users/sonu/Desktop/Church_Project/frontend/public"

img = Image.open(src)
if img.mode != "RGBA":
    img = img.convert("RGBA")

# favicon.ico (multi-size)
img.resize((48, 48), Image.LANCZOS).save(
    os.path.join(pub, "favicon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)]
)
print("Created favicon.ico")

# favicon PNGs
img.resize((16, 16), Image.LANCZOS).save(os.path.join(pub, "favicon-16.png"))
print("Created favicon-16.png")

img.resize((32, 32), Image.LANCZOS).save(os.path.join(pub, "favicon-32.png"))
print("Created favicon-32.png")

# apple-touch-icon
img.resize((180, 180), Image.LANCZOS).save(os.path.join(pub, "apple-touch-icon.png"))
print("Created apple-touch-icon.png")

# PWA icons (were missing before!)
img.resize((192, 192), Image.LANCZOS).save(os.path.join(pub, "icon-192.png"))
print("Created icon-192.png")

img.resize((512, 512), Image.LANCZOS).save(os.path.join(pub, "icon-512.png"))
print("Created icon-512.png")

print("All icons generated successfully!")
