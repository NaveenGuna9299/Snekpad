// Splash screen: a small frameless window shown while the main window loads. Plain inline HTML so
// it appears at once and does not depend on the dev server or the bundled renderer.
import { BrowserWindow } from 'electron'

const MIN_VISIBLE_MS = 1300 // long enough for the key animation to read as intentional, not a flash

const keys = Array.from(
  { length: 12 },
  (_, i) => `<i style="animation-delay:${i * 0.1}s"></i>`
).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#011339;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;-webkit-app-region:drag;user-select:none}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center}
  .pad{display:grid;grid-template-columns:repeat(4,38px);gap:9px;padding:13px;border:3px solid #1fd98a;border-radius:18px}
  .pad i{height:38px;border-radius:8px;background:#12254f;animation:key 2.4s infinite}
  .pad .oled{grid-column:span 3;height:38px;border-radius:8px;background:#05080a;border:2px solid #12254f;box-sizing:border-box;animation:none}
  .pad .knob{width:38px;height:38px;border-radius:50%;background:#12254f;position:relative;animation:none}
  .pad .knob:after{content:'';position:absolute;left:50%;top:5px;width:3px;height:12px;margin-left:-1.5px;border-radius:2px;background:#b8f5d6;transform-origin:50% 14px;animation:turn 2.4s ease-in-out infinite}
  @keyframes turn{0%,100%{transform:rotate(-40deg)}50%{transform:rotate(40deg)}}
  @keyframes key{0%,8%{background:#12254f}16%,34%{background:#b8f5d6}50%,100%{background:#12254f}}
  .wm{margin-top:24px;font-weight:600;letter-spacing:3px;font-size:17px;color:#fff}
  .wm b{color:#1fd98a;font-weight:600}
  .st{margin-top:8px;font-size:12px;color:#8fa3cc}
</style>
<div class="pad"><i class="oled"></i><i class="knob"></i>${keys}</div>
<div class="wm">SNEK<b>PAD</b> STUDIO</div>
<div class="st">Starting…</div>`

export interface Splash {
  /** Close the splash once it has been visible long enough; resolves when it is gone. */
  close: () => Promise<void>
}

export function showSplash(): Splash {
  const win = new BrowserWindow({
    width: 460,
    height: 380,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    center: true,
    backgroundColor: '#011339',
    alwaysOnTop: true
  })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const shownAt = Date.now()
  setTimeout(() => !win.isDestroyed() && win.close(), 15000) // never get stuck if the app fails to load

  return {
    close: async () => {
      const wait = MIN_VISIBLE_MS - (Date.now() - shownAt)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      if (!win.isDestroyed()) win.close()
    }
  }
}
