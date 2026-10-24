# SPDX-License-Identifier: GPL-3.0-only
# The ready-made pad image (build_uf2.py): the FAT12 drive reads back with the same files, names and folders, and the
# .uf2 is one file whose blocks the RP2040 boot ROM accepts. Nothing is downloaded: the tests use made-up files.
#
#     python -m unittest discover -s Programs/tests -v

import os
import struct
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import build_uf2 as B  # noqa: E402


def read_fat12(img):
    """{"path": bytes} of a FAT12 image, read the way FatFs reads it (a separate, minimal reader)."""
    bps, spc, rsv, nfat, nroot, total, _, fatsz = struct.unpack_from("<HBHBHHBH", img, 11)
    assert img[510:512] == b"\x55\xaa" and img[54:59] == b"FAT12"
    assert bps == 512 and nroot % 16 == 0
    root_off = (rsv + nfat * fatsz) * bps
    data_off = root_off + nroot * 32
    clusters = (total - rsv - nfat * fatsz - nroot * 32 // bps) // spc
    assert clusters < 4085, "a FAT12 file system has fewer than 4085 clusters"
    fat = img[rsv * bps:(rsv + fatsz) * bps]

    def nxt(c):
        o = c * 3 // 2
        v = fat[o] | fat[o + 1] << 8
        return v >> 4 if c & 1 else v & 0xFFF

    def chain(c):
        out = []
        while c < 0xFF8:
            assert 2 <= c < clusters + 2, "cluster %d outside the drive" % c
            out.append(c)
            c = nxt(c)
        return out

    def read_chain(c):
        return b"".join(img[data_off + (x - 2) * bps * spc:data_off + (x - 1) * bps * spc] for x in chain(c))

    def walk(raw, prefix, out):
        lfn = {}
        for i in range(0, len(raw), 32):
            e = raw[i:i + 32]
            if e[0] == 0:
                break
            if e[11] == 0x0F:
                part = e[1:11] + e[14:26] + e[28:32]
                lfn[e[0] & 0x1F] = (part, e[13])
                continue
            name11, attr = e[:11], e[11]
            if attr & 0x08 or name11 in (b".          ", b"..         "):
                lfn = {}
                continue
            if lfn:
                assert all(ck == B.lfn_checksum(name11) for _, ck in lfn.values()), "LFN checksum"
                name = b"".join(lfn[k][0] for k in sorted(lfn)).decode("utf-16-le").split("\0")[0]
            else:
                base, ext = name11[:8].decode().rstrip(), name11[8:].decode().rstrip()
                name = base + ("." + ext if ext else "")
            lfn = {}
            cluster, size = struct.unpack_from("<HI", e, 26)
            if attr & 0x10:
                walk(read_chain(cluster), prefix + name + "/", out)
            else:
                out[prefix + name] = read_chain(cluster)[:size] if cluster else b""
        return out

    return walk(img[root_off:data_off], "", {})


FILES = {
    "code.py": b"import firmware\n",
    "boot.py": b"x" * 600,                                  # two clusters
    "firmware.mpy": bytes(range(256)) * 40,
    "empty.txt": b"",
    "README": b"upper case, fits 8.3 as it is\n",
    "kmk/__init__.py": b"",
    "kmk/modules/a_very_long_module_name_for_lfn.mpy": b"long",
    "kmk/modules/a_very_long_module_name_for_lfn2.mpy": b"long2",   # same 8.3 start: needs ~2
    "lib/adafruit_display_text/__init__.mpy": b"t" * 1500,
    "licenses/THIRD-PARTY-NOTICES.md": "naïve ✓".encode(),
}
# a folder with more entries than one 512-byte cluster holds
FILES.update({"kmk/many/m%02d_module.mpy" % i: b"%d" % i for i in range(40)})


class Fat12(unittest.TestCase):
    def test_files_read_back(self):
        img = B.fat12_image(FILES)
        self.assertEqual(len(img), B.DRIVE_SECTORS * B.SECTOR)
        self.assertEqual(read_fat12(img), FILES)

    def test_layout_is_the_circuitpython_drive(self):
        img = B.fat12_image(FILES)
        bps, spc, rsv, nfat, nroot, total, media, _ = struct.unpack_from("<HBHBHHBH", img, 11)
        self.assertEqual((bps, spc, rsv, nfat, total, media), (512, 1, 1, 1, 2048, 0xF8))
        self.assertEqual(img[0], 0xEB)                      # FatFs wants a jump instruction first
        self.assertEqual(img[43:54], b"CIRCUITPY  ")

    def test_volume_label_in_root(self):
        img = B.fat12_image({})
        _, _, rsv, nfat, _, _, _, fatsz = struct.unpack_from("<HBHBHHBH", img, 11)
        root = (rsv + nfat * fatsz) * 512
        self.assertEqual(img[root:root + 11], b"CIRCUITPY  ")
        self.assertEqual(img[root + 11], 0x08)

    def test_same_files_same_image(self):
        self.assertEqual(B.fat12_image(FILES), B.fat12_image(dict(reversed(list(FILES.items())))))

    def test_too_big(self):
        with self.assertRaisesRegex(ValueError, "do not fit"):
            B.fat12_image({"big.bin": b"\0" * (1024 * 1024)})

    def test_file_in_the_way_of_a_folder(self):
        with self.assertRaises(ValueError):
            B.fat12_image({"kmk": b"", "kmk/x.mpy": b""})


class ShortNames(unittest.TestCase):
    def test_names(self):
        s = B.short_names(["README", "code.py", "adafruit_display_text", "a_very_long_name.mpy",
                           "a_very_long_name2.mpy", "x.y.z"])
        self.assertEqual(s["README"], b"README     ")
        self.assertEqual(s["code.py"], b"CODE    PY ")
        self.assertEqual(s["adafruit_display_text"], b"ADAFRU~1   ")
        self.assertEqual({s["a_very_long_name.mpy"], s["a_very_long_name2.mpy"]}, {b"A_VERY~1MPY", b"A_VERY~2MPY"})
        self.assertEqual(s["x.y.z"], b"XY~1    Z  ")
        self.assertEqual(len(set(s.values())), len(s))

    def test_lfn_checksum(self):
        # the loop from Microsoft's FAT specification: rotate the sum right by one bit, then add the next byte
        def spec(name):
            s = 0
            for c in name:
                s = ((s >> 1) | ((s & 1) << 7)) & 0xFF
                s = (s + c) & 0xFF
            return s

        for name in (b"FILENAMEEXT", b"README     ", b"ADAFRU~1   ", b"\xff" * 11):
            self.assertEqual(B.lfn_checksum(name), spec(name))

    def test_lfn_parts(self):
        entries = B.lfn_entries("a" * 13, b"A~1        ")     # exactly 13: no terminator, no padding
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0][0], 0x41)
        entries = B.lfn_entries("a" * 14, b"A~1        ")
        self.assertEqual([e[0] for e in entries], [0x42, 0x01])
        self.assertTrue(all(len(e) == 32 and e[11] == 0x0F for e in entries))


