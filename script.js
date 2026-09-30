"use strict";

/* Every calculator lives in its own module (IIFE) and only touches the
   elements inside its own panel, so tabs can't break each other. */

/* ============ Shared helpers ============ */
const Util = {
  inField: t => !!(t && t.closest && t.closest("input, select, textarea")),
  // Enter/Space on a focused button should press that button, not type anything
  isButtonPress: e => (e.key === "Enter" || e.key === " ") && !!(e.target.closest && e.target.closest("button")),

  // Type text into an input the same way a real keypress would (runs its sanitiser too)
  insert(el, text) {
    el.focus();
    el.value += text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  backspace(el) {
    el.focus();
    el.value = el.value.slice(0, -1);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },

  // On-screen keypad → text field. Actions: a digit, ".", ",", "minus", "space", "neg", "back", "clear"
  padInput(el, action) {
    let v = el.value;
    const token = v.match(/[^\s,;]*$/)[0];                 // the number currently being typed
    if (action === "back") v = v.slice(0, -1);
    else if (action === "clear") v = "";
    else if (action === "neg") v = v.startsWith("-") ? v.slice(1) : "-" + v;
    else if (action === "minus") { if (token === "") v += "-"; }
    else if (action === ".") { if (token.includes(".")) return; v += token === "" || token === "-" ? "0." : "."; }
    else if (action === ",") { if (v.trim() !== "" && !/[\s,;]$/.test(v)) v += ", "; }
    else if (action === "space") { if (v !== "" && !/[\s,;]$/.test(v)) v += " "; }
    else v += action;                                       // a digit
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true })); // runs the field's own sanitiser / live update
  },

  // Connect a keypad: pressing a key edits whatever field getTarget() returns
  wirePad(padEl, getTarget) {
    padEl.addEventListener("pointerdown", e => { if (e.target.closest(".key")) e.preventDefault(); }); // keep focus where it is
    padEl.addEventListener("click", e => {
      const key = e.target.closest(".key");
      const el = key && getTarget();
      if (el) Util.padInput(el, key.dataset.pad);
    });
  },

  // 1234.5678 → "1,234.5678"; keeps 10 significant digits, uses ×10^n for huge/tiny values
  format(n) {
    if (!Number.isFinite(n)) return "—";
    const v = Number(n.toPrecision(10));
    const sign = v < 0 ? "−" : "";
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e12 || a < 1e-6)) return sign + a.toExponential(4).replace("e+", "×10^").replace("e", "×10^");
    return sign + a.toLocaleString("en-US", { maximumFractionDigits: 10 });
  },

  // Safe rendering of label/value rows and messages (uses textContent, never innerHTML)
  rows(el, rows) {
    el.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "list-row";
      const l = document.createElement("span"); l.textContent = label;
      const v = document.createElement("strong"); v.textContent = value;
      row.append(l, v);
      return row;
    }));
  },
  note(el, text, cls) {
    const p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    el.replaceChildren(p);
  },
};

/* ============ Tab manager (also sets the colour theme + routes keyboard input) ============ */
const Tabs = (() => {
  const tabs = [...document.querySelectorAll(".tab")];
  const panels = [...document.querySelectorAll(".panel")];
  const keyHandlers = {};

  const current = () => tabs.find(t => t.classList.contains("active")).dataset.tab;

  function activate(name) {
    tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
    document.body.dataset.theme = name;          // each tab has its own colour in style.css
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => activate(t.dataset.tab));
    t.addEventListener("keydown", e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      next.focus();
      activate(next.dataset.tab);
    });
  });

  // One keyboard listener for the whole page; it hands each key to the visible tab only
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const handler = keyHandlers[current()];
    if (handler) handler(e);
  });

  activate(current());
  return { activate, current, onKeys: (name, fn) => { keyHandlers[name] = fn; } };
})();

/* ============ Click ripple for every .key in any tab ============ */
document.addEventListener("pointerdown", e => {
  const key = e.target.closest(".key");
  if (!key) return;
  const rect = key.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const dot = document.createElement("span");
  dot.className = "ripple";
  dot.style.cssText = `width:${size / 4}px;height:${size / 4}px;left:${e.clientX - rect.left - size / 8}px;top:${e.clientY - rect.top - size / 8}px`;
  key.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove());
});

/* ============ Basic calculator ============ */
const BasicCalculator = (() => {
  const root = document.getElementById("tab-basic");
  const exprEl = root.querySelector("#basic-expression");
  const resultEl = root.querySelector("#basic-result");

  const OPS = ["+", "−", "×", "÷"];
  let expr = "";          // what the user has typed
  let justEvaluated = false;

  /* ---- Safe expression evaluator (no eval) ---- */
  function tokenize(s) {
    const tokens = [];
    const re = /\s*(\d+\.?\d*|\.\d+|[+−×÷()])/gy;
    let m, last = 0;
    while ((m = re.exec(s)) !== null) { tokens.push(m[1]); last = re.lastIndex; }
    if (last !== s.length) throw new Error("Invalid input");
    return tokens;
  }

  function evaluate(input) {
    // auto-close any open parentheses
    const open = (input.match(/\(/g) || []).length - (input.match(/\)/g) || []).length;
    const src = input + ")".repeat(Math.max(open, 0));
    const tokens = tokenize(src);
    let pos = 0;

    // Recursive-descent parser: expr → term → factor
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function parseExpr() {
      let v = parseTerm();
      while (peek() === "+" || peek() === "−") v = next() === "+" ? v + parseTerm() : v - parseTerm();
      return v;
    }
    function parseTerm() {
      let v = parseFactor();
      while (peek() === "×" || peek() === "÷") {
        if (next() === "×") v *= parseFactor();
        else {
          const d = parseFactor();
          if (d === 0) throw new Error("Cannot divide by zero");
          v /= d;
        }
      }
      return v;
    }
    function parseFactor() {
      const t = next();
      if (t === undefined) throw new Error("Incomplete expression");
      if (t === "−") return -parseFactor();
      if (t === "+") return parseFactor();
      if (t === "(") {
        const v = parseExpr();
        if (next() !== ")") throw new Error("Missing )");
        return v;
      }
      const n = parseFloat(t);
      if (Number.isNaN(n)) throw new Error("Invalid input");
      return n;
    }

    const value = parseExpr();
    if (pos < tokens.length) throw new Error("Invalid input");
    return value;
  }

  function format(n) {
    if (!Number.isFinite(n)) throw new Error("Result too large");
    // trim floating-point noise (0.1 + 0.2 → 0.3)
    let s = Number(n.toPrecision(12)).toString();
    if (s.includes("e")) return s.replace("e+", "×10^").replace("e-", "×10^-");
    return s.replace("-", "−");
  }

  /* ---- Rendering ---- */
  function render(preview) {
    exprEl.textContent = expr;
    if (preview !== undefined) resultEl.textContent = preview;
    resultEl.classList.remove("error");
  }

  function livePreview() {
    if (!expr) return "0";
    try { return format(evaluate(expr)); } catch { return resultEl.textContent; }
  }

  function showError(msg) {
    resultEl.textContent = msg;
    resultEl.classList.add("error");
    expr = "";
    justEvaluated = true;
  }

  /* ---- Input handlers ---- */
  const lastChar = () => expr.slice(-1);
  const lastNumber = () => (expr.match(/[\d.]+$/) || [""])[0];

  function inputDigit(d) {
    if (justEvaluated) { expr = ""; justEvaluated = false; }
    if (lastChar() === ")") expr += "×";          // (2+3)4 → (2+3)×4
    if (lastNumber() === "0" && d !== ".") expr = expr.slice(0, -1); // no leading zeros
    expr += d;
    render(livePreview());
  }

  function inputDot() {
    if (justEvaluated) { expr = ""; justEvaluated = false; }
    if (lastNumber().includes(".")) return;
    if (!/\d$/.test(expr)) expr += lastChar() === ")" ? "×0" : "0";
    expr += ".";
    render();
  }

  function inputOperator(op) {
    if (justEvaluated && resultEl.classList.contains("error")) return;
    if (justEvaluated) { expr = resultEl.textContent.includes("^") ? "" : resultEl.textContent; justEvaluated = false; }
    if (!expr) { if (op === "−") expr = "−"; render(); return; }   // allow leading minus
    if (expr === "−") return;
    if (lastChar() === "(") { if (op === "−") expr += "−"; render(); return; }
    if (OPS.includes(lastChar())) expr = expr.slice(0, -1);       // replace previous operator
    expr += op;
    render();
  }

  function inputParen() {
    if (justEvaluated) { expr = ""; justEvaluated = false; }
    const open = (expr.match(/\(/g) || []).length;
    const close = (expr.match(/\)/g) || []).length;
    const endsValue = /[\d.)]$/.test(expr);
    if (open > close && endsValue) expr += ")";
    else { if (endsValue) expr += "×"; expr += "("; }
    render(livePreview());
  }

  function negate() {
    if (justEvaluated) { expr = resultEl.textContent; justEvaluated = false; }
    const m = expr.match(/(−?)(\d+\.?\d*|\.\d+)$/);
    if (!m) return;
    const start = expr.length - m[0].length;
    const before = expr.slice(0, start);
    // only toggle the sign when it isn't a binary minus
    if (m[1] && (before === "" || /[+−×÷(]$/.test(before))) expr = before + m[2];
    else expr = before + "−" + m[2];
    render(livePreview());
  }

  function backspace() {
    if (justEvaluated) return clear();
    expr = expr.slice(0, -1);
    render(livePreview());
  }

  function clear() {
    expr = ""; justEvaluated = false;
    render("0");
  }

  function equals() {
    if (!expr) return;
    try {
      const shown = expr;
      const out = format(evaluate(expr));
      exprEl.textContent = shown + " =";
      resultEl.textContent = out;
      resultEl.classList.remove("error");
      resultEl.classList.remove("pop"); void resultEl.offsetWidth; resultEl.classList.add("pop");
      expr = out.includes("^") ? "" : out;
      justEvaluated = true;
    } catch (err) {
      exprEl.textContent = expr;
      showError(err.message);
    }
  }

  /* ---- Wire up buttons (scoped to this panel only) ---- */
  const actions = { clear, backspace, equals, paren: inputParen, negate };

  root.querySelector("#basic-keys").addEventListener("click", e => {
    const key = e.target.closest(".key");
    if (!key) return;
    if (key.dataset.action) return actions[key.dataset.action]();
    const v = key.dataset.value;
    if (v === ".") inputDot();
    else if (OPS.includes(v)) inputOperator(v);
    else inputDigit(v);
  });

  /* ---- Keyboard support (only while the Basic tab is visible) ---- */
  Tabs.onKeys("basic", e => {
    if (e.target.closest(".tab, .key") && (e.key === "Enter" || e.key === " ")) return; // let the focused button handle it
    const k = e.key;
    let handled = true;
    if (/^\d$/.test(k)) inputDigit(k);
    else if (k === ".") inputDot();
    else if (k === "+") inputOperator("+");
    else if (k === "-") inputOperator("−");
    else if (k === "*" || k === "x") inputOperator("×");
    else if (k === "/") inputOperator("÷");
    else if (k === "(" || k === ")") inputParen();
    else if (k === "Enter" || k === "=") equals();
    else if (k === "Backspace") backspace();
    else if (k === "Escape" || k === "c" || k === "C") clear();
    else handled = false;
    if (handled) e.preventDefault();
  });

  return { clear };
})();

