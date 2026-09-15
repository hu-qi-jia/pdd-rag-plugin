"""截图像素尺 —— 用户反馈"重叠了 / 高度不一致"这类像素级问题时,用数据代替肉眼判断。

零依赖纯 Python 解码 PNG(项目环境无 PIL),输出:
  · 逐列白像素统计 → 找白色气泡/卡片块的左右边界;
  · 指定行的色块分段 → 看两个元素之间到底隔了几像素;
  · 指定列的纵向前景段 → 量控件高度、找 1px 边框。

用法:python scripts/measure-clip-pixels.py <png> [--row Y] [--col X]
例: python scripts/measure-clip-pixels.py shot.png --row 47 --col 240
"""
import struct
import sys
import zlib


def decode(path):
    raw = open(path, "rb").read()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "非 PNG"
    pos, idat, w, h, bd, ct = 8, b"", 0, 0, 0, 0
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos:pos + 4])[0]
        typ = raw[pos + 4:pos + 8]
        data = raw[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT":
            idat += data
        elif typ == b"IEND":
            break
        pos += 12 + ln

    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    assert bd == 8, f"暂不支持 bit depth {bd}"
    buf = zlib.decompress(idat)
    stride = w * ch
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = buf[p]
        line = bytearray(buf[p + 1:p + 1 + stride])
        p += 1 + stride
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b = prev[i]
            c = prev[i - ch] if i >= ch else 0
            x = line[i]
            if f == 1:
                x += a
            elif f == 2:
                x += b
            elif f == 3:
                x += (a + b) // 2
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                x += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[i] = x & 0xFF
        rows.append(bytes(line))
        prev = line
    return w, h, ch, stride, rows


def parse_arg(argv, flag, limit):
    """--row 47 --col 30 / --row 47 39 均支持,遇到下一个 -- 开头即停"""
    if flag not in argv:
        return []
    out = []
    for tok in argv[argv.index(flag) + 1:]:
        if tok.startswith("--"):
            break
        try:
            out.append(int(tok))
        except ValueError:
            break
    return [v for v in out if 0 <= v < limit]


def main():
    path = sys.argv[1]
    w, h, ch, stride, rows = decode(path)

    def px(x, y):
        o = x * ch
        return rows[y][o], rows[y][o + 1], rows[y][o + 2]

    argv = sys.argv[2:]
    rows_arg = parse_arg(argv, "--row", h)
    cols_arg = parse_arg(argv, "--col", w)

    print(f"{path}\nsize = {w}x{h}\n")

    print("--- 每列白像素区间(近似纯白,找白底块边界)---")
    prev = False
    for x in range(w):
        n = sum(1 for y in range(h) if min(px(x, y)) >= 250)
        on = n > max(2, h // 20)
        if on != prev:
            print(f"  x={x:4d} 白{'起' if on else '止'}")
        prev = on

    for y in rows_arg or [h // 2]:
        segs, cur = [], None
        for x in range(w):
            t = px(x, y)
            kind = "white" if min(t) >= 250 else "other"
            if cur is None or cur[0] != kind:
                if cur:
                    segs.append(cur)
                cur = [kind, x, x]
            else:
                cur[2] = x
        segs.append(cur)
        print(f"\n--- y={y} 横向分段 ---")
        print("  " + " | ".join(f"{k}[{a}-{b}]" for k, a, b in segs if b - a >= 1))

    for x in cols_arg:
        print(f"\n--- x={x} 纵向灰度(找 1px 边框)---")
        print("  " + " ".join(f"{y}:{px(x, y)[0]}" for y in range(h)))


main()
