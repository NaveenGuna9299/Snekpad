// The page the HUD window shows. Plain HTML (no React, no bundle), like the splash. It draws from what the main process
// hands it through render(), always with textContent and never markup, because labels are typed by the user.
// The sizes (compact, slim, comfy) are only CSS, so changing size is a class change.

export const hudPage = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;user-select:none;cursor:default}
  button{font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer}
  .hud{position:relative;box-sizing:border-box;height:100%;padding:10px 12px 12px;border-radius:14px;background:rgba(1,19,57,var(--a,.9));border:1px solid rgba(31,217,138,.55);color:#fff;opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s}
  .hud.on{opacity:1;transform:none}
  .top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px;padding-right:26px;cursor:move}
  .name{font-weight:600;font-size:14px;letter-spacing:1px;color:#1fd98a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .knob{font-size:11px;color:#8fa3cc;white-space:nowrap}
  .name,.knob{text-shadow:0 1px 2px rgba(0,0,0,.65)}
  .dots{position:absolute;top:7px;right:8px;width:24px;height:20px;display:flex;gap:3px;align-items:center;justify-content:center;border-radius:6px;opacity:.7}
  .dots:hover{opacity:1;background:rgba(255,255,255,.14)}
  .dots i{width:4px;height:4px;border-radius:50%;background:#fff}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:6px;height:calc(100% - 30px)}
  .k{position:relative;box-sizing:border-box;padding:5px 6px 5px 10px;border-radius:8px;background:rgba(18,37,79,.95);overflow:hidden;display:flex;flex-direction:column;justify-content:center;min-width:0;transition:transform .08s,background .08s}
  .k:before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c)}
  .k b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k small{font-size:10px;color:#8fa3cc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k.none{opacity:.35}
  .k.none:before{background:transparent}
  .k.press{background:var(--c);transform:scale(.94)}
  .k.press b,.k.press small{color:var(--t)}

  .s-compact{padding:7px 8px 8px}
  .s-compact .top{margin-bottom:5px}
  .s-compact .name{font-size:12px}
  .s-compact .dots{top:5px;right:6px}
  .s-compact .grid{gap:4px;height:calc(100% - 24px)}
  .s-compact .k{padding:2px 4px 2px 9px}
  .s-compact .k b{font-size:12px}
  .s-compact .k small,.s-slim .k small{display:none}

  .s-slim{display:flex;align-items:center;gap:6px;padding:6px 8px}
  .s-slim .top{margin:0;padding:0 6px 0 2px}
  .s-slim .name{font-size:12px}
  .s-slim .knob{display:none}
  .s-slim .grid{flex:1;height:100%;grid-template-columns:repeat(12,1fr);grid-template-rows:1fr;gap:4px}
  .s-slim .k{padding:0 4px 0 8px}
  .s-slim .k b{font-size:12px}
  .s-slim .dots{position:static;flex:none}

  .menu{display:none}
  .hud.menu{display:block;padding:10px 12px}
  .hud.menu .top,.hud.menu .grid,.hud.menu .dots{display:none}
  .hud.menu .menu{display:flex;flex-direction:column;gap:9px;height:100%}
  .mh{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;color:#1fd98a;letter-spacing:1px}
  .x{width:22px;height:22px;border-radius:6px;font-size:14px;color:#c9d6f2}
  .x:hover{background:rgba(255,255,255,.14)}
  .row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#8fa3cc}
  .seg{display:inline-flex;border:1px solid rgba(143,163,204,.35);border-radius:7px;overflow:hidden}
  .seg button{padding:4px 9px;font-size:12px;color:#c9d6f2}
  .seg button:hover{background:rgba(255,255,255,.1)}
  .seg button.on{background:rgba(31,217,138,.28);color:#fff}
  .op{display:flex;align-items:center;gap:8px}
  .op input{width:110px;accent-color:#1fd98a}
  .op span{width:34px;text-align:right;color:#fff}
  .corners{display:grid;grid-template-columns:repeat(2,30px);gap:3px}
  .corners button{height:14px;border-radius:4px;background:rgba(143,163,204,.3)}
  .corners button:hover{background:rgba(143,163,204,.5)}
  .corners button.on{background:#1fd98a}
  .hint{font-size:11px;color:#8fa3cc;line-height:1.4}
</style>
<div class="hud" id="hud">
  <div class="top" id="top"><span class="name" id="name"></span><span class="knob" id="knob"></span></div>
  <div class="grid" id="grid"></div>
  <button class="dots" id="dots" aria-label="HUD settings" title="HUD settings"><i></i><i></i><i></i></button>
  <div class="menu" id="menu">
    <div class="mh"><span>HUD SETTINGS</span><button class="x" id="mx" aria-label="Close">&#10005;</button></div>
    <div class="row"><span>Show</span><div class="seg">
      <button data-k="mode" data-v="off">Off</button><button data-k="mode" data-v="flash">On switch</button><button data-k="mode" data-v="pinned">Always</button>
    </div></div>
    <div class="row"><span>Size</span><div class="seg">
      <button data-k="size" data-v="compact">Compact</button><button data-k="size" data-v="slim">Slim</button><button data-k="size" data-v="comfy">Comfy</button>
    </div></div>
    <div class="row"><span>Opacity</span><div class="op"><input type="range" id="op" min="20" max="100" step="5"><span id="opv"></span></div></div>
    <div class="row"><span>Corner</span><div class="corners">
      <button data-k="corner" data-v="top-left" title="Top left"></button><button data-k="corner" data-v="top-right" title="Top right"></button>
      <button data-k="corner" data-v="bottom-left" title="Bottom left"></button><button data-k="corner" data-v="bottom-right" title="Bottom right"></button>
    </div></div>
    <div class="hint" id="hint"></div>
  </div>
</div>
<script>
  const api = window.hudApi
  const $ = (id) => document.getElementById(id)
  const hud = $('hud')
  let st = { data: null, pref: null, menu: false }
  let shown = false

  // white or dark text on a key that is lit up in its own colour
  function textOn(hex) {
    const n = parseInt(hex.slice(1), 16)
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? '#06102a' : '#ffffff'
  }

  function draw() {
    const { data, pref, menu } = st
    if (!data || !pref) return
    hud.className = 'hud s-' + pref.size + (menu ? ' menu' : '') + (shown ? ' on' : '')
    hud.style.setProperty('--a', pref.opacity)
    $('name').textContent = data.name
    $('knob').textContent = data.knob
    $('grid').replaceChildren(...data.keys.map((k) => {
      const el = document.createElement('div')
      el.className = k.none ? 'k none' : 'k'
      el.style.setProperty('--c', k.color)
      el.style.setProperty('--t', textOn(k.color))
      el.title = k.text
      const b = document.createElement('b')
      b.textContent = k.label
      const s = document.createElement('small')
      s.textContent = k.text
      el.append(b, s)
      return el
    }))
    // the menu is built once and only updated, so a slider being dragged is never replaced under the mouse
    document.querySelectorAll('[data-k]').forEach((b) => {
      const k = b.dataset.k, v = b.dataset.v
      b.classList.toggle('on', k === 'corner' ? !pref.pos && pref.corner === v : pref[k] === v)
    })
    const pct = Math.round(pref.opacity * 100)
    if (Number($('op').value) !== pct) $('op').value = pct
    $('opv').textContent = pct + '%'
    $('hint').textContent = (pref.pos ? 'It is where you dragged it. Pick a corner to snap it back. ' : '') +
      'Drag the top bar to move it anywhere.'
  }

  window.render = (s) => { st = s; draw() }
  window.visible = (on) => { shown = on; hud.classList.toggle('on', on) }
  // a key on the pad went down or up: light it up while it is held
  window.press = (i, down) => { const el = $('grid').children[i]; if (el) el.classList.toggle('press', down) }

  $('dots').addEventListener('click', () => api.menu(true))
  $('mx').addEventListener('click', () => api.menu(false))
  $('menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]')
    if (!b) return
    api.set(b.dataset.k === 'corner' ? { corner: b.dataset.v, pos: null } : { [b.dataset.k]: b.dataset.v })
  })
  $('op').addEventListener('input', (e) => api.set({ opacity: Number(e.target.value) / 100 }))

  // dragging the top bar moves the whole window; the main process keeps it on a screen and remembers where it ended
  const bar = $('top')
  let drag = null
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st.menu) return
    bar.setPointerCapture(e.pointerId)
    drag = { x: e.screenX, y: e.screenY }
    api.dragStart()
  })
  bar.addEventListener('pointermove', (e) => { if (drag) api.dragMove(e.screenX - drag.x, e.screenY - drag.y) })
  const end = () => { if (drag) { drag = null; api.dragEnd() } }
  bar.addEventListener('pointerup', end)
  bar.addEventListener('pointercancel', end)
  bar.addEventListener('lostpointercapture', end)
</script>`