/* ============ Scientific calculator ============ */
const ScientificCalculator = (() => {
  const root = document.getElementById("tab-scientific");
  const xEl = root.querySelector("#sci-x");
  const yEl = root.querySelector("#sci-y");
  const angleEl = root.querySelector("#sci-angle");
  const exprEl = root.querySelector("#sci-expression");
  const resultEl = root.querySelector("#sci-result");

  let lastResult = null;

  /* ---- helpers ---- */
  const isDeg = () => angleEl.value === "deg";
  const unitSym = () => (isDeg() ? "°" : " rad");
  const toRad = v => (isDeg() ? (v * Math.PI) / 180 : v);
  const fromRad = v => (isDeg() ? (v * 180) / Math.PI : v);

  // Remove floating-point noise: sin(180°) → 0, not 1.2e-16
  function clean(v) {
    if (Math.abs(v) < 1e-12) return 0;
    return Number(v.toPrecision(12));
  }

  function format(n) {
    let s;
    if (n !== 0 && (Math.abs(n) >= 1e15 || Math.abs(n) < 1e-9)) {
      s = n.toExponential(8).replace(/\.?0+e/, "e").replace("e+", "×10^").replace("e", "×10^");
    } else {
      s = String(n);
    }
    return s.replace(/^-/, "−");
  }

  const fmtIn = n => format(n); // show inputs the same way as results

  function readNumber(el, name) {
    if (el.value.trim() === "") throw new Error(`Enter a value for ${name}`);
    const n = Number(el.value);
    if (!Number.isFinite(n)) throw new Error(`${name} is not a valid number`);
    return n;
  }

  function factorial(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error("n! needs a whole number ≥ 0");
    if (n > 170) throw new Error("n! is too large (max n = 170)");
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  /* ---- each function returns { label, value } ---- */
  const FUNCTIONS = {
    square: x => ({ label: `${fmtIn(x)}²`, value: x * x }),
    sqrt: x => {
      if (x < 0) throw new Error("√x needs x ≥ 0");
      return { label: `√${fmtIn(x)}`, value: Math.sqrt(x) };
    },
    power: (x, _, y) => {
      const v = Math.pow(x, y);
      if (!Number.isFinite(v)) throw new Error("Result is undefined or too large");
      return { label: `${fmtIn(x)}^${fmtIn(y)}`, value: v };
    },
    abs: x => ({ label: `|${fmtIn(x)}|`, value: Math.abs(x) }),
    log: x => {
      if (x <= 0) throw new Error("log needs x > 0");
      return { label: `log(${fmtIn(x)})`, value: Math.log10(x) };
    },
    ln: x => {
      if (x <= 0) throw new Error("ln needs x > 0");
      return { label: `ln(${fmtIn(x)})`, value: Math.log(x) };
    },
    fact: x => ({ label: `${fmtIn(x)}!`, value: factorial(x) }),
    sin: x => ({ label: `sin(${fmtIn(x)}${unitSym()})`, value: Math.sin(toRad(x)) }),
    cos: x => ({ label: `cos(${fmtIn(x)}${unitSym()})`, value: Math.cos(toRad(x)) }),
    tan: x => {
      const r = toRad(x);
      if (Math.abs(Math.cos(r)) < 1e-12) throw new Error("tan is undefined here");
      return { label: `tan(${fmtIn(x)}${unitSym()})`, value: Math.tan(r) };
    },
    asin: x => {
      if (x < -1 || x > 1) throw new Error("sin⁻¹ needs −1 ≤ x ≤ 1");
      return { label: `sin⁻¹(${fmtIn(x)})`, value: fromRad(Math.asin(x)), unit: true };
    },
    acos: x => {
      if (x < -1 || x > 1) throw new Error("cos⁻¹ needs −1 ≤ x ≤ 1");
      return { label: `cos⁻¹(${fmtIn(x)})`, value: fromRad(Math.acos(x)), unit: true };
    },
    atan: x => ({ label: `tan⁻¹(${fmtIn(x)})`, value: fromRad(Math.atan(x)), unit: true }),
  };

  /* ---- display ---- */
  function showResult(label, value, unit) {
    const v = clean(value);
    lastResult = v;
    exprEl.textContent = `${label} =`;
    resultEl.textContent = format(v) + (unit ? unitSym() : "");
    resultEl.classList.remove("error");
    resultEl.classList.remove("pop"); void resultEl.offsetWidth; resultEl.classList.add("pop");
  }

  function showError(msg) {
    exprEl.textContent = "";
    resultEl.textContent = msg;
    resultEl.classList.add("error");
  }

  function reset() {
    xEl.value = ""; yEl.value = "";
    lastResult = null;
    exprEl.textContent = "";
    resultEl.textContent = "0";
    resultEl.classList.remove("error");
  }

  /* ---- button handling ---- */
  function run(name) {
    try {
      if (name === "clear") return reset();
      if (name === "pi") { xEl.value = String(Math.PI); return; }
      if (name === "ans") {
        if (lastResult === null) throw new Error("No result to reuse yet");
        xEl.value = String(lastResult);
        return;
      }
      const x = readNumber(xEl, "x");
      const y = name === "power" ? readNumber(yEl, "y") : undefined;
      const out = FUNCTIONS[name](x, undefined, y);
      showResult(out.label, out.value, out.unit);
    } catch (err) {
      showError(err.message);
    }
  }

  /* ---- number pad: types into whichever field (x or y) was used last ---- */
  let activeEl = xEl;
  const markActive = el => {
    activeEl = el;
    xEl.classList.toggle("active-field", el === xEl);
    yEl.classList.toggle("active-field", el === yEl);
  };
  [xEl, yEl].forEach(el => {
    el.addEventListener("focus", () => markActive(el));
    el.addEventListener("click", () => markActive(el));
    // keep only characters a number can contain (digits . - + e)
    el.addEventListener("input", () => { el.value = el.value.replace(/[^0-9.eE+\-]/g, ""); });
  });
  markActive(xEl);

  function pad(action) {
    const el = activeEl;
    let v = el.value;
    if (action === "back") v = v.slice(0, -1);
    else if (action === "neg") v = v.startsWith("-") ? v.slice(1) : "-" + v;
    else if (action === ".") {
      if (v.includes(".") || /e/i.test(v)) return;
      v += v === "" || v === "-" ? "0." : ".";
    } else v += action;
    el.value = v;
  }

  // pointerdown preventDefault keeps focus on the field (no keyboard flicker on phones)
  root.querySelector("#sci-pad").addEventListener("pointerdown", e => { if (e.target.closest(".key")) e.preventDefault(); });
  root.querySelector("#sci-pad").addEventListener("click", e => {
    const key = e.target.closest(".key");
    if (key && key.dataset.pad !== undefined) pad(key.dataset.pad);
  });

  root.querySelector("#sci-keys").addEventListener("click", e => {
    const key = e.target.closest(".key");
    if (key && key.dataset.fn) run(key.dataset.fn);
  });

  // Pressing Enter in the x field jumps to the y field
  xEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); yEl.focus(); markActive(yEl); } });

  // Laptop keyboard: with no field focused, digits go into the field last used (x or y)
  Tabs.onKeys("scientific", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    const k = e.key;
    if (/^\d$/.test(k) || k === ".") pad(k);
    else if (k === "-") pad("neg");
    else if (k === "Backspace") pad("back");
    else return;
    activeEl.focus();
    e.preventDefault();
  });

  return { reset };
})();

