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

  root.querySelector("#geo-calc").addEventListener("click", calculate);
  root.querySelector("#geo-clear").addEventListener("click", clearAll);
  unitEl.addEventListener("change", () => { if (resultsEl.querySelector(".list-row")) calculate(); });

  // Laptop keyboard: with no field focused, digits go into the first empty measurement box
  Tabs.onKeys("geometry", e => {
    if (Util.inField(e.target) || Util.isButtonPress(e)) return;
    if (!/^[\d.]$/.test(e.key) && e.key !== "Backspace") return;
    const list = inputs();
    const target = list.find(i => i.value === "") || list[list.length - 1];
    if (e.key === "Backspace") Util.backspace(list.filter(i => i.value !== "").pop() || target);
    else Util.insert(target, e.key);
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

    return { n, sum, mean, median, modes, min: sorted[0], max: sorted[n - 1], variance };
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