class Uf2(unittest.TestCase):
    def test_numbered_as_one_file(self):
        blocks = B.blocks_for(0x10000000, b"a" * 600) + B.blocks_for(B.DRIVE_ADDR, b"b" * 300)
        data = B.write_uf2(blocks)
        self.assertEqual(len(data), 32 * 512)       # two sectors, filled up to 16 pages each
        for n in range(32):
            m0, m1, flags, addr, size, no, total, family = struct.unpack_from("<8I", data, n * 512)
            self.assertEqual((m0, m1, flags, size, no, total, family),
                             (0x0A324655, 0x9E5D5157, 0x2000, 256, n, 32, 0xE48BFF56))
            self.assertEqual(struct.unpack_from("<I", data, n * 512 + 508)[0], 0x0AB16F30)
        back = dict(B.read_uf2(data))
        for addr, payload in blocks:
            self.assertEqual(back[addr], payload)

    def boot_rom(self, data, flash):
        """Write a .uf2 into flash ({sector address: bytearray(4096)}) the way the RP2040 boot ROM does: a block
        erases the sector of its address when it is the first block of its run of 16 block NUMBERS to arrive
        (pico-bootrom-rp2040 virtual_disk.c, _write_uf2_page), then programs its page (flash bits only go 1 -> 0)."""
        cleared = set()
        for i in range(0, len(data), 512):
            addr, no = struct.unpack_from("<8I", data, i)[3], struct.unpack_from("<8I", data, i)[5]
            payload = data[i + 32:i + 288]
            sector = addr & ~0xFFF
            mem = flash.setdefault(sector, bytearray(b"\x5a" * 4096))     # old contents
            if no * 256 // 4096 not in cleared:
                cleared.add(no * 256 // 4096)
                mem[:] = b"\xff" * 4096
            o = addr - sector
            mem[o:o + 256] = bytes(x & y for x, y in zip(mem[o:o + 256], payload))

    def test_boot_rom_keeps_every_page(self):
        # like the real image: a first part that ends half-way through a sector (CircuitPython), then whole sectors
        first = bytes(range(256)) * 24                      # 6 KB: 1.5 sectors
        second = bytes((i * 7) & 0xFF for i in range(3 * 4096))
        data = B.write_uf2(B.blocks_for(0x10000000, first) + B.blocks_for(B.DRIVE_ADDR, second))
        flash = {}
        self.boot_rom(data, flash)
        self.assertEqual(bytes(flash[0x10000000] + flash[0x10001000])[:len(first)], first)
        got = b"".join(bytes(flash[B.DRIVE_ADDR + k * 4096]) for k in range(3))
        self.assertEqual(got, second)

    def test_every_run_of_16_blocks_is_one_sector(self):
        data = B.write_uf2(B.blocks_for(0x10000000, b"a" * 2048) + B.blocks_for(B.NVM_ADDR, b"\xff" * 4096))
        for i in range(0, len(data), 512):
            addr, no = struct.unpack_from("<8I", data, i)[3], struct.unpack_from("<8I", data, i)[5]
            self.assertEqual((addr & 0xFFF) // 256, no % 16)

    def test_padding_is_erased_flash(self):
        (_, payload), = B.blocks_for(B.DRIVE_ADDR, b"x")
        self.assertEqual(payload, b"x" + b"\xff" * 255)

    def test_overlap_refused(self):
        with self.assertRaisesRegex(ValueError, "overlap"):
            B.write_uf2(B.blocks_for(0x10000000, b"a" * 512) + B.blocks_for(0x10000100, b"b"))

    def test_layout(self):
        self.assertEqual(B.NVM_ADDR, 0x100FF000)
        self.assertEqual(B.DRIVE_ADDR, 0x10100000)
        self.assertEqual(B.DRIVE_ADDR + B.DRIVE_SECTORS * B.SECTOR, 0x10200000)   # the end of 2 MB of flash

    def test_not_a_uf2(self):
        with self.assertRaises(ValueError):
            B.read_uf2(b"\0" * 512)


if __name__ == "__main__":
    unittest.main()