/* ============ Geometry calculator ============ */
const GeometryCalculator = (() => {
  const root = document.getElementById("tab-geometry");
  const titleEl = root.querySelector("#geo-title");
  const resultsEl = root.querySelector("#geo-results");
  const shapesEl = root.querySelector("#geo-shapes");
  const inputsEl = root.querySelector("#geo-inputs");
  const unitEl = root.querySelector("#geo-unit");
  const dimBtns = [...root.querySelectorAll("#geo-dim button")];

  const PI = Math.PI;
  const LEN = "len", AREA = "area", VOL = "vol";   // decides the unit suffix (cm, cm², cm³)

  /* Each shape: its input fields and a calc() that returns [label, value, kind] rows */
  const SHAPES = {
    "2d": [
      { id: "square", name: "Square", fields: [["a", "Side"]],
        calc: ({ a }) => [["Area", a * a, AREA], ["Perimeter", 4 * a, LEN]] },
      { id: "rectangle", name: "Rectangle", fields: [["l", "Length"], ["w", "Width"]],
        calc: ({ l, w }) => [["Area", l * w, AREA], ["Perimeter", 2 * (l + w), LEN]] },
      { id: "circle", name: "Circle", fields: [["r", "Radius"]],
        calc: ({ r }) => [["Area", PI * r * r, AREA], ["Circumference (perimeter)", 2 * PI * r, LEN]] },
      { id: "triangle", name: "Triangle", fields: [["a", "Side a"], ["b", "Side b"], ["c", "Side c"]],
        calc: ({ a, b, c }) => {
          if (a + b <= c || a + c <= b || b + c <= a)
            throw new Error("These sides can't form a triangle: each side must be shorter than the other two added together.");
          const s = (a + b + c) / 2;                                   // Heron's formula
          return [["Area", Math.sqrt(s * (s - a) * (s - b) * (s - c)), AREA], ["Perimeter", a + b + c, LEN]];
        } },
      { id: "parallelogram", name: "Parallelogram", fields: [["b", "Base (b)"], ["s", "Slant side (s)"], ["h", "Height (h)"]],
        calc: ({ b, s, h }) => {
          if (h > s) throw new Error("The height can't be longer than the slant side.");
          return [["Area", b * h, AREA], ["Perimeter", 2 * (b + s), LEN]];
        } },
      { id: "trapezoid", name: "Trapezoid", fields: [["a", "Top (a)"], ["b", "Bottom (b)"], ["c", "Left leg (c)"], ["d", "Right leg (d)"], ["h", "Height (h)"]],
        calc: ({ a, b, c, d, h }) => {
          if (h > c || h > d) throw new Error("The height can't be longer than a leg.");
          return [["Area", ((a + b) / 2) * h, AREA], ["Perimeter", a + b + c + d, LEN]];
        } },
    ],
    "3d": [
      { id: "cube", name: "Cube", fields: [["a", "Edge"]],
        calc: ({ a }) => [["Volume", a ** 3, VOL], ["Surface area", 6 * a * a, AREA]] },
      { id: "cuboid", name: "Cuboid", fields: [["l", "Length"], ["w", "Width"], ["h", "Height"]],
        calc: ({ l, w, h }) => [["Volume", l * w * h, VOL], ["Surface area", 2 * (l * w + l * h + w * h), AREA]] },
      { id: "sphere", name: "Sphere", fields: [["r", "Radius"]],
        calc: ({ r }) => [["Volume", (4 / 3) * PI * r ** 3, VOL], ["Surface area", 4 * PI * r * r, AREA]] },
      { id: "cylinder", name: "Cylinder", fields: [["r", "Radius"], ["h", "Height"]],
        calc: ({ r, h }) => [["Volume", PI * r * r * h, VOL], ["Surface area", 2 * PI * r * (r + h), AREA]] },
      { id: "cone", name: "Cone", fields: [["r", "Radius"], ["h", "Height"]],
        calc: ({ r, h }) => {
          const l = Math.sqrt(r * r + h * h);                          // slant height
          return [["Volume", (PI * r * r * h) / 3, VOL], ["Surface area", PI * r * (r + l), AREA], ["Slant height", l, LEN]];
        } },
      { id: "pyramid", name: "Square pyramid", fields: [["b", "Base side"], ["h", "Height"]],
        calc: ({ b, h }) => {
          const s = Math.sqrt(h * h + (b / 2) ** 2);                   // slant height of a face
          return [["Volume", (b * b * h) / 3, VOL], ["Surface area", b * b + 2 * b * s, AREA], ["Slant height", s, LEN]];
        } },
    ],
  };

  let dim = "2d";
  let shape = SHAPES["2d"][0];

  const inputs = () => [...inputsEl.querySelectorAll("input")];

  // the box the number pad types into (the one you clicked last)
  let activeInput = null;
  function markActive(el) {
    activeInput = el;
    inputs().forEach(i => i.classList.toggle("active-field", i === el));
  }
  const padTarget = () => (inputs().includes(activeInput) ? activeInput : inputs()[0]);

  const showHint = () => Util.note(resultsEl, "Enter the measurements below, then press Calculate.", "list-hint");

  function showResults(rows) {
    const unit = unitEl.value === "none" ? "" : unitEl.value;
    Util.rows(resultsEl, rows.map(([label, value, kind]) => {
      const suffix = unit ? ` ${unit}${kind === AREA ? "²" : kind === VOL ? "³" : ""}` : "";
      return [label, Util.format(value) + suffix];
    }));
  }

  function renderShapes() {
    shapesEl.replaceChildren(...SHAPES[dim].map(s => {
      const b = document.createElement("button");
      b.className = "key chip" + (s.id === shape.id ? " selected" : "");
      b.dataset.shape = s.id;
      b.textContent = s.name;
      return b;
    }));
  }

  function renderInputs() {
    inputsEl.replaceChildren(...shape.fields.map(([key, label]) => {
      const wrap = document.createElement("label");
      wrap.className = "field";
      const span = document.createElement("span");
      span.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.placeholder = "0";
      input.dataset.key = key;
      wrap.append(span, input);
      return wrap;
    }));
    markActive(inputs()[0]);
  }

  function selectShape(id) {
    shape = SHAPES[dim].find(s => s.id === id);
    titleEl.textContent = shape.name;
    renderShapes();
    renderInputs();
    showHint();
  }

  function setDim(d) {
    dim = d;
    dimBtns.forEach(b => {
      const on = b.dataset.dim === d;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on);
    });
    selectShape(SHAPES[d][0].id);
  }

  function calculate() {
    try {
      const values = {};
      for (const [key, label] of shape.fields) {
        const el = inputsEl.querySelector(`[data-key="${key}"]`);
        const raw = el.value.trim();
        if (raw === "") throw new Error(`Enter a value for ${label}.`);
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error(`${label} is not a valid number.`);
        if (n <= 0) throw new Error("Every measurement must be greater than 0.");
        values[key] = n;
      }
      const rows = shape.calc(values);
      if (rows.some(r => !Number.isFinite(r[1]))) throw new Error("The result is too large to show.");
      showResults(rows);
    } catch (err) {
      Util.note(resultsEl, err.message, "list-error");
    }
  }

  function clearAll() {
    inputs().forEach(i => { i.value = ""; });
    showHint();
  }

  dimBtns.forEach(b => b.addEventListener("click", () => setDim(b.dataset.dim)));

  shapesEl.addEventListener("click", e => {
    const chip = e.target.closest("[data-shape]");
    if (chip) selectShape(chip.dataset.shape);
  });

  inputsEl.addEventListener("input", e => {
    // positive numbers only: digits and one decimal point
    let v = e.target.value.replace(/[^0-9.]/g, "");
    const dot = v.indexOf(".");
    if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
    e.target.value = v;
  });
  inputsEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); calculate(); } });

  inputsEl.addEventListener("focusin", e => { if (e.target.matches("input")) markActive(e.target); });
  Util.wirePad(root.querySelector("#geo-pad"), padTarget);

  root.querySelector("#geo-calc").addEventListener("click", calculate);
  root.querySelector("#geo-clear").addEventListener("click", clearAll);
  unitEl.addEventListener("change", () => { if (resultsEl.querySelector(".list-row")) calculate(); });

  // Laptop keyboard: with no field focused, digits go into the box the pad is using
  Tabs.onKeys("geometry", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    if (!/^[\d.]$/.test(e.key) && e.key !== "Backspace") return;
    if (e.key === "Backspace") Util.backspace(padTarget());
    else Util.insert(padTarget(), e.key);
    e.preventDefault();
  });

  setDim("2d");
  return { calculate };
})();

/* ============ Statistics calculator ============ */
const StatisticsCalculator = (() => {
  const root = document.getElementById("tab-statistics");
  const titleEl = root.querySelector("#stat-title");
  const resultsEl = root.querySelector("#stat-results");
  const inputEl = root.querySelector("#stat-input");
  const typeEl = root.querySelector("#stat-type");

  const showHint = () => {
    titleEl.textContent = "Data set";
    Util.note(resultsEl, "Type your numbers below (for example 4, 8, 15, 16, 23, 42), then press Calculate or Enter.", "list-hint");
  };

  function parse(text) {
    const tokens = text.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length === 0) throw new Error("Enter some numbers first, for example 4, 8, 15, 16, 23, 42.");
    return tokens.map(t => {
      const n = Number(t);
      if (!Number.isFinite(n)) throw new Error(`"${t}" is not a valid number.`);
      return n;
    });
  }

  function describe(values, population) {
    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const mid = Math.floor(n / 2);
    const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    const counts = new Map();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const top = Math.max(...counts.values());
    const modes = top === 1 ? [] : [...counts].filter(([, c]) => c === top).map(([v]) => v).sort((a, b) => a - b);

    const ss = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    const divisor = population ? n : n - 1;
    const variance = divisor > 0 ? ss / divisor : null;

    const med = arr => { const m = Math.floor(arr.length / 2); return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2; };
    const q1 = n > 1 ? med(sorted.slice(0, Math.floor(n / 2))) : sorted[0];
    const q3 = n > 1 ? med(sorted.slice(Math.ceil(n / 2))) : sorted[0];
    const geo = values.every(v => v > 0) ? Math.exp(values.reduce((t, v) => t + Math.log(v), 0) / n) : null;
    return { n, sum, mean, median, modes, min: sorted[0], max: sorted[n - 1], variance, q1, q3, geo };
  }

  function calculate() {
    try {
      const values = parse(inputEl.value);
      const population = typeEl.value === "population";
      const s = describe(values, population);
      const na = "needs 2+ numbers";
      titleEl.textContent = `${s.n} ${s.n === 1 ? "number" : "numbers"} · ${population ? "population" : "sample"}`;
      Util.rows(resultsEl, [
        ["Count", String(s.n)],
        ["Sum", Util.format(s.sum)],
        ["Mean", Util.format(s.mean)],
        ["Median", Util.format(s.median)],
        ["Mode", s.modes.length ? s.modes.map(Util.format).join(", ") : "No repeats"],
        ["Minimum", Util.format(s.min)],
        ["Maximum", Util.format(s.max)],
        ["Range", Util.format(s.max - s.min)],
        ["Variance", s.variance === null ? na : Util.format(s.variance)],
        ["Std deviation", s.variance === null ? na : Util.format(Math.sqrt(s.variance))],
        ["Q1", Util.format(s.q1)], ["Q3", Util.format(s.q3)], ["IQR", Util.format(s.q3 - s.q1)],
        ["Geometric mean", s.geo === null ? "needs values > 0" : Util.format(s.geo)],
      ]);
    } catch (err) {
      titleEl.textContent = "Data set";
      Util.note(resultsEl, err.message, "list-error");
    }
  }

  function clearAll() {
    inputEl.value = "";
    showHint();
    inputEl.focus();
  }

  // keep only characters a list of numbers can contain
  inputEl.addEventListener("input", () => { inputEl.value = inputEl.value.replace(/[^0-9.,;\s\-]/g, ""); });
  inputEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); calculate(); } });
  typeEl.addEventListener("change", () => { if (resultsEl.querySelector(".list-row")) calculate(); });
  Util.wirePad(root.querySelector("#stat-pad"), () => inputEl);
  root.querySelector("#stat-calc").addEventListener("click", calculate);
  root.querySelector("#stat-clear").addEventListener("click", clearAll);

  // Laptop keyboard: with nothing focused, typing numbers goes straight into the box
  Tabs.onKeys("statistics", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    if (/^[\d.,\-]$/.test(e.key)) Util.insert(inputEl, e.key);
    else if (e.key === " " && e.target === document.body) Util.insert(inputEl, " ");
    else if (e.key === "Backspace") Util.backspace(inputEl);
    else return;
    e.preventDefault();
  });

  showHint();
  return { calculate };
})();

