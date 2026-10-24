# SPDX-License-Identifier: GPL-3.0-only
"""Build a ready-made .uf2 image that sets up a new SnekPad in one step.

The image holds CircuitPython itself and a complete CIRCUITPY drive: the compiled firmware, the compiled KMK, the three
Adafruit libraries, the start-up logo, boot.py and the license texts. Setting up a pad is then: hold BOOT while plugging
in USB, drag the .uf2 onto the RPI-RP2 drive, wait for the pad to restart. Everything it contains is pinned below
(version + SHA-256), so the same commit always builds the same image.

Usage (Python 3, on the computer):

    python build_uf2.py [--mpy-cross PATH] [--out FILE] [--dev] [--fat-out FILE]

  --mpy-cross   the mpy-cross for CircuitPython CIRCUITPYTHON_VERSION. Without it the pinned build for this computer is
                downloaded (Windows and Linux x64; elsewhere pass it).
  --out         where the .uf2 goes (default dist/SnekPad-pad-<firmware version>.uf2, or ...-DEV.uf2 with --dev).
  --dev         DEVELOPMENT image: adds dev_tools.mpy and /nowatchdog, like flash_pad.ps1 -Dev. Never for a customer pad.
  --fat-out     also write the bare CIRCUITPY drive (a FAT12 image), for checking it with other tools.

Downloads are kept in .uf2-cache/ next to this script. The firmware is compiled with build_mpy.py (so Programs/build is
rebuilt too). The image has no config.json: the pad starts on the built-in profiles until SnekPad Studio sends its own.

How the RP2040's 2 MB flash is laid out by CircuitPython 10.x (ports/raspberrypi/mpconfigport.h):
    0x000000  CircuitPython                      (CIRCUITPY_FIRMWARE_SIZE = 1020 KB)
    0x0FF000  nvm, 4 KB                          (CIRCUITPY_INTERNAL_NVM_SIZE; written erased, as after flash_nuke.uf2)
    0x100000  the CIRCUITPY drive, up to the end (CIRCUITPY_CIRCUITPY_DRIVE_START_ADDR; 1 MB = 2048 sectors of 512 bytes)
CircuitPython mounts a drive with a valid FAT file system as it is and only formats one that has none, so a wrong layout
shows up as an empty CIRCUITPY drive with a "Hello World!" code.py, never as a broken pad.
"""

import argparse
import hashlib
import io
import math
import os
import re
import struct
import subprocess
import sys
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build")
CACHE = os.path.join(HERE, ".uf2-cache")

# ---------------------------------------------------------------- what goes in (pinned)
CIRCUITPYTHON_VERSION = "10.3.1"     # must match firmware.yml / release.yml and the pads in the field
BUNDLE_DATE = "20261023"
KMK_COMMIT = "8afe56905af4df3b9e4dcb0a21b670a1bd3aab18"

CIRCUITPYTHON = (
    "https://downloads.circuitpython.org/bin/waveshare_rp2040_zero/en_US/"
    "adafruit-circuitpython-waveshare_rp2040_zero-en_US-%s.uf2" % CIRCUITPYTHON_VERSION,
    "25f25f342c5f072d8b949b3036c76c0e244c29b9aefa883ff1bde2e6cdd4e2ff",
)
CIRCUITPYTHON_LICENSE = (
    "https://raw.githubusercontent.com/adafruit/circuitpython/%s/LICENSE" % CIRCUITPYTHON_VERSION,
    "f8d44b948113cff390f6454e59069139a92da75227a7b50bb3589499d4b5fe1b",
)
KMK = (
    "https://codeload.github.com/KMKfw/kmk_firmware/zip/" + KMK_COMMIT,
    "ac013b7cc4f64b2cde251af240c4511e1d87ffe022da3ba4c348af47e8d382d5",
)
BUNDLE = (
    "https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases/download/%s/"
    "adafruit-circuitpython-bundle-10.x-mpy-%s.zip" % (BUNDLE_DATE, BUNDLE_DATE),
    "e304a9f534feba113139693ed3badda0fcd2601103e38715fa1278abb79e9b79",
)
MPY_CROSS = {
    "win32": (
        "https://adafruit-circuit-python.s3.amazonaws.com/bin/mpy-cross/windows/"
        "mpy-cross-windows-%s.static.exe" % CIRCUITPYTHON_VERSION,
        "0f57daeaeda62d9f4b36c110ea0dc6e80f60ef8eb8adb77d576741167e1a47a9",
    ),
    "linux": (
        "https://adafruit-circuit-python.s3.amazonaws.com/bin/mpy-cross/linux-amd64/"
        "mpy-cross-linux-amd64-%s.static" % CIRCUITPYTHON_VERSION,
        "aa74dcb51e51c1a70fd268dad9e05b40f72c29df3082f86c3a20665360e4acda",
    ),
}

