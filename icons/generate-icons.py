#!/usr/bin/env python3
"""Generate simple forward arrow icons as PNG files for the extension."""
import struct
import zlib

def create_png(width, height, rgba_data):
    """Create a minimal PNG file from RGBA pixel data."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT - raw image data with filter byte 0 per row
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter: none
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(rgba_data[idx:idx+4])

    idat = chunk(b'IDAT', zlib.compress(raw))

    # IEND
    iend = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


def draw_forward_icon(size):
    """Draw a multi-forward icon: stacked arrows indicating bulk operation."""
    pixels = [0] * (size * size * 4)

    def set_pixel(x, y, r, g, b, a=255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            # Alpha blending with existing
            if pixels[idx+3] > 0 and a < 255:
                ea = pixels[idx+3] / 255
                na = a / 255
                oa = na + ea * (1 - na)
                if oa > 0:
                    pixels[idx] = int((r * na + pixels[idx] * ea * (1 - na)) / oa)
                    pixels[idx+1] = int((g * na + pixels[idx+1] * ea * (1 - na)) / oa)
                    pixels[idx+2] = int((b * na + pixels[idx+2] * ea * (1 - na)) / oa)
                    pixels[idx+3] = int(oa * 255)
            else:
                pixels[idx] = r
                pixels[idx+1] = g
                pixels[idx+2] = b
                pixels[idx+3] = a

    def draw_line(x0, y0, x1, y1, r, g, b, a=255, thickness=1):
        """Bresenham line with thickness."""
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        t = max(0, thickness // 2)

        while True:
            for tx in range(-t, t+1):
                for ty in range(-t, t+1):
                    set_pixel(x0+tx, y0+ty, r, g, b, a)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def draw_filled_rect(x, y, w, h, r, g, b, a=255):
        for iy in range(y, y+h):
            for ix in range(x, x+w):
                set_pixel(ix, iy, r, g, b, a)

    # Scale factor
    s = size / 48.0
    thick = max(1, int(2.5 * s))

    # Colors
    blue = (26, 86, 219)     # Primary arrow
    lblue = (100, 150, 230)  # Secondary arrow (lighter)

    # Draw a stylized double-arrow (bulk forward indicator)
    # Arrow 1 (back, lighter) - offset left and up
    cx1 = int(20 * s)
    cy = int(24 * s)
    arrow_w = int(18 * s)
    arrow_h = int(10 * s)

    # Back arrow (lighter)
    ox, oy = int(-3 * s), int(-3 * s)
    # Shaft
    draw_line(cx1+ox, cy+oy, cx1+ox+arrow_w-int(4*s), cy+oy, *lblue, 200, thick)
    # Upper head
    draw_line(cx1+ox+arrow_w-int(4*s), cy+oy, cx1+ox+arrow_w-int(10*s), cy+oy-arrow_h+int(2*s), *lblue, 200, thick)
    # Lower head
    draw_line(cx1+ox+arrow_w-int(4*s), cy+oy, cx1+ox+arrow_w-int(10*s), cy+oy+arrow_h-int(2*s), *lblue, 200, thick)

    # Front arrow (primary, bold)
    # Shaft
    draw_line(cx1, cy, cx1+arrow_w, cy, *blue, 255, thick+1)
    # Upper arrowhead
    draw_line(cx1+arrow_w, cy, cx1+arrow_w-int(8*s), cy-arrow_h, *blue, 255, thick+1)
    # Lower arrowhead
    draw_line(cx1+arrow_w, cy, cx1+arrow_w-int(8*s), cy+arrow_h, *blue, 255, thick+1)

    # Small "stack" lines at bottom-right to indicate "multiple"
    lx = int(30 * s)
    for i in range(3):
        ly = int((32 + i*4) * s)
        lw = int((10 - i*2) * s)
        draw_line(lx, ly, lx+lw, ly, *blue, 180, max(1, thick-1))

    return pixels


for sz in [16, 32, 48]:
    px = draw_forward_icon(sz)
    png = create_png(sz, sz, px)
    with open(f'forward-icon-{sz}.png', 'wb') as f:
        f.write(png)
    print(f'Created forward-icon-{sz}.png ({len(png)} bytes)')
