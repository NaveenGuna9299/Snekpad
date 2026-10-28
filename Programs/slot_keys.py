# SPDX-License-Identifier: GPL-3.0-only
# slot_keys.py - the builder of the profile that SnekPad Studio sends for one app (the Studio slot). Copy this file to the
# root of CIRCUITPY (next to config_loader.py).
#
# It is a file of its own so that the pad does not carry it at start-up, where the screen needs the RAM: config_loader.py
# imports it only when a profile from Studio arrives (SLOT_BEGIN). Layer keys and the tap / hold key are in key_extras.py,
# which is loaded only when a profile uses one.

import json

from kmk.keys import KC
from kmk.modules.macros import Delay

KEYS = 12
SLOT_LAYERS = 2                # extra 12-key layers a Studio-only profile may have


class SlotBuilder:
    """The profile that SnekPad Studio sends for an app that has none of its own on the pad, built one line at a time.

    Studio keeps more profiles than the pad has room for and sends the one that fits the app in focus (SLOT_BEGIN,
    SLOT_KEY x 15 or more, SLOT_END; see app_profiles.py). Each key is built as its line arrives, so the pad never holds the
    text of a whole profile. Keys 0-11 are the pad's keys (label, colour, action), 12-14 the knob (turn right, turn
    left, press; their label and colour are not used), and a profile with extra layers goes on with 15-26 (layer 2),
    27-38 (layer 3), each the 12 keys of that layer. `base` is the keymap index the first extra layer will get, so a
    layer key knows where to go. env = (config_loader._action, ._hold, ._rgb).

    A sequence is sent as {"type":"sequence"} (no steps) and then one SLOT_STEP line per step. Parsing all the steps as one
    block of JSON needs several KB of RAM for a moment, which the pad does not have; a step at a time needs next to
    nothing, and the macro is made when the next key (or the end) arrives."""

    def __init__(self, env, name, knob_text, layers=0, base=0):
        if not 0 <= layers <= SLOT_LAYERS:
            raise ValueError("at most %d extra layers" % SLOT_LAYERS)
        self.action, self.hold, self.rgb = env
        self.COUNT = KEYS + 3 + layers * KEYS
        self.name = name[:12] or "Studio"
        self.knob_text = knob_text[:10]
        self.ctx = {}
        if layers:
            self.ctx[0] = base - 2      # the main keys: the slot layer itself (the extra layers start two after it)
        for i in range(layers):
            self.ctx[i + 1] = base + i
        self.keys = [None] * KEYS
        self.labels = [""] * KEYS
        self.colors = [0] * KEYS
        self.knob = [None] * 3
        self.sub = [dict(keys=[None] * KEYS, labels=[""] * KEYS, colors=[0] * KEYS) for _ in range(layers)]
        self.got = 0
        self.seq = -1       # the key whose steps are arriving, -1 = none
        self.acts = None    # the macro steps so far
        self.wait = 0       # pause after the last step so far (only used if another step follows)

    def _store(self, index, action):
        if index < KEYS:
            keys, at = self.keys, index
        elif index < KEYS + 3:
            keys, at = self.knob, index - KEYS
        else:
            keys, at = self.sub[(index - KEYS - 3) // KEYS]["keys"], (index - KEYS - 3) % KEYS
        if keys[at] is None:
            self.got += 1
        keys[at] = action

    def _end_seq(self):
        if self.seq >= 0:
            index, acts = self.seq, self.acts
            self.seq = -1
            self.acts = None
            if not acts:
                raise ValueError("empty sequence")
            self._store(index, KC.MACRO(*acts))

    def add(self, index, label, color, action_text):
        self._end_seq()
        if not 0 <= index < self.COUNT:
            raise ValueError("bad key number")
        a = json.loads(action_text)
        if a["type"] == "sequence" and "steps" not in a:
            if KEYS <= index < KEYS + 3:
                raise ValueError("no sequence on the knob")
            self.seq = index
            self.acts = []
            self.wait = 0
        else:
            self._store(index, self.action(a, self.ctx))
        if index < KEYS:
            self.labels[index] = label[:5]
            self.colors[index] = self.rgb(color)
        elif index >= KEYS + 3:
            sub = self.sub[(index - KEYS - 3) // KEYS]
            at = (index - KEYS - 3) % KEYS
            sub["labels"][at] = label[:5]
            sub["colors"][at] = self.rgb(color)

    def step(self, index, keys, wait):
        """One step of the sequence that SLOT_KEY just announced: keys joined with '+', pause after it in ms."""
        if index != self.seq:
            raise ValueError("no sequence")
        pause = int(wait)
        if not 0 <= pause <= 2000:
            raise ValueError("bad pause")
        if self.wait:
            self.acts.append(Delay(self.wait))      # same rule as a pushed sequence: a pause only between steps
        self.acts.extend(self.hold(keys.split("+")))
        self.wait = pause

    def finish(self):
        self._end_seq()
        if self.got != self.COUNT:
            raise ValueError("profile incomplete")
        return self
