#!/usr/bin/env python3
"""
Background removal for light gray background images
Removes gray backgrounds and makes them transparent
"""

import os
from pathlib import Path
from rembg import remove
from PIL import Image

# Base directory
base_dir = Path("public/images")
output_dir = Path("public/images_nobg")
output_dir.mkdir(exist_ok=True)

# Process all images
for day_dir in base_dir.iterdir():
    if day_dir.is_dir():
        day_name = day_dir.name
        day_output = output_dir / day_name
        day_output.mkdir(exist_ok=True)
        
        for img_file in day_dir.glob("*.png"):
            output_path = day_output / img_file.name
            
            print(f"Processing {img_file}...")
            try:
                input_image = Image.open(img_file)
                
                # Use rembg to remove background
                # Works well with uniform backgrounds (gray, white, etc)
                output_image = remove(input_image)
                
                output_image.save(output_path)
                print(f"  ✅ Saved to {output_path}")
            except Exception as e:
                print(f"  ❌ Error: {e}")

print("\n✅ Done! All images processed with AI background removal")
