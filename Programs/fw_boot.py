# SPDX-License-Identifier: GPL-3.0-only
# fw_boot.py - finishes, or undoes, a firmware update before the firmware starts.
# Copy this file to the root of CIRCUITPY (next to code.py). It is NOT updated over the air: it is the safety
# net for updates, so it only changes with a flash from the computer (flash_pad.ps1).
#
# The code.py stub calls run(nvm) first thing at every start. The update itself is received by fw_update.py
# (while the firmware runs), which only stages the new files in /fw_new and then writes the commit marker
# /fw_apply (line 1 = version, then one file name per line). Nothing live changes until the next start:
#
#   1. apply():    moves each live file to /fw_old and the staged one in its place, recording what it did
#                  (/fw_old/names, /fw_old/had) before it starts. Every step can be repeated, so a power cut
#                  at any point is finished by the next start. Then it writes /fw_try (the trial marker).
#                  This covers the journal only: cutting the power while the flash drive itself is being written
#                  (staging, or these renames) can corrupt the drive, and CircuitPython then reformats it, which
#                  nothing here can undo (seen on hardware). That is why Studio says "do not unplug".
#   2. trial:      the new firmware has MAX_TRIES starts to prove itself. code.py's heartbeat deletes
#                  /fw_try after it has run for a while; every start under trial counts in nvm[2]. If the
#                  firmware keeps crashing or hanging, the count runs out and
#   3. rollback(): puts the old files back, writes /fw_failed (why), and the old firmware starts again.
#
# Only files in the update's list are touched, never config.json, boot.py, code.py, kmk/ or lib/.
# The file operations never rename onto an existing file (FAT refuses that).

import os

ROOT = ""                   # tests point this at a temporary folder; on the pad it is the root of CIRCUITPY
NEW = "/fw_new"             # staged files, verified, waiting for the commit
OLD = "/fw_old"             # backups of the files the update replaced
APPLY = "/fw_apply"         # commit marker: the update is complete, install it at the next start
TRY = "/fw_try"             # trial marker: the new firmware has not proved itself yet
ROLLBACK = "/fw_rollback"   # a rollback is in progress (its first line is the reason)
FAILED = "/fw_failed"       # the last update was undone (first line = why); Studio reads it once
MAX_TRIES = 3               # starts a new firmware gets to prove itself
TRY_NVM = 2                 # nvm[2] counts the starts under trial (nvm[0] and nvm[1] belong to the stub)


def _p(path):
    return ROOT + path


def exists(path):
    try:
        os.stat(_p(path))
        return True
    except OSError:
        return False


def _sync():
    try:
        os.sync()
    except Exception:
        pass


def write_atomic(path, text):
    """Write a small file so that it appears complete or not at all."""
    tmp = path + ".tmp"
    with open(_p(tmp), "w") as f:
        f.write(text)
    _sync()
    if exists(path):
        os.remove(_p(path))
    os.rename(_p(tmp), _p(path))
    _sync()


def lines(path):
    with open(_p(path)) as f:
        return [s.strip() for s in f.read().split("\n") if s.strip()]


def remove(path):
    if exists(path):
        os.remove(_p(path))


def clear_dir(path):
    """Delete a folder of plain files, and the folder."""
    if not exists(path):
        return
    for n in os.listdir(_p(path)):
        os.remove(_p(path + "/" + n))
    os.rmdir(_p(path))


def apply(nvm):
    info = lines(APPLY)
    names = info[1:]
    version = info[0]
    remove(FAILED)
    if not exists(OLD + "/had"):
        # the record of what is about to happen, complete before the first file moves
        if not exists(OLD):
            os.mkdir(_p(OLD))
        write_atomic(OLD + "/names", "\n".join(names))
        write_atomic(OLD + "/had", "\n".join([n for n in names if exists("/" + n)]))
    for n in names:
        if exists(NEW + "/" + n):
            if exists("/" + n):
                if exists(OLD + "/" + n):
                    raise RuntimeError("unexpected backup of " + n)
                os.rename(_p("/" + n), _p(OLD + "/" + n))
            os.rename(_p(NEW + "/" + n), _p("/" + n))
    clear_dir(NEW)
    write_atomic(TRY, version)
    nvm[TRY_NVM] = 0
    os.remove(_p(APPLY))        # last: until now the whole apply is repeated if power is cut
    _sync()


def rollback(nvm, reason=""):
    """Put the old files back. Safe to repeat, and to resume after a power cut."""
    if exists(ROLLBACK):
        reason = lines(ROLLBACK)[0] if lines(ROLLBACK) else reason
    else:
        write_atomic(ROLLBACK, reason or "update undone")
    names = lines(OLD + "/names") if exists(OLD + "/names") else []
    had = lines(OLD + "/had") if exists(OLD + "/had") else None
    if had is not None:     # without the record nothing was ever moved
        for n in names:
            if exists(OLD + "/" + n):
                if exists("/" + n):
                    os.remove(_p("/" + n))
                os.rename(_p(OLD + "/" + n), _p("/" + n))
            elif n not in had and exists("/" + n):
                os.remove(_p("/" + n))      # a file the update added
    clear_dir(NEW)
    remove(APPLY)
    remove(TRY)
    nvm[TRY_NVM] = 0
    write_atomic(FAILED, reason or "update undone")
    clear_dir(OLD)
    os.remove(_p(ROLLBACK))
    _sync()


def run(nvm):
    """Called by the code.py stub before the firmware is imported. Returns what it did, or None."""
    try:
        if exists(ROLLBACK):
            rollback(nvm)
            return "rolled back"
        if exists(APPLY):
            try:
                apply(nvm)
            except Exception as e:
                rollback(nvm, "install failed: " + str(e)[:40])
                return "rolled back"
        if exists(TRY):
            n = min(nvm[TRY_NVM] + 1, 255)
            nvm[TRY_NVM] = n
            if n > MAX_TRIES:
                rollback(nvm, "new firmware did not start")
                return "rolled back"
            return "trial"
    except Exception as e:
        print("fw_boot error:", e)
    return None