/* ============ Unit converter ============ */
const ConverterCalculator = (() => {
  const root = document.getElementById("tab-converter");
  const exprEl = root.querySelector("#conv-expression");
  const resultEl = root.querySelector("#conv-result");
  const catsEl = root.querySelector("#conv-cats");
  const valueEl = root.querySelector("#conv-value");
  const fromEl = root.querySelector("#conv-from");
  const toEl = root.querySelector("#conv-to");

  /* units: [symbol, label, factor to the base unit]. Temperature is handled separately. */
  const CATEGORIES = [
    { id: "length", name: "Length", def: ["m", "ft"], units: [
      ["mm", "Millimetre", 0.001], ["cm", "Centimetre", 0.01], ["m", "Metre", 1], ["km", "Kilometre", 1000],
      ["in", "Inch", 0.0254], ["ft", "Foot", 0.3048], ["yd", "Yard", 0.9144], ["mi", "Mile", 1609.344]] },
    { id: "weight", name: "Weight", def: ["kg", "lb"], units: [
      ["mg", "Milligram", 1e-6], ["g", "Gram", 0.001], ["kg", "Kilogram", 1], ["t", "Tonne", 1000],
      ["oz", "Ounce", 0.028349523125], ["lb", "Pound", 0.45359237], ["st", "Stone", 6.35029318]] },
    { id: "temperature", name: "Temperature", def: ["°C", "°F"], temp: true, units: [
      ["°C", "Celsius"], ["°F", "Fahrenheit"], ["K", "Kelvin"]] },
    { id: "area", name: "Area", def: ["m²", "ft²"], units: [
      ["mm²", "Square millimetre", 1e-6], ["cm²", "Square centimetre", 1e-4], ["m²", "Square metre", 1], ["ha", "Hectare", 1e4],
      ["km²", "Square kilometre", 1e6], ["in²", "Square inch", 0.00064516], ["ft²", "Square foot", 0.09290304], ["ac", "Acre", 4046.8564224]] },
    { id: "volume", name: "Volume", def: ["L", "gal"], units: [
      ["mL", "Millilitre", 0.001], ["L", "Litre", 1], ["m³", "Cubic metre", 1000], ["tsp", "Teaspoon (US)", 0.00492892159375],
      ["tbsp", "Tablespoon (US)", 0.01478676478125], ["fl oz", "Fluid ounce (US)", 0.0295735295625], ["cup", "Cup (US)", 0.2365882365], ["gal", "Gallon (US)", 3.785411784]] },
    { id: "speed", name: "Speed", def: ["km/h", "mph"], units: [
      ["m/s", "Metre / second", 1], ["km/h", "Kilometre / hour", 1 / 3.6], ["mph", "Mile / hour", 0.44704],
      ["kn", "Knot", 1852 / 3600], ["ft/s", "Foot / second", 0.3048]] },
    { id: "time", name: "Time", def: ["h", "min"], units: [
      ["ms", "Millisecond", 0.001], ["s", "Second", 1], ["min", "Minute", 60], ["h", "Hour", 3600],
      ["day", "Day", 86400], ["week", "Week", 604800], ["year", "Year (365.25 days)", 31557600]] },
  ];

  let cat = CATEGORIES[0];

  /* ---- temperature goes through Celsius ---- */
  const toCelsius = (v, u) => (u === "°C" ? v : u === "°F" ? ((v - 32) * 5) / 9 : v - 273.15);
  const fromCelsius = (c, u) => (u === "°C" ? c : u === "°F" ? (c * 9) / 5 + 32 : c + 273.15);

  function convert(value, from, to) {
    if (cat.temp) {
      const c = toCelsius(value, from);
      if (c < -273.15 - 1e-9) throw new Error("That is below absolute zero.");
      return fromCelsius(c, to);
    }
    const factor = sym => cat.units.find(u => u[0] === sym)[2];
    return (value * factor(from)) / factor(to);
  }

  /* ---- UI ---- */
  function fillSelect(select, selected) {
    select.replaceChildren(...cat.units.map(([sym, label]) => {
      const o = document.createElement("option");
      o.value = sym;
      o.textContent = `${label} (${sym})`;
      return o;
    }));
    select.value = selected;
  }

  function renderCategories() {
    catsEl.replaceChildren(...CATEGORIES.map(c => {
      const b = document.createElement("button");
      b.className = "key chip" + (c.id === cat.id ? " selected" : "");
      b.dataset.cat = c.id;
      b.textContent = c.name;
      return b;
    }));
  }

  function update() {
    resultEl.classList.remove("error");
    const raw = valueEl.value.trim();
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
      exprEl.textContent = "Type a value to convert";
      resultEl.textContent = "0";
      return;
    }
    try {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("Not a valid number");
      const out = convert(value, fromEl.value, toEl.value);
      exprEl.textContent = `${Util.format(value)} ${fromEl.value} =`;
      resultEl.textContent = `${Util.format(out)} ${toEl.value}`;
    } catch (err) {
      exprEl.textContent = "";
      resultEl.textContent = err.message;
      resultEl.classList.add("error");
    }
  }

  function selectCategory(id) {
    cat = CATEGORIES.find(c => c.id === id);
    renderCategories();
    fillSelect(fromEl, cat.def[0]);
    fillSelect(toEl, cat.def[1]);
    update();
  }

  catsEl.addEventListener("click", e => {
    const chip = e.target.closest("[data-cat]");
    if (chip) selectCategory(chip.dataset.cat);
  });

  valueEl.addEventListener("input", () => {
    // digits, one decimal point, and a minus sign only at the start
    let v = valueEl.value.replace(/[^0-9.\-]/g, "");
    const neg = v.startsWith("-");
    v = v.replace(/-/g, "");
    const dot = v.indexOf(".");
    if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
    valueEl.value = (neg ? "-" : "") + v;
    update();
  });
  Util.wirePad(root.querySelector("#conv-pad"), () => valueEl);
  fromEl.addEventListener("change", update);
  toEl.addEventListener("change", update);

  root.querySelector("#conv-swap").addEventListener("click", () => {
    const a = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = a;
    update();
  });

  // Laptop keyboard: with nothing focused, digits go straight into the value box
  Tabs.onKeys("converter", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    if (/^[\d.\-]$/.test(e.key)) Util.insert(valueEl, e.key);
    else if (e.key === "Backspace") Util.backspace(valueEl);
    else return;
    e.preventDefault();
  });

  selectCategory("length");
  return { update };
})();

