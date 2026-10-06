# boot.py - makes the macropad act like a plain keyboard when it is plugged in:
#   * the CIRCUITPY drive is hidden, so nothing pops up on the computer
#   * the second USB serial port for focus_sender.py is on
#   * midi and mouse are off, and the device is named "SnekPad" in Windows
#
# To get the drive back (to edit code.py): hold the TOP-LEFT KEY while plugging in USB.
# (On a board with no switches fitted yet, touch a jumper wire between GP3 and GP0
#  while plugging in - that is exactly what the top-left key does.)
#
# After copying this file: UNPLUG the board and plug it back in.
# Do this LAST, when everything else works - while you are still editing the code
# you will want the drive visible.
import board

from kmk.bootcfg import bootcfg

bootcfg(
    sense=board.GP3,    # column 0 of the matrix
    source=board.GP0,   # row 0  -> together they read the top-left key
    cdc_data=True,      # second serial port (focus_sender.py talks to this)
    midi=False,
    mouse=False,
    storage=False,      # hide the drive unless the key is held at plug-in
    usb_id={"manufacturer": "SnekPad", "product": "SnekPad"},
)