# the libraries the firmware imports (the same list as step 5 of "Setting up a new pad" in app/README.md)
LIBRARIES = ("neopixel.mpy", "adafruit_displayio_ssd1306.mpy", "adafruit_display_text/")

# ---------------------------------------------------------------- flash layout (see the docstring)
XIP_BASE = 0x10000000
NVM_ADDR = XIP_BASE + 1020 * 1024
NVM_SIZE = 4 * 1024
DRIVE_ADDR = NVM_ADDR + NVM_SIZE
DRIVE_SECTORS = 2048                 # 2 MB flash - 1 MB
SECTOR = 512
LABEL = "CIRCUITPY"

# ---------------------------------------------------------------- UF2
UF2_MAGIC = (0x0A324655, 0x9E5D5157, 0x0AB16F30)
UF2_FAMILY_ID = 0x00002000           # flag: the family field is set
RP2040_FAMILY = 0xE48BFF56
UF2_PAYLOAD = 256                    # the RP2040 boot ROM only takes 256-byte blocks


def read_uf2(data):
    """The (address, payload) blocks of an RP2040 .uf2."""
    if len(data) % 512:
        raise ValueError("a .uf2 is made of 512-byte blocks")
    out = []
    for i in range(0, len(data), 512):
        b = data[i:i + 512]
        m0, m1, flags, addr, size, _, _, family = struct.unpack_from("<8I", b)
        if (m0, m1) != UF2_MAGIC[:2] or struct.unpack_from("<I", b, 508)[0] != UF2_MAGIC[2]:
            raise ValueError("not a .uf2 block at byte %d" % i)
        if not flags & UF2_FAMILY_ID or family != RP2040_FAMILY or size != UF2_PAYLOAD:
            raise ValueError("not an RP2040 block at byte %d" % i)
        out.append((addr, b[32:32 + size]))
    return out


def blocks_for(addr, data):
    """(address, payload) blocks that write data at addr, padded with 0xFF to whole blocks."""
    if addr % UF2_PAYLOAD:
        raise ValueError("not aligned")
    pad = -len(data) % UF2_PAYLOAD
    data = bytes(data) + b"\xff" * pad
    return [(addr + i, data[i:i + UF2_PAYLOAD]) for i in range(0, len(data), UF2_PAYLOAD)]


FLASH_SECTOR = 4096                  # what the boot ROM erases at once
PAGES_PER_SECTOR = FLASH_SECTOR // UF2_PAYLOAD