/* ============ Matrix calculator ============ */
const MatrixCalculator = (() => {
  const root = document.getElementById("tab-matrix");
  const titleEl = root.querySelector("#mx-title");
  const resultEl = root.querySelector("#mx-result");
  const useEl = root.querySelector("#mx-use");
  const paramEl = root.querySelector("#mx-param");
  const formatEl = root.querySelector("#mx-format");
  const opsEl = root.querySelector("#mx-ops");
  const targetBtns = [...root.querySelectorAll("#mx-target button")];
  const cards = { A: root.querySelector('[data-mx="A"]'), B: root.querySelector('[data-mx="B"]') };

  const MAX = 10;                 // biggest matrix the editor allows (10 × 10)
  const EPS = 1e-10;

  /* ================= matrix maths (plain functions on arrays of numbers) ================= */
  const clean = v => (Math.abs(v) < EPS ? 0 : Number(v.toPrecision(12)));
  const cleanM = M => M.map(r => r.map(clean));
  const dims = M => `${M.length}×${M[0].length}`;
  const identity = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const scaleOf = M => Math.max(1, ...M.flat().map(Math.abs));
  const finiteM = M => {
    if (!M.flat().every(Number.isFinite)) throw new Error("The numbers got too large to show.");
    return M;
  };
  function needSquare(M, what) {
    if (M.length !== M[0].length) throw new Error(`${what} needs a square matrix, but this one is ${dims(M)}.`);
  }

  function addSub(A, B, sign) {
    if (A.length !== B.length || A[0].length !== B[0].length)
      throw new Error(`A is ${dims(A)} but B is ${dims(B)}. For + and − both matrices must be the same size.`);
    return A.map((row, i) => row.map((v, j) => v + sign * B[i][j]));
  }

  function multiply(A, B, nameA = "A", nameB = "B") {
    if (A[0].length !== B.length)
      throw new Error(`${nameA} is ${dims(A)} and ${nameB} is ${dims(B)}. To multiply, the columns of ${nameA} (${A[0].length}) must equal the rows of ${nameB} (${B.length}).`);
    return A.map((_, i) => B[0].map((__, j) => A[i].reduce((sum, v, k) => sum + v * B[k][j], 0)));
  }

  const transpose = A => A[0].map((_, j) => A.map(row => row[j]));

  function det(A) {                       // Gaussian elimination with partial pivoting
    const n = A.length;
    const M = A.map(r => [...r]);
    const tol = 1e-12 * scaleOf(A);
    let d = 1;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) <= tol) return 0;
      if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; d = -d; }
      d *= M[c][c];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return d;
  }

  function rref(A) {                      // reduced row echelon form + rank
    const M = A.map(r => [...r]);
    const rows = M.length, cols = M[0].length;
    const tol = EPS * scaleOf(A);
    let r = 0;
    for (let c = 0; c < cols && r < rows; c++) {
      let p = r;
      for (let i = r + 1; i < rows; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
      if (Math.abs(M[p][c]) <= tol) continue;
      [M[p], M[r]] = [M[r], M[p]];
      const pivot = M[r][c];
      M[r] = M[r].map(v => v / pivot);
      for (let i = 0; i < rows; i++) {
        if (i === r) continue;
        const f = M[i][c];
        if (f !== 0) M[i] = M[i].map((v, k) => v - f * M[r][k]);
      }
      r++;
    }
    return { matrix: cleanM(M), rank: r };
  }

  function inverse(A) {                   // Gauss-Jordan on [A | I]
    needSquare(A, "The inverse");
    const n = A.length;
    const I = identity(n);
    const M = A.map((row, i) => [...row, ...I[i]]);
    const tol = 1e-12 * scaleOf(A);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) <= tol) throw new Error("This matrix is singular (its determinant is 0), so it has no inverse.");
      [M[p], M[c]] = [M[c], M[p]];
      const pivot = M[c][c];
      M[c] = M[c].map(v => v / pivot);
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f !== 0) M[r] = M[r].map((v, k) => v - f * M[c][k]);
      }
    }
    return cleanM(M.map(row => row.slice(n)));
  }

  const minor = (A, i, j) => A.filter((_, r) => r !== i).map(row => row.filter((_, c) => c !== j));

  function cofactor(A) {
    needSquare(A, "The cofactor matrix");
    if (A.length === 1) return [[1]];
    return cleanM(A.map((row, i) => row.map((_, j) => ((i + j) % 2 ? -1 : 1) * det(minor(A, i, j)))));
  }

  function power(A, n) {
    needSquare(A, "A matrix power");
    if (!Number.isInteger(n)) throw new Error("The power n must be a whole number (for example 2, 3 or −1).");
    if (Math.abs(n) > 64) throw new Error("Use a power between −64 and 64.");
    let base = n < 0 ? inverse(A) : A.map(r => [...r]);
    let e = Math.abs(n);
    let result = identity(A.length);
    while (e > 0) {
      if (e & 1) result = multiply(result, base);
      base = multiply(base, base);
      e >>= 1;
    }
    return cleanM(finiteM(result));
  }

  /* ================= number formatting ================= */
  function toFraction(x) {                // 0.75 → "3/4" (continued fractions); falls back to a decimal
    if (Number.isInteger(x)) return String(x);
    const a = Math.abs(x);
    let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = a;
    for (let i = 0; i < 24; i++) {
      const ai = Math.floor(b);
      [h0, h1] = [h1, ai * h1 + h0];
      [k0, k1] = [k1, ai * k1 + k0];
      if (k1 > 5000) return String(Number(x.toPrecision(6)));
      if (Math.abs(a - h1 / k1) < 1e-9 * Math.max(1, a)) return `${x < 0 ? "-" : ""}${h1}/${k1}`;
      if (b - ai < 1e-12) break;
      b = 1 / (b - ai);
    }
    return String(Number(x.toPrecision(6)));
  }

  const showNum = v => {
    const z = clean(v);
    const s = formatEl.value === "fraction" ? toFraction(z) : String(Number.isInteger(z) ? z : Number(z.toPrecision(6)));
    return s.replace("-", "−");
  };
  const inputNum = v => {                 // text put back into an editor cell
    const z = clean(v);
    return formatEl.value === "fraction" ? toFraction(z) : String(Number(z.toPrecision(10)));
  };

  /* ================= editors (A and B) ================= */
  const makeState = (rows, cols) => ({ rows, cols, data: Array.from({ length: rows }, () => Array(cols).fill("")) });
  const state = { A: makeState(2, 2), B: makeState(2, 2) };
  let activeEl = null;

  const gridOf = name => cards[name].querySelector("[data-grid]");
  const cellsOf = name => [...gridOf(name).querySelectorAll(".mx-cell")];

  function renderGrid(name) {
    const s = state[name];
    const grid = gridOf(name);
    grid.style.setProperty("--cols", s.cols);
    const cells = [];
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.className = "mx-cell";
        input.placeholder = "0";
        input.value = s.data[r][c];
        input.dataset.mat = name;
        input.dataset.r = r;
        input.dataset.c = c;
        input.setAttribute("aria-label", `${name} row ${r + 1} column ${c + 1}`);
        cells.push(input);
      }
    }
    grid.replaceChildren(...cells);
    cards[name].querySelector('[data-out="rows"]').textContent = s.rows;
    cards[name].querySelector('[data-out="cols"]').textContent = s.cols;
  }

  function resize(name, rows, cols) {
    const s = state[name];
    rows = Math.min(MAX, Math.max(1, rows));
    cols = Math.min(MAX, Math.max(1, cols));
    const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (s.data[r] && s.data[r][c]) || ""));
    state[name] = { rows, cols, data };
    renderGrid(name);
  }

  function setMatrix(name, M, asText) {
    state[name] = { rows: M.length, cols: M[0].length, data: M.map(row => row.map(asText)) };
    renderGrid(name);
  }

  const getActive = () => (activeEl && activeEl.isConnected ? activeEl : cellsOf("A")[0]);

  function setActive(el) {
    if (activeEl && activeEl !== el) activeEl.classList.remove("active-field");
    activeEl = el;
    el.classList.add("active-field");
  }

  // move to a cell: step through the matrix in reading order, or jump up / down a row
  function stepCell(el, delta) {
    if (!el.classList.contains("mx-cell")) return;
    const name = el.dataset.mat, s = state[name];
    const cells = cellsOf(name);
    const r = Number(el.dataset.r), c = Number(el.dataset.c);
    let index = r * s.cols + c + delta;
    if (delta === s.cols || delta === -s.cols) {
      const nr = r + Math.sign(delta);
      if (nr < 0 || nr >= s.rows) return;
      index = nr * s.cols + c;
    } else {
      index = (index + cells.length) % cells.length;
    }
    cells[index].focus();
    cells[index].select();
  }

  function syncCell(el) {
    if (el.classList.contains("mx-cell")) state[el.dataset.mat].data[el.dataset.r][el.dataset.c] = el.value;
  }

  // one keypress / one pad key applied to the active cell (or the k / n box)
  function padKey(action) {
    const el = getActive();
    if (action === "left") return stepCell(el, -1);
    if (action === "right") return stepCell(el, 1);
    let v = el.value;
    const part = v.includes("/") ? v.slice(v.indexOf("/") + 1) : v;   // the number being typed (top or bottom of a fraction)
    if (action === "back") v = v.slice(0, -1);
    else if (action === "neg") v = v.startsWith("-") ? v.slice(1) : "-" + v;
    else if (action === ".") { if (part.includes(".")) return; v += part === "" || part === "-" ? "0." : "."; }
    else if (action === "/") { if (v === "" || v === "-" || v.includes("/") || v.endsWith(".")) return; v += "/"; }
    else v += action;                                                  // a digit
    el.value = v;
    syncCell(el);
  }

  /* ---- editor events ---- */
  const editors = root.querySelector(".mx-editors");

  editors.addEventListener("input", e => {
    if (!e.target.matches(".mx-cell")) return;
    e.target.value = e.target.value.replace(/[^0-9.\-\/]/g, "");       // digits . - and / (for fractions like 1/2)
    syncCell(e.target);
  });
  editors.addEventListener("focusin", e => { if (e.target.matches(".mx-cell")) setActive(e.target); });
  editors.addEventListener("keydown", e => {
    if (!e.target.matches(".mx-cell")) return;
    if (e.key === "Enter") { e.preventDefault(); stepCell(e.target, 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); stepCell(e.target, state[e.target.dataset.mat].cols); }
    else if (e.key === "ArrowUp") { e.preventDefault(); stepCell(e.target, -state[e.target.dataset.mat].cols); }
  });

  editors.addEventListener("click", e => {
    const step = e.target.closest("[data-step]");
    const tool = e.target.closest("[data-tool]");
    const name = e.target.closest("[data-mx]")?.dataset.mx;
    if (!name) return;
    const s = state[name];
    if (step) {
      const d = step.dataset.step;
      resize(name, s.rows + (d === "rows+") - (d === "rows-"), s.cols + (d === "cols+") - (d === "cols-"));
    } else if (tool && tool.dataset.tool === "clear") {
      state[name] = makeState(s.rows, s.cols);
      renderGrid(name);
    } else if (tool && tool.dataset.tool === "identity") {
      state[name].data = state[name].data.map((row, i) => row.map((_, j) => (i === j ? "1" : "0")));
      renderGrid(name);
    }
  });

  paramEl.addEventListener("focus", () => setActive(paramEl));
  paramEl.addEventListener("input", () => { paramEl.value = paramEl.value.replace(/[^0-9.\-\/]/g, ""); });

  const pad = root.querySelector("#mx-pad");
  pad.addEventListener("pointerdown", e => { if (e.target.closest(".key")) e.preventDefault(); });   // keep focus in the field
  pad.addEventListener("click", e => {
    const key = e.target.closest(".key");
    if (key) padKey(key.dataset.pad);
  });

  /* ================= reading the numbers ================= */
  function parseNumber(text, where) {
    const t = text.trim();
    if (t === "") return 0;                                            // an empty cell counts as 0
    let value;
    if (t.includes("/")) {
      const [top, bottom] = t.split("/");
      if (top === "" || bottom === "" || Number.isNaN(Number(top)) || Number.isNaN(Number(bottom))) throw new Error(`${where} is not a valid fraction.`);
      if (Number(bottom) === 0) throw new Error(`${where} divides by zero.`);
      value = Number(top) / Number(bottom);
    } else {
      value = Number(t);
    }
    if (!Number.isFinite(value)) throw new Error(`${where} is not a valid number.`);
    return value;
  }

  const readMatrix = name => state[name].data.map((row, r) =>
    row.map((text, c) => parseNumber(text, `Cell ${name}(${r + 1},${c + 1})`)));

  const readParam = label => {
    if (paramEl.value.trim() === "") throw new Error(`Type a value for ${label} in the “k or n value” box first.`);
    return parseNumber(paramEl.value, `The ${label} value`);
  };

  /* ================= operations ================= */
  let target = "A";
  const T = () => target;

  // kind 2 = uses A and B; kind 1 = uses the matrix picked by "On A / On B"
  const OPS = [
    { label: "A + B", kind: 2, run: (A, B) => ({ title: "A + B", matrix: addSub(A, B, 1) }) },
    { label: "A − B", kind: 2, run: (A, B) => ({ title: "A − B", matrix: addSub(A, B, -1) }) },
    { label: "A × B", kind: 2, run: (A, B) => ({ title: "A × B", matrix: multiply(A, B, "A", "B") }) },
    { label: "B × A", kind: 2, run: (A, B) => ({ title: "B × A", matrix: multiply(B, A, "B", "A") }) },
    { label: "Transpose", kind: 1, run: M => ({ title: `${T()}ᵀ`, matrix: transpose(M) }) },
    { label: "Determinant", kind: 1, run: M => { needSquare(M, "The determinant"); return { title: `det(${T()})`, value: det(M) }; } },
    { label: "Inverse", kind: 1, run: M => ({ title: `${T()}⁻¹`, matrix: inverse(M) }) },
    { label: "Rank", kind: 1, run: M => ({ title: `rank(${T()})`, value: rref(M).rank, integer: true }) },
    { label: "Trace", kind: 1, run: M => { needSquare(M, "The trace"); return { title: `trace(${T()})`, value: M.reduce((s, r, i) => s + r[i], 0) }; } },
    { label: "RREF", kind: 1, run: M => ({ title: `RREF(${T()})`, matrix: rref(M).matrix }) },
    { label: "Adjugate", kind: 1, run: M => ({ title: `adj(${T()})`, matrix: transpose(cofactor(M)) }) },
    { label: "Cofactors", kind: 1, run: M => ({ title: `cofactors of ${T()}`, matrix: cofactor(M) }) },
    { label: "k × M", kind: 1, run: M => { const k = readParam("k"); return { title: `k × ${T()}  (k = ${showNum(k)})`, matrix: M.map(r => r.map(v => v * k)) }; } },
    { label: "Mⁿ (power)", kind: 1, run: M => { const n = readParam("n"); return { title: `${T()}^${showNum(n)}`, matrix: power(M, n) }; } },
  ];

  /* ================= showing results ================= */
  let lastMatrix = null;

  function showMatrix(title, M) {
    lastMatrix = M;
    titleEl.textContent = `${title} · ${dims(M)}`;
    const grid = document.createElement("div");
    grid.className = "mx-out";
    grid.style.setProperty("--cols", M[0].length);
    M.forEach(row => row.forEach(v => {
      const cell = document.createElement("span");
      cell.textContent = showNum(v);
      grid.append(cell);
    }));
    resultEl.replaceChildren(grid);
    useEl.hidden = false;
  }

  function showScalar(title, value, integer) {
    lastMatrix = null;
    titleEl.textContent = title;
    const big = document.createElement("div");
    big.className = "mx-scalar";
    const z = clean(value);
    big.textContent = integer ? String(z) : formatEl.value === "fraction" ? toFraction(z).replace("-", "−") : Util.format(z);
    resultEl.replaceChildren(big);
    useEl.hidden = true;
  }

  function showMessage(text, cls) {
    lastMatrix = null;
    titleEl.textContent = "Result";
    useEl.hidden = true;
    Util.note(resultEl, text, cls);
  }

  function run(op) {
    try {
      const out = op.kind === 2 ? op.run(readMatrix("A"), readMatrix("B")) : op.run(readMatrix(target));
      if (out.matrix) showMatrix(out.title, cleanM(finiteM(out.matrix)));
      else {
        if (!Number.isFinite(out.value)) throw new Error("The number got too large to show.");
        showScalar(out.title, out.value, out.integer);
      }
    } catch (err) {
      showMessage(err.message, "list-error");
    }
  }

  /* ================= wiring ================= */
  opsEl.replaceChildren(...OPS.map(op => {
    const b = document.createElement("button");
    b.className = "key chip" + (op.kind === 2 ? " op" : "");
    b.textContent = op.label;
    b.addEventListener("click", () => run(op));
    return b;
  }));

  targetBtns.forEach(b => b.addEventListener("click", () => {
    target = b.dataset.target;
    targetBtns.forEach(x => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", on); });
  }));

  root.querySelector("#mx-use-a").addEventListener("click", () => { if (lastMatrix) setMatrix("A", lastMatrix, inputNum); });
  root.querySelector("#mx-use-b").addEventListener("click", () => { if (lastMatrix) setMatrix("B", lastMatrix, inputNum); });
  formatEl.addEventListener("change", () => { /* results re-render the next time an operation runs */ });

  // Laptop keyboard: with no field focused, typing goes into the cell the pad is using
  Tabs.onKeys("matrix", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    const k = e.key;
    if (/^\d$/.test(k) || k === "." || k === "/") padKey(k);
    else if (k === "-") padKey("neg");
    else if (k === "Backspace") padKey("back");
    else if (k === "Enter") padKey("right");
    else return;
    getActive().focus();
    e.preventDefault();
  });

  renderGrid("A");
  renderGrid("B");
  setActive(cellsOf("A")[0]);
  showMessage("Fill in your matrices, then choose an operation. Use + / − to change the size (up to 10 × 10).", "list-hint");
  return { run };
})();

