from PIL import Image
import numpy as np

img = Image.open("Serene embrace of peace.png")
print(f"Original size: {img.size}, mode: {img.mode}")

rgba = img.convert("RGBA")
arr = np.array(rgba)

# Find pixels that have significant color (not near-white/transparent)
# Use alpha channel too - semi-transparent sparkles have low alpha
alpha_mask = arr[:, :, 3] > 200  # solid pixels only
color_mask = np.any(arr[:, :, :3] < 230, axis=2)  # not near-white
mask = alpha_mask & color_mask

rows = np.any(mask, axis=1)
cols = np.any(mask, axis=0)
rmin, rmax = np.where(rows)[0][[0, -1]]
cmin, cmax = np.where(cols)[0][[0, -1]]

print(f"Raw bounds: rows {rmin}-{rmax}, cols {cmin}-{cmax}")

# Add small padding
pad = 30
rmin = max(0, rmin - pad)
rmax = min(arr.shape[0] - 1, rmax + pad)
cmin = max(0, cmin - pad)
cmax = min(arr.shape[1] - 1, cmax + pad)

print(f"Padded bounds: rows {rmin}-{rmax}, cols {cmin}-{cmax}")
cropped = img.crop((cmin, rmin, cmax, rmax))
print(f"Cropped size: {cropped.size}")
cropped.save("Serene embrace of peace.png", optimize=True)
print("Saved!")