def write_uf2(blocks):
    """One .uf2 from (address, payload) blocks, numbered as a single file.

    Two .uf2 files simply joined do not work on the RP2040: its boot ROM restarts as soon as it has the number of blocks
    that the first file announces. So every block gets its place in the whole file.

    The boot ROM also decides when to erase a 4 KB flash sector from the block NUMBER, not the address
    (pico-bootrom-rp2040, virtual_disk.c: page_no = block_no * 256 / 4096): it erases the sector of the first block of
    each run of 16 numbers. That is only right when blocks 16n to 16n+15 are the 16 pages of one sector. So every
    sector that is written at all gets all 16 of its pages (missing ones as 0xFF, what an erased sector holds anyway).
    Without that, a part that starts in the middle of a run (CircuitPython ends half-way through a sector) has every
    sector after it erased again half-way through writing it: the first 2 KB of each one is lost."""
    blocks = sorted(blocks)
    for (a, _), (b, _) in zip(blocks, blocks[1:]):
        if b < a + UF2_PAYLOAD:
            raise ValueError("two blocks overlap at 0x%08x" % b)
    have = dict(blocks)
    for sector in sorted({a & ~(FLASH_SECTOR - 1) for a in have}):
        for page in range(sector, sector + FLASH_SECTOR, UF2_PAYLOAD):
            have.setdefault(page, b"\xff" * UF2_PAYLOAD)
    blocks = sorted(have.items())
    out = io.BytesIO()
    for n, (addr, payload) in enumerate(blocks):
        head = struct.pack("<8I", UF2_MAGIC[0], UF2_MAGIC[1], UF2_FAMILY_ID, addr, UF2_PAYLOAD, n, len(blocks),
                           RP2040_FAMILY)
        out.write(head + payload + b"\0" * (476 - UF2_PAYLOAD) + struct.pack("<I", UF2_MAGIC[2]))
    return out.getvalue()


# ---------------------------------------------------------------- FAT12
# A plain FAT12 file system like the one CircuitPython formats itself: 512-byte sectors and clusters, one FAT, no
# partition table, long file names (VFAT). Fixed time stamps keep the image the same for the same files.
ROOT_ENTRIES = 512
SHORT_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'()-@^_`{}~")
ATTR_DIR, ATTR_FILE, ATTR_LABEL, ATTR_LFN = 0x10, 0x20, 0x08, 0x0F


def _clean(text):
    return "".join(c if c in SHORT_CHARS else "_" for c in text.upper().replace(" ", ""))


def short_names(names):
    """{name: 11-byte 8.3 name}, unique within one directory, in the Windows style (LONGNA~1.EXT)."""
    out, used = {}, set()
    for name in sorted(names):
        base, dot, ext = name.rpartition(".")
        if not dot or not base:             # no extension, or a name like ".hidden"
            base, ext = name, ""
        b, e = _clean(base.replace(".", "")), _clean(ext)[:3]
        if b == base.upper() and e == ext.upper() and 1 <= len(b) <= 8 and len(ext) <= 3 and (b, e) not in used:
            pick = b
        else:
            n = 1
            while True:
                tail = "~%d" % n
                pick = (b or "_")[:8 - len(tail)] + tail
                if (pick, e) not in used:
                    break
                n += 1
        used.add((pick, e))
        out[name] = (pick.ljust(8) + e.ljust(3)).encode("ascii")
    return out


def lfn_checksum(short):
    s = 0
    for c in short:
        s = (((s & 1) << 7) + (s >> 1) + c) & 0xFF
    return s


def lfn_entries(name, short):
    """The long-name entries that come before the 8.3 entry, last part first."""
    units = name.encode("utf-16-le")
    units = [units[i:i + 2] for i in range(0, len(units), 2)]
    count = math.ceil(len(units) / 13)
    units += [b"\0\0"] if len(units) % 13 else []
    units += [b"\xff\xff"] * (count * 13 - len(units))
    ck = lfn_checksum(short)
    out = []
    for i in range(count, 0, -1):
        part = units[(i - 1) * 13:i * 13]
        seq = i | (0x40 if i == count else 0)
        out.append(bytes([seq]) + b"".join(part[0:5]) + bytes([ATTR_LFN, 0, ck]) + b"".join(part[5:11]) + b"\0\0"
                   + b"".join(part[11:13]))
    return out