/* ============ More: everyday maths, finance, probability ============ */
const MoreTools = (() => {
  const root = document.getElementById("tab-tools");
  const titleEl = root.querySelector("#tl-title"), resultsEl = root.querySelector("#tl-results");
  const listEl = root.querySelector("#tl-list"), inputsEl = root.querySelector("#tl-inputs");

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const whole = (v, name) => { if (!Number.isInteger(v) || v < 0) throw new Error(`${name} must be a whole number ≥ 0.`); return v; };
  const erf = x => {                      // Abramowitz–Stegun approximation (error < 1.5e-7)
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x < 0 ? -y : y;
  };
  const F = Util.format;
  const pct = v => F(v) + " %";

  const TOOLS = [
    { id: "pct", name: "Percentage", fields: [["p", "Percent (%)"], ["v", "Of value"]],
      calc: ({ p, v }) => [["Percent of value", F(p * v / 100)], ["Value + percent", F(v + p * v / 100)], ["Value − percent", F(v - p * v / 100)]] },
    { id: "chg", name: "% change", fields: [["a", "Old value"], ["b", "New value"]],
      calc: ({ a, b }) => { if (a === 0) throw new Error("The old value can't be 0."); return [["Change", F(b - a)], ["Percent change", pct((b - a) / Math.abs(a) * 100)]]; } },
    { id: "gcd", name: "GCD & LCM", fields: [["a", "First number"], ["b", "Second number"]],
      calc: ({ a, b }) => { whole(a, "Numbers"); whole(b, "Numbers"); const g = gcd(a, b); return [["GCD", F(g)], ["LCM", g ? F(a / g * b) : "0"]]; } },
    { id: "prime", name: "Prime numbers", fields: [["n", "Number"]],
      calc: ({ n }) => {
        whole(n, "The number"); if (n < 2) throw new Error("Enter a number ≥ 2."); if (n > 1e12) throw new Error("Use a number up to 1,000,000,000,000.");
        const f = []; let m = n; for (let d = 2; d * d <= m; d++) while (m % d === 0) { f.push(d); m /= d; } if (m > 1) f.push(m);
        return [["Prime?", f.length === 1 ? "Yes" : "No"], ["Prime factors", f.join(" × ")]];
      } },
    { id: "comb", name: "Permutations", fields: [["n", "n (total)"], ["r", "r (chosen)"]],
      calc: ({ n, r }) => {
        whole(n, "n"); whole(r, "r"); if (r > n) throw new Error("r can't be bigger than n."); if (n > 170) throw new Error("Use n up to 170.");
        let p = 1; for (let i = 0; i < r; i++) p *= n - i; let f = 1; for (let i = 2; i <= r; i++) f *= i;
        return [["nPr (order matters)", F(p)], ["nCr (order doesn't)", F(p / f)]];
      } },
    { id: "base", name: "Number bases", fields: [["n", "Whole number (decimal)"]],
      calc: ({ n }) => { whole(n, "The number"); return [["Binary", n.toString(2)], ["Octal", n.toString(8)], ["Hexadecimal", n.toString(16).toUpperCase()]]; } },
    { id: "int", name: "Interest", fields: [["p", "Amount"], ["r", "Rate (% a year)"], ["t", "Years"]],
      calc: ({ p, r, t }) => { const c = p * Math.pow(1 + r / 100, t); return [["Simple interest", F(p * r * t / 100)], ["Simple total", F(p + p * r * t / 100)], ["Compound interest", F(c - p)], ["Compound total", F(c)]]; } },
    { id: "emi", name: "Loan EMI", fields: [["p", "Loan amount"], ["r", "Rate (% a year)"], ["n", "Months"]],
      calc: ({ p, r, n }) => {
        whole(n, "Months"); if (n < 1) throw new Error("Months must be at least 1.");
        const m = r / 1200, e = m === 0 ? p / n : p * m * Math.pow(1 + m, n) / (Math.pow(1 + m, n) - 1);
        return [["Monthly payment", F(e)], ["Total paid", F(e * n)], ["Total interest", F(e * n - p)]];
      } },
    { id: "bin", name: "Binomial", fields: [["n", "Trials (n)"], ["p", "Chance p (0–1)"], ["k", "Successes (k)"]],
      calc: ({ n, p, k }) => {
        whole(n, "n"); whole(k, "k"); if (k > n || n > 1000) throw new Error("Use k ≤ n and n ≤ 1000."); if (p < 0 || p > 1) throw new Error("p must be between 0 and 1.");
        const pmf = j => { let c = 1; for (let i = 1; i <= j; i++) c *= (n - j + i) / i; return c * Math.pow(p, j) * Math.pow(1 - p, n - j); };
        let cdf = 0; for (let j = 0; j <= k; j++) cdf += pmf(j);
        return [["P(X = k)", F(pmf(k))], ["P(X ≤ k)", F(cdf)], ["Mean (np)", F(n * p)], ["Std deviation", F(Math.sqrt(n * p * (1 - p)))]];
      } },
    { id: "norm", name: "Normal dist.", fields: [["m", "Mean (μ)"], ["s", "Std deviation (σ)"], ["x", "x value"]],
      calc: ({ m, s, x }) => {
        if (s <= 0) throw new Error("σ must be greater than 0.");
        const z = (x - m) / s, c = 0.5 * (1 + erf(z / Math.SQRT2));
        return [["z-score", F(z)], ["P(X ≤ x)", F(c)], ["P(X > x)", F(1 - c)]];
      } },
  ];

  let tool = TOOLS[0], active = null;
  const inputs = () => [...inputsEl.querySelectorAll("input")];
  const padTarget = () => (inputs().includes(active) ? active : inputs()[0]);
  const hint = () => Util.note(resultsEl, "Enter the values below, then press Calculate.", "list-hint");

  function select(id) {
    tool = TOOLS.find(t => t.id === id);
    titleEl.textContent = tool.name;
    listEl.replaceChildren(...TOOLS.map(t => { const b = document.createElement("button"); b.className = "key chip" + (t === tool ? " selected" : ""); b.dataset.tool = t.id; b.textContent = t.name; return b; }));
    inputsEl.replaceChildren(...tool.fields.map(([key, label]) => {
      const w = document.createElement("label"); w.className = "field";
      const s = document.createElement("span"); s.textContent = label;
      const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.autocomplete = "off"; i.placeholder = "0"; i.dataset.key = key;
      w.append(s, i); return w;
    }));
    active = inputs()[0]; active.classList.add("active-field");
    hint();
  }

  function calculate() {
    try {
      const v = {};
      for (const [key, label] of tool.fields) {
        const raw = inputsEl.querySelector(`[data-key="${key}"]`).value.trim();
        if (raw === "") throw new Error(`Enter a value for ${label}.`);
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error(`${label} is not a valid number.`);
        v[key] = n;
      }
      const rows = tool.calc(v);
      Util.rows(resultsEl, rows);
    } catch (err) { Util.note(resultsEl, err.message, "list-error"); }
  }

  listEl.addEventListener("click", e => { const c = e.target.closest("[data-tool]"); if (c) select(c.dataset.tool); });
  inputsEl.addEventListener("input", e => { let x = e.target.value.replace(/[^0-9.\-]/g, ""); const d = x.indexOf("."); if (d >= 0) x = x.slice(0, d + 1) + x.slice(d + 1).replace(/\./g, ""); e.target.value = x; });
  inputsEl.addEventListener("focusin", e => { if (e.target.matches("input")) { active = e.target; inputs().forEach(i => i.classList.toggle("active-field", i === active)); } });
  inputsEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); calculate(); } });
  root.querySelector("#tl-calc").addEventListener("click", calculate);
  root.querySelector("#tl-clear").addEventListener("click", () => { inputs().forEach(i => { i.value = ""; }); hint(); });
  Util.wirePad(root.querySelector("#tl-pad"), padTarget);
  Tabs.onKeys("tools", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    if (!/^[\d.\-]$/.test(e.key) && e.key !== "Backspace") return;
    if (e.key === "Backspace") Util.backspace(padTarget()); else Util.insert(padTarget(), e.key);
    e.preventDefault();
  });

  select("pct");
  return { calculate };
})();

/* ============ Language: Sinhala / English (English text → Sinhala lookup) ============ */
const I18N = (() => {
  const SI = {
    "Basic": "මූලික", "Scientific": "විද්‍යාත්මක", "Geometry": "ජ්‍යාමිතිය", "Statistics": "සංඛ්‍යාලේඛන", "Converter": "පරිවර්තකය", "Matrix": "න්‍යාස", "More": "තවත්",
    "Calculate": "ගණනය කරන්න", "Clear": "මකන්න", "Angle unit": "කෝණ ඒකකය", "Degrees": "අංශක", "Radians": "රේඩියන", "Unit": "ඒකකය", "Value": "අගය", "From": "සිට", "To": "දක්වා",
    "Side": "පැත්ත", "Length": "දිග", "Width": "පළල", "Radius": "අරය", "Height": "උස", "Edge": "දාරය", "2D shapes": "ද්විමාන හැඩ", "3D solids": "ත්‍රිමාන ඝන",
    "Square": "සමචතුරස්‍රය", "Rectangle": "සෘජුකෝණාස්‍රය", "Circle": "කවය", "Triangle": "ත්‍රිකෝණය", "Parallelogram": "සමාන්තරාස්‍රය", "Trapezoid": "ත්‍රපීසියම",
    "Cube": "ඝනකය", "Cuboid": "ඝනකාභය", "Sphere": "ගෝලය", "Cylinder": "සිලින්ඩරය", "Cone": "කේතුව", "Square pyramid": "සමචතුරස්‍ර පිරමිඩය",
    "Area": "වර්ගඵලය", "Perimeter": "පරිමිතිය", "Volume": "පරිමාව", "Surface area": "පෘෂ්ඨ වර්ගඵලය", "Slant height": "ඇලි උස", "Circumference (perimeter)": "වෘත්ත පරිධිය",
    "Count": "ගණන", "Sum": "එකතුව", "Mean": "මධ්‍යන්‍යය", "Median": "මධ්‍යස්ථය", "Mode": "සාමාන්‍ය අගය (මාතය)", "Minimum": "අවම", "Maximum": "උපරිම", "Range": "පරාසය",
    "Variance": "විචලතාව", "Std deviation": "සම්මත අපගමනය", "Geometric mean": "ගුණෝත්තර මධ්‍යන්‍යය", "Data type": "දත්ත වර්ගය", "Data set": "දත්ත කට්ටලය", "Result": "ප්‍රතිඵලය",
    "Weight": "බර", "Temperature": "උෂ්ණත්වය", "Speed": "වේගය", "Time": "කාලය", "Transpose": "පෙරළුම", "Determinant": "නිර්ණායකය", "Inverse": "ප්‍රතිලෝමය", "Rank": "ශ්‍රේණිය",
    "Trace": "අනුරේඛාව", "Adjugate": "සහලේඛය", "Cofactors": "සහගුණක", "Matrix A": "න්‍යාසය A", "Matrix B": "න්‍යාසය B", "Rows": "පේළි", "Cols": "තීරු", "Identity": "ඒකක",
    "Use as A": "A ලෙස යොදන්න", "Use as B": "B ලෙස යොදන්න", "On A": "A මත", "On B": "B මත", "Show as": "පෙන්වන ආකාරය", "Decimals": "දශම", "Fractions": "භාග",
    "Percentage": "ප්‍රතිශතය", "% change": "ප්‍රතිශත වෙනස", "GCD & LCM": "මහාපොදු සාධකය / කුඩාපොදු ගුණාකාරය", "Prime numbers": "ප්‍රථමක සංඛ්‍යා", "Permutations": "පිළිවෙළ / තේරීම්",
    "Number bases": "සංඛ්‍යා පාදක", "Interest": "පොලිය", "Loan EMI": "ණය වාරිකය", "Binomial": "ද්විපද", "Normal dist.": "ප්‍රමත ව්‍යාප්තිය",
    "Percent of value": "අගයේ ප්‍රතිශතය", "Change": "වෙනස", "Percent change": "ප්‍රතිශත වෙනස", "Simple interest": "සරල පොලිය", "Compound interest": "වැල් පොලිය", "Monthly payment": "මාසික වාරිකය",
    "Total paid": "මුළු ගෙවීම", "Total interest": "මුළු පොලිය", "Prime?": "ප්‍රථමකද?", "Prime factors": "ප්‍රථමක සාධක", "Binary": "ද්විමය", "Octal": "අෂ්ටමය", "Hexadecimal": "ෂඩ්දශමය",
    "Percent (%)": "ප්‍රතිශතය (%)", "Of value": "අගය", "Old value": "පරණ අගය", "New value": "අලුත් අගය", "Rate (% a year)": "පොලී අනුපාතය (% වසරකට)", "Years": "වසර", "Months": "මාස",
    "Loan amount": "ණය මුදල", "Amount": "මුදල", "Number": "සංඛ්‍යාව", "Yes": "ඔව්", "No": "නැත", "Simple total": "සරල පොලිය සමඟ මුළු මුදල", "Compound total": "වැල් පොලිය සමඟ මුළු මුදල", "Value + percent": "අගය + ප්‍රතිශතය", "Value − percent": "අගය − ප්‍රතිශතය",
    "nPr (order matters)": "nPr (පිළිවෙළ වැදගත්)", "nCr (order doesn't)": "nCr (පිළිවෙළ අදාළ නැත)", "Mean (np)": "මධ්‍යන්‍යය (np)", "Q1": "Q1 (පළමු චතුර්ථකය)", "Q3": "Q3 (තෙවන චතුර්ථකය)",
  };

  // ---- more words: units, field labels, messages, hints ----
  Object.assign(SI, {
    "Millimetre": "මිලිමීටර්", "Centimetre": "සෙන්ටිමීටර්", "Metre": "මීටර්", "Kilometre": "කිලෝමීටර්", "Inch": "අඟල්", "Foot": "අඩි", "Yard": "යාර්", "Mile": "සැතපුම්",
    "Milligram": "මිලිග්‍රෑම්", "Gram": "ග්‍රෑම්", "Kilogram": "කිලෝග්‍රෑම්", "Tonne": "ටොන්", "Ounce": "අවුන්ස", "Pound": "රාත්තල්", "Stone": "ස්ටෝන්",
    "Celsius": "සෙල්සියස්", "Fahrenheit": "ෆැරන්හයිට්", "Kelvin": "කෙල්වින්", "Square millimetre": "වර්ග මිලිමීටර්", "Square centimetre": "වර්ග සෙන්ටිමීටර්", "Square metre": "වර්ග මීටර්",
    "Hectare": "හෙක්ටයාර්", "Square kilometre": "වර්ග කිලෝමීටර්", "Square inch": "වර්ග අඟල්", "Square foot": "වර්ග අඩි", "Acre": "අක්කර", "Millilitre": "මිලිලීටර්", "Litre": "ලීටර්",
    "Cubic metre": "ඝන මීටර්", "Teaspoon (US)": "තේ හැඳි (US)", "Tablespoon (US)": "බත් හැඳි (US)", "Fluid ounce (US)": "ද්‍රව අවුන්ස (US)", "Cup (US)": "කෝප්ප (US)", "Gallon (US)": "ගැලන් (US)",
    "Metre / second": "මීටර් / තත්පර", "Kilometre / hour": "කිලෝමීටර් / පැය", "Mile / hour": "සැතපුම් / පැය", "Knot": "නොට්", "Foot / second": "අඩි / තත්පර",
    "Millisecond": "මිලිතත්පර", "Second": "තත්පර", "Minute": "මිනිත්තු", "Hour": "පැය", "Day": "දින", "Week": "සති", "Year (365.25 days)": "වසර (දින 365.25)",
    "Base": "පාදම", "Base side": "පාදම පැත්ත", "Bottom": "පහළ", "Top": "ඉහළ", "Left leg": "වම් පාදය", "Right leg": "දකුණු පාදය", "Slant side": "ඇලි පැත්ත", "Side a": "පැත්ත a", "Side b": "පැත්ත b", "Side c": "පැත්ත c",
    "Sample": "නියැදිය", "Population": "ගහනය", "no unit": "ඒකකයක් නැත", "space": "හිස්තැන", "Ans→x": "පෙර ප්‍රතිඵලය→x", "RREF": "RREF (සරල ශ්‍රේණි ආකාරය)", "Mⁿ (power)": "Mⁿ (බලය)", "k × M": "k × M (ගුණකය)",
    "k or n value": "k හෝ n අගය", "Numbers (separate with commas or spaces)": "සංඛ්‍යා (කොමා හෝ හිස්තැන් වලින් වෙන් කරන්න)", "e.g. 2 or 1/2": "උදා: 2 හෝ 1/2",
    "Trials": "පරීක්ෂණ ගණන", "Chance p": "සම්භාවිතාව p", "Successes": "සාර්ථක ගණන", "n (total)": "n (මුළු ගණන)", "r (chosen)": "r (තෝරාගත් ගණන)", "Whole number (decimal)": "පූර්ණ සංඛ්‍යාව (දශම)",
    "First number": "පළමු සංඛ්‍යාව", "Second number": "දෙවන සංඛ්‍යාව", "x value": "x අගය", "z-score": "z-අගය", "Std deviation (σ)": "සම්මත අපගමනය (σ)", "Mean (μ)": "මධ්‍යන්‍යය (μ)",
    "IQR": "IQR (චතුර්ථක පරාසය)", "needs 2+ numbers": "සංඛ්‍යා 2ක් හෝ වැඩි ගණනක් ඕන", "needs values > 0": "0 ට වැඩි අගයන් ඕන", "No repeats": "පුනරාවර්තන නැත",
    "Type a value to convert": "පරිවර්තනය කිරීමට අගයක් ඇතුළත් කරන්න",
    "Enter the measurements below, then press Calculate.": "පහත මිනුම් ඇතුළත් කර, ගණනය කරන්න ඔබන්න.",
    "Enter the values below, then press Calculate.": "පහත අගයන් ඇතුළත් කර, ගණනය කරන්න ඔබන්න.",
    "Type your numbers below (for example 4, 8, 15, 16, 23, 42), then press Calculate or Enter.": "පහත සංඛ්‍යා ටයිප් කරන්න (උදා: 4, 8, 15, 16, 23, 42), ඉන්පසු ගණනය කරන්න හෝ Enter ඔබන්න.",
    "Fill in your matrices, then choose an operation. Use + / − to change the size (up to 10 × 10).": "න්‍යාස පුරවා, ක්‍රියාවක් තෝරන්න. ප්‍රමාණය වෙනස් කිරීමට + / − භාවිතා කරන්න (උපරිම 10 × 10).",
    "Cannot divide by zero": "බිංදුවෙන් බෙදිය නොහැක", "Enter a number ≥ 2.": "2 හෝ ඊට වැඩි සංඛ්‍යාවක් ඇතුළත් කරන්න.",
    "Enter some numbers first, for example 4, 8, 15, 16, 23, 42.": "මුලින් සංඛ්‍යා කිහිපයක් ඇතුළත් කරන්න, උදා: 4, 8, 15, 16, 23, 42.",
    "Every measurement must be greater than 0.": "සෑම මිනුමක්ම 0 ට වඩා වැඩි විය යුතුය.", "Incomplete expression": "ප්‍රකාශනය සම්පූර්ණ නැත", "Invalid input": "වැරදි ආදානයකි", "Missing )": "වසන වරහන ) අඩුයි",
    "Months must be at least 1.": "මාස ගණන අවම වශයෙන් 1ක් විය යුතුය.", "No result to reuse yet": "නැවත භාවිත කිරීමට ප්‍රතිඵලයක් තවම නැත", "Not a valid number": "වලංගු සංඛ්‍යාවක් නොවේ",
    "Result is undefined or too large": "ප්‍රතිඵලය අර්ථ දක්වා නැත, නැත්නම් ඉතා විශාලයි", "Result too large": "ප්‍රතිඵලය ඉතා විශාලයි", "That is below absolute zero.": "එය නිරපේක්ෂ ශුන්‍යයට වඩා පහළයි.",
    "The height can't be longer than a leg.": "උස, පාදයකට වඩා දිගු විය නොහැක.", "The height can't be longer than the slant side.": "උස, ඇලි පැත්තට වඩා දිගු විය නොහැක.",
    "The number got too large to show.": "සංඛ්‍යාව පෙන්වීමට නොහැකි තරම් විශාලයි.", "The numbers got too large to show.": "සංඛ්‍යා පෙන්වීමට නොහැකි තරම් විශාලයි.", "The result is too large to show.": "ප්‍රතිඵලය පෙන්වීමට නොහැකි තරම් විශාලයි.",
    "The old value can't be 0.": "පරණ අගය 0 විය නොහැක.", "The power n must be a whole number (for example 2, 3 or −1).": "බලය n පූර්ණ සංඛ්‍යාවක් විය යුතුය (උදා: 2, 3 හෝ −1).",
    "These sides can't form a triangle: each side must be shorter than the other two added together.": "මෙම පැති වලින් ත්‍රිකෝණයක් සෑදිය නොහැක: සෑම පැත්තක්ම අනිත් පැති දෙකේ එකතුවට වඩා කෙටි විය යුතුය.",
    "This matrix is singular (its determinant is 0), so it has no inverse.": "මෙය සිංගුලර් න්‍යාසයකි (නිර්ණායකය 0), එබැවින් ප්‍රතිලෝමයක් නැත.",
    "Use a number up to 1,000,000,000,000.": "1,000,000,000,000 දක්වා සංඛ්‍යාවක් භාවිතා කරන්න.", "Use a power between −64 and 64.": "−64 සහ 64 අතර බලයක් භාවිතා කරන්න.",
    "Use k ≤ n and n ≤ 1000.": "k ≤ n සහ n ≤ 1000 විය යුතුය.", "Use n up to 170.": "n = 170 දක්වා භාවිතා කරන්න.",
    "cos⁻¹ needs −1 ≤ x ≤ 1": "cos⁻¹ සඳහා −1 ≤ x ≤ 1 විය යුතුය", "sin⁻¹ needs −1 ≤ x ≤ 1": "sin⁻¹ සඳහා −1 ≤ x ≤ 1 විය යුතුය",
    "ln needs x > 0": "ln සඳහා x > 0 විය යුතුය", "log needs x > 0": "log සඳහා x > 0 විය යුතුය", "n! is too large (max n = 170)": "n! ඉතා විශාලයි (උපරිම n = 170)",
    "n! needs a whole number ≥ 0": "n! සඳහා 0 හෝ ඊට වැඩි පූර්ණ සංඛ්‍යාවක් ඕන", "p must be between 0 and 1.": "p අගය 0 සහ 1 අතර විය යුතුය.", "r can't be bigger than n.": "r, n ට වඩා විශාල විය නොහැක.",
    "tan is undefined here": "මෙහි tan අර්ථ දක්වා නැත", "σ must be greater than 0.": "σ, 0 ට වඩා වැඩි විය යුතුය.", "√x needs x ≥ 0": "√x සඳහා x ≥ 0 විය යුතුය",
    "Absolute value": "නිරපේක්ෂ අගය", "Add": "එකතු කරන්න", "Subtract": "අඩු කරන්න", "Multiply": "ගුණ කරන්න", "Divide": "බෙදන්න", "Equals": "සමාන", "Factorial": "ගුණිතය (n!)", "Insert pi": "π ඇතුළත් කරන්න",
    "Square root": "වර්ගමූලය", "Backspace": "පසුපසට මකන්න", "Clear value": "අගය මකන්න", "Comma": "කොමාව", "Fraction slash": "භාග ඉර", "Minus sign": "සෘණ ලකුණ", "Next cell": "ඊළඟ කොටුව",
    "Previous cell": "කලින් කොටුව", "Swap units": "ඒකක මාරු කරන්න", "Toggle sign": "ලකුණ මාරු කරන්න", "Use last result as x": "අන්තිම ප්‍රතිඵලය x ලෙස යොදන්න", "Number pad": "අංක පුවරුව",
    "Calculator modes": "ගණක ප්‍රකාරයන්", "Shape type": "හැඩ වර්ගය", "x to the power y": "x වල y බලය", "Inverse sine": "ප්‍රතිලෝම sin", "Inverse cosine": "ප්‍රතිලෝම cos", "Inverse tangent": "ප්‍රතිලෝම tan",
  });

  // sentences with a changing part (a name, a size, a number)
  const who = x => { let m; return (m = x.match(/^Cell (.+)$/)) ? `${m[1]} කොටුව` : (m = x.match(/^The (.+) value$/)) ? `${m[1]} අගය` : t(x); };
  const RULES = [
    [/^Enter a value for (.+?)\.?$/, m => `${t(m[1])} සඳහා අගයක් ඇතුළත් කරන්න.`],
    [/^(.+) is not a valid number\.?$/, m => `${who(m[1])} වලංගු සංඛ්‍යාවක් නොවේ.`],
    [/^(.+) is not a valid fraction\.$/, m => `${who(m[1])} වලංගු භාගයක් නොවේ.`],
    [/^(.+) divides by zero\.$/, m => `${who(m[1])} බිංදුවෙන් බෙදයි.`],
    [/^(.+) must be a whole number ≥ 0\.?$/, m => `${t(m[1])} 0 හෝ ඊට වැඩි පූර්ණ සංඛ්‍යාවක් විය යුතුය.`],
    [/^(.+) needs a square matrix, but this one is (\d+×\d+)\.$/, m => `${t(m[1])} සඳහා සමචතුරස්‍ර න්‍යාසයක් ඕන, නමුත් මෙය ${m[2]} ය.`],
    [/^A is (\d+×\d+) but B is (\d+×\d+)\. For \+ and − both matrices must be the same size\.$/, m => `A ${m[1]} වන අතර B ${m[2]} වේ. + සහ − සඳහා න්‍යාස දෙකම එකම ප්‍රමාණයේ විය යුතුය.`],
    [/^(\w) is (\d+×\d+) and (\w) is (\d+×\d+)\. To multiply, the columns of (\w) \((\d+)\) must equal the rows of (\w) \((\d+)\)\.$/, m => `${m[1]} ${m[2]} වන අතර ${m[3]} ${m[4]} වේ. ගුණ කිරීමට ${m[5]} හි තීරු ගණන (${m[6]}) ${m[7]} හි පේළි ගණනට (${m[8]}) සමාන විය යුතුය.`],
    [/^Type a value for (.+) in the “k or n value” box first\.$/, m => `පළමුව “k හෝ n අගය” කොටුවේ ${m[1]} සඳහා අගයක් ටයිප් කරන්න.`],
    [/^cofactors of (\w)$/, m => `${m[1]} හි සහගුණක`],
    [/^(\d+) numbers? · (sample|population)$/, m => `සංඛ්‍යා ${m[1]}ක් · ${m[2] === "sample" ? "නියැදිය" : "ගහනය"}`],
    [/^(Fewer|More) (rows|columns) in (\w)$/, m => `${m[3]} හි ${m[2] === "rows" ? "පේළි" : "තීරු"} ${m[1] === "Fewer" ? "අඩු" : "වැඩි"} කරන්න`],
    [/^(\w) row (\d+) column (\d+)$/, m => `${m[1]} පේළිය ${m[2]}, තීරුව ${m[3]}`],
  ];
  function tr(en) {
    if (SI[en] !== undefined) return SI[en];
    for (const [re, fn] of RULES) { const m = en.match(re); if (m) return fn(m); }
    const p = en.match(/^(.*) \(([^()]*)\)$/);          // "Foot (ft)" → "අඩි (ft)"
    if (p) { const n = tr(p[1]); if (n) return `${n} (${p[2]})`; }
    return null;
  }
  const t = x => tr(x) || x;

  let lang = "en", busy = false;
  const gate = document.getElementById("lang-gate");
  const label = document.getElementById("lang-label");

  // wrap each tab's bare text in a <span> so it can be translated
  document.querySelectorAll(".tab").forEach(t => {
    const n = [...t.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
    if (n) { const s = document.createElement("span"); s.textContent = n.textContent.trim(); n.replaceWith(s); }
  });

  const ATTRS = { "placeholder": "enPlaceholder", "aria-label": "enAriaLabel" };

  function walk(node) {
    if (!node || node.nodeType !== 1) return;
    busy = true;
    [node, ...node.querySelectorAll("*")].forEach(el => {
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
      for (const [attr, key] of Object.entries(ATTRS)) {                  // placeholders and screen-reader labels
        const cur = el.getAttribute(attr);
        if (!cur) continue;
        const shown = el.dataset[key] && tr(el.dataset[key]) === cur;
        const en = shown ? el.dataset[key] : cur;
        const si = lang === "si" ? tr(en) : null;
        if (si !== null) { el.dataset[key] = en; el.setAttribute(attr, si); }
        else if (lang === "en" && shown) el.setAttribute(attr, el.dataset[key]);
      }
      if (el.childElementCount) return;                                   // visible text: only elements with no children
      const cur = el.textContent.trim();
      const shown = el.dataset.en && tr(el.dataset.en) === cur;           // still showing our Sinhala text?
      const en = shown ? el.dataset.en : cur;                             // otherwise it is new English text
      const si = lang === "si" ? tr(en) : null;
      if (si !== null) { el.dataset.en = en; if (cur !== si) el.textContent = si; }
      else if (lang === "en" && shown) el.textContent = el.dataset.en;
      else if (!shown) delete el.dataset.en;
    });
    busy = false;
  }

  new MutationObserver(records => {
    if (busy || lang === "en") return;
    records.forEach(r => walk(r.target.nodeType === 1 ? r.target : r.target.parentElement));
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  function setLang(l) {
    lang = l;
    document.documentElement.lang = l === "si" ? "si" : "en";
    label.textContent = l === "si" ? "English" : "සිංහල";
    walk(document.body);
    gate.hidden = true;
    try { localStorage.setItem("prism-lang", l); } catch (e) { /* storage blocked: ignore */ }
  }

  gate.addEventListener("click", e => { const b = e.target.closest("[data-lang]"); if (b) setLang(b.dataset.lang); });
  document.getElementById("lang-switch").addEventListener("click", () => setLang(lang === "si" ? "en" : "si"));

  let saved = null;
  try { saved = localStorage.getItem("prism-lang"); } catch (e) { /* ignore */ }
  if (saved === "si" || saved === "en") setLang(saved); else gate.hidden = false;
  return { setLang };
})();