def fat_stamp(t):
    """(date, time) in FAT format for a time.struct_time."""
    return (((t.tm_year - 1980) << 9) | (t.tm_mon << 5) | t.tm_mday,
            (t.tm_hour << 11) | (t.tm_min << 5) | (t.tm_sec // 2))


def dir_entry(short, attr, cluster, size, stamp):
    d, t = stamp
    return struct.pack("<11sBBBHHHHHHHI", short, attr, 0, 0, t, d, d, 0, t, d, cluster, size)


def _tree(files):
    root = {}
    for path, data in files.items():
        parts = path.strip("/").split("/")
        node = root
        for p in parts[:-1]:
            node = node.setdefault(p, {})
            if not isinstance(node, dict):
                raise ValueError("a file is in the way of folder " + p)
        if parts[-1] in node:
            raise ValueError("twice in the image: " + path)
        node[parts[-1]] = bytes(data)
    return root


def fat12_image(files, sectors=DRIVE_SECTORS, label=LABEL, when=None, volume_id=0x53504144):
    """A FAT12 image of `sectors` sectors holding files ({"path/name": bytes}, folders made as needed)."""
    stamp = fat_stamp(when or time.gmtime(1767225600))     # 2026-01-01
    root_sectors = ROOT_ENTRIES * 32 // SECTOR
    fat_sectors = 1
    while True:     # the FAT must hold an entry for every cluster of the space that is left after it
        clusters = sectors - 1 - fat_sectors - root_sectors
        if math.ceil((clusters + 2) * 3 / 2 / SECTOR) <= fat_sectors:
            break
        fat_sectors += 1
    if clusters >= 4085:
        raise ValueError("too big for FAT12")
    data_start = 1 + fat_sectors + root_sectors
    img = bytearray(sectors * SECTOR)
    fat = [0] * (clusters + 2)
    fat[0], fat[1] = 0xFF8, 0xFFF
    nxt = [2]

    def alloc(nbytes):
        n = math.ceil(nbytes / SECTOR)
        if not n:
            return 0
        first = nxt[0]
        if first + n - 1 > clusters + 1:
            raise ValueError("the files do not fit on the %d KB drive" % (sectors * SECTOR // 1024))
        for c in range(first, first + n):
            fat[c] = c + 1
        fat[first + n - 1] = 0xFFF
        nxt[0] += n
        return first

    def put(cluster, data):
        off = (data_start + cluster - 2) * SECTOR
        img[off:off + len(data)] = data

    def entries_of(node):
        shorts = short_names(node)
        out = []
        for name in sorted(node):
            s = shorts[name]
            shown = s[:8].decode().rstrip() + ("." + s[8:].decode().rstrip() if s[8:].strip() else "")
            out.append((name, s, [] if shown == name else lfn_entries(name, s)))
        return out

    def write_dir(node, own, parent):
        """Allocate and write everything in node; own = node's first cluster (0 = the root)."""
        listing = []
        for name, s, lfn in entries_of(node):
            child = node[name]
            if isinstance(child, dict):
                count = 2 + sum(1 + len(x[2]) for x in entries_of(child))
                first = alloc(count * 32)
                write_dir(child, first, own)
                listing.append(b"".join(lfn) + dir_entry(s, ATTR_DIR, first, 0, stamp))
            else:
                first = alloc(len(child))
                if first:
                    put(first, child)
                listing.append(b"".join(lfn) + dir_entry(s, ATTR_FILE, first, len(child), stamp))
        if own:
            head = dir_entry(b".          ", ATTR_DIR, own, 0, stamp) + dir_entry(b"..         ", ATTR_DIR, parent, 0,
                                                                                stamp)
            put(own, head + b"".join(listing))
        else:
            body = dir_entry(label.upper().ljust(11)[:11].encode("ascii"), ATTR_LABEL, 0, 0, stamp) + b"".join(listing)
            if len(body) > ROOT_ENTRIES * 32:
                raise ValueError("too many entries in the root folder")
            off = (1 + fat_sectors) * SECTOR
            img[off:off + len(body)] = body

    write_dir(_tree(files), 0, 0)

    # FAT12: two 12-bit entries in three bytes
    fat_bytes = bytearray(fat_sectors * SECTOR)
    for n, v in enumerate(fat):
        o = n * 3 // 2
        if n % 2 == 0:
            fat_bytes[o] = v & 0xFF
            fat_bytes[o + 1] = (fat_bytes[o + 1] & 0xF0) | (v >> 8)
        else:
            fat_bytes[o] = (fat_bytes[o] & 0x0F) | ((v & 0x0F) << 4)
            fat_bytes[o + 1] = v >> 4
    img[SECTOR:SECTOR + len(fat_bytes)] = fat_bytes

    boot = bytearray(SECTOR)
    boot[0:11] = b"\xeb\x3c\x90MSDOS5.0"
    struct.pack_into("<HBHBHHBHHHII", boot, 11, SECTOR, 1, 1, 1, ROOT_ENTRIES, sectors, 0xF8, fat_sectors, 63, 255,
                     0, 0)
    struct.pack_into("<BBBI11s8s", boot, 36, 0x80, 0, 0x29, volume_id, label.upper().ljust(11)[:11].encode("ascii"),
                     b"FAT12   ")
    boot[510:512] = b"\x55\xaa"
    img[0:SECTOR] = boot
    return bytes(img)


# ---------------------------------------------------------------- downloads
def fetch(url, sha256, cache=CACHE):
    """The bytes at url, from the cache when the file there has the pinned SHA-256."""
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, sha256[:16] + "-" + url.rstrip("/").rsplit("/", 1)[-1])
    if os.path.exists(path):
        with open(path, "rb") as f:
            data = f.read()
        if hashlib.sha256(data).hexdigest() == sha256:
            return data
    print("  downloading", url)
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha256:
        sys.exit("%s\n  has SHA-256 %s, expected %s.\n  If the pin in build_uf2.py was changed on purpose, put the new "
                 "hash next to it." % (url, got, sha256))
    with open(path, "wb") as f:
        f.write(data)
    return data


def mpy_cross_path(given):
    if given:
        return given
    key = "win32" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else None
    if key is None or (key == "linux" and os.uname().machine not in ("x86_64", "AMD64")):
        sys.exit("no pinned mpy-cross for this computer: pass --mpy-cross (CircuitPython %s)" % CIRCUITPYTHON_VERSION)
    url, sha = MPY_CROSS[key]
    fetch(url, sha)
    path = os.path.join(CACHE, sha[:16] + "-" + url.rsplit("/", 1)[-1])
    os.chmod(path, 0o755)
    return path


def unpack_kmk(zip_bytes):
    """The kmk/ folder (and KMK's LICENSE.md) of the KMK archive, unpacked into the cache."""
    out = os.path.join(CACHE, "kmk-" + KMK_COMMIT[:12])
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    top = "kmk_firmware-%s/" % KMK_COMMIT
    for name in z.namelist():
        rel = name[len(top):]
        if not name.startswith(top) or not (rel.startswith("kmk/") or rel == "LICENSE.md") or name.endswith("/"):
            continue
        dst = os.path.join(out, *rel.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(z.read(name))
    return out


def libraries(zip_bytes):
    """{"lib/...": bytes} for LIBRARIES, from the Adafruit bundle."""
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    top = "adafruit-circuitpython-bundle-10.x-mpy-%s/lib/" % BUNDLE_DATE
    out = {}
    for want in LIBRARIES:
        for name in z.namelist():
            rel = name[len(top):]
            if name.startswith(top) and not name.endswith("/") and (rel == want or (want.endswith("/")
                                                                                    and rel.startswith(want))):
                out["lib/" + rel] = z.read(name)
        if not any(k == "lib/" + want or k.startswith("lib/" + want) for k in out):
            sys.exit("the bundle has no " + want)
    return out


# ---------------------------------------------------------------- the pad's files
def firmware_version():
    with open(os.path.join(HERE, "app_profiles.py"), encoding="utf-8") as f:
        return re.search(r'^FIRMWARE_VERSION = "(\d+\.\d+\.\d+)"', f.read(), re.M).group(1)


def build_files(dev):
    """{"path": bytes}: everything in Programs/build (from build_mpy.py) that belongs on the pad."""
    out = {}
    for d, dirs, names in os.walk(BUILD):
        rel_dir = os.path.relpath(d, BUILD).replace(os.sep, "/")
        if rel_dir == "ota" or rel_dir.startswith("ota/"):
            continue
        for n in names:
            rel = n if rel_dir == "." else rel_dir + "/" + n
            with open(os.path.join(d, n), "rb") as f:
                out[rel] = f.read()
    for need in ("code.py", "boot.py", "firmware.mpy"):
        if need not in out:
            sys.exit("build_mpy.py left no " + need)
    if not any(k.startswith("kmk/") for k in out):
        sys.exit("build_mpy.py compiled no kmk/ files")
    if ("dev_tools.mpy" in out) != dev:
        sys.exit("dev_tools.mpy must be in a --dev image and nowhere else")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mpy-cross", help="mpy-cross for CircuitPython " + CIRCUITPYTHON_VERSION)
    ap.add_argument("--out", help="the .uf2 to write")
    ap.add_argument("--dev", action="store_true", help="DEVELOPMENT image (dev tools, watchdog off)")
    ap.add_argument("--fat-out", help="also write the bare CIRCUITPY drive image here")
    args = ap.parse_args()

    version = firmware_version()
    out = args.out or os.path.join(HERE, "dist", "SnekPad-pad-%s%s.uf2" % (version, "-DEV" if args.dev else ""))

    print("Pinned parts: CircuitPython %s, KMK %s, Adafruit bundle %s" % (CIRCUITPYTHON_VERSION, KMK_COMMIT[:12],
                                                                         BUNDLE_DATE))
    mpy_cross = mpy_cross_path(args.mpy_cross)
    circuitpython = fetch(*CIRCUITPYTHON)
    kmk = unpack_kmk(fetch(*KMK))
    libs = libraries(fetch(*BUNDLE))
    cp_license = fetch(*CIRCUITPYTHON_LICENSE)

    cmd = [sys.executable, os.path.join(HERE, "build_mpy.py"), "--mpy-cross", mpy_cross, "--kmk",
           os.path.join(kmk, "kmk")] + (["--dev"] if args.dev else [])
    sys.stdout.flush()
    if subprocess.run(cmd).returncode:
        sys.exit("build_mpy.py failed")

    files = build_files(args.dev)
    files.update(libs)
    with open(os.path.join(HERE, "snekpad32.bmp"), "rb") as f:
        files["snekpad32.bmp"] = f.read()
    if args.dev:
        files["nowatchdog"] = b""
    with open(os.path.join(HERE, "LICENSE"), "rb") as f:
        files["licenses/SnekPad-firmware-GPL-3.0.txt"] = f.read()
    with open(os.path.join(kmk, "LICENSE.md"), "rb") as f:
        files["licenses/KMK-GPL-3.0.md"] = f.read()
    files["licenses/CircuitPython-MIT.txt"] = cp_license
    with open(os.path.join(REPO, "THIRD-PARTY-NOTICES.md"), "rb") as f:
        files["licenses/THIRD-PARTY-NOTICES.md"] = f.read()

    drive = fat12_image(files)
    cp_blocks = read_uf2(circuitpython)
    if max(a for a, _ in cp_blocks) + UF2_PAYLOAD > NVM_ADDR:
        sys.exit("this CircuitPython is bigger than its flash area: check the layout in build_uf2.py")
    uf2 = write_uf2(cp_blocks + blocks_for(NVM_ADDR, b"\xff" * NVM_SIZE) + blocks_for(DRIVE_ADDR, drive))

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "wb") as f:
        f.write(uf2)
    if args.fat_out:
        with open(args.fat_out, "wb") as f:
            f.write(drive)
    used = sum(math.ceil(len(d) / SECTOR) for d in files.values()) * SECTOR
    print("built", out)
    print("  %s image: firmware %s, %d files, %d KB of the %d KB drive, %d KB .uf2"
          % ("DEV" if args.dev else "customer", version, len(files), used // 1024, DRIVE_SECTORS * SECTOR // 1024,
             len(uf2) // 1024))


if __name__ == "__main__":
    main()
