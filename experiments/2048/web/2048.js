"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/core/board.ts
  var BOARD_SIZE = 4;
  function emptyGrid() {
    return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0));
  }
  function cloneGrid(grid) {
    return grid.map((row) => [...row]);
  }
  function gridsEqual(a, b) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }
  function slideRow(row) {
    const compacted = row.filter((value) => value !== 0);
    const result = [];
    let score = 0;
    for (let i = 0; i < compacted.length; i++) {
      if (i + 1 < compacted.length && compacted[i] === compacted[i + 1]) {
        const merged = compacted[i] * 2;
        result.push(merged);
        score += merged;
        i++;
      } else {
        result.push(compacted[i]);
      }
    }
    while (result.length < BOARD_SIZE) result.push(0);
    return { row: result, score };
  }
  function transpose(grid) {
    return grid.map((_, c) => grid.map((row) => row[c]));
  }
  function reverseRows(grid) {
    return grid.map((row) => [...row].reverse());
  }
  function moveGrid(grid, direction) {
    let working = cloneGrid(grid);
    if (direction === "up" || direction === "down") working = transpose(working);
    if (direction === "right" || direction === "down") working = reverseRows(working);
    let score = 0;
    const movedRows = working.map((row) => {
      const slid = slideRow(row);
      score += slid.score;
      return slid.row;
    });
    let result = movedRows;
    if (direction === "right" || direction === "down") result = reverseRows(result);
    if (direction === "up" || direction === "down") result = transpose(result);
    return { grid: result, score };
  }

  // src/core/rng.ts
  function createSeededRandom(seed) {
    let state = seed >>> 0;
    return function next() {
      state |= 0;
      state = state + 1831565813 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // src/core/game.ts
  var WIN_TILE = 2048;
  var DEFAULT_SPAWN = {
    tiles: [
      { value: 2, probability: 0.9 },
      { value: 4, probability: 0.1 }
    ]
  };
  var Game = class _Game {
    constructor(options = {}) {
      __publicField(this, "currentGrid");
      __publicField(this, "currentScore");
      __publicField(this, "currentWon");
      __publicField(this, "currentOver");
      __publicField(this, "rng");
      __publicField(this, "spawn");
      this.rng = options.rng ?? createSeededRandom(Date.now() >>> 0);
      this.spawn = options.spawn ?? DEFAULT_SPAWN;
      this.currentGrid = options.grid ? cloneGrid(options.grid) : this.initGrid();
      this.currentScore = options.score ?? 0;
      this.currentWon = options.won ?? this.currentGrid.some((row) => row.includes(WIN_TILE));
      this.currentOver = options.over ?? this.computeOver();
    }
    static seeded(seed) {
      return new _Game({ rng: createSeededRandom(seed) });
    }
    get grid() {
      return cloneGrid(this.currentGrid);
    }
    get score() {
      return this.currentScore;
    }
    get won() {
      return this.currentWon;
    }
    get over() {
      return this.currentOver;
    }
    get maxTile() {
      let max = 0;
      for (const row of this.currentGrid) {
        for (const value of row) {
          if (value > max) max = value;
        }
      }
      return max;
    }
    initGrid() {
      const grid = emptyGrid();
      if (this.spawnTileAtRandomEmpty(grid) === null) {
        throw new Error("board has no room for initial tiles");
      }
      if (this.spawnTileAtRandomEmpty(grid) === null) {
        throw new Error("board has no room for initial tiles");
      }
      return grid;
    }
    spawnTileAtRandomEmpty(grid) {
      const empties = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (grid[r][c] === 0) empties.push({ row: r, col: c });
        }
      }
      if (empties.length === 0) return null;
      const pick = empties[Math.floor(this.rng() * empties.length)];
      grid[pick.row][pick.col] = this.pickValue();
      return pick;
    }
    pickValue() {
      const roll = this.rng();
      let cumulative = 0;
      for (const tile of this.spawn.tiles) {
        cumulative += tile.probability;
        if (roll < cumulative) return tile.value;
      }
      return this.spawn.tiles[this.spawn.tiles.length - 1].value;
    }
    move(direction) {
      if (this.currentOver) {
        return { moved: false, scoreGained: 0 };
      }
      const before = this.currentGrid;
      const { grid, score } = moveGrid(before, direction);
      if (gridsEqual(before, grid)) {
        return { moved: false, scoreGained: 0 };
      }
      this.currentGrid = grid;
      this.currentScore += score;
      if (this.currentGrid.some((row) => row.includes(WIN_TILE))) {
        this.currentWon = true;
      }
      this.spawnTileAtRandomEmpty(this.currentGrid);
      this.currentOver = this.computeOver();
      return { moved: true, scoreGained: score };
    }
    computeOver() {
      return !this.hasEmpty() && !this.canMergeAnywhere();
    }
    hasEmpty() {
      return this.currentGrid.some((row) => row.includes(0));
    }
    canMergeAnywhere() {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const value = this.currentGrid[r][c];
          if (value === 0) return true;
          if (c + 1 < BOARD_SIZE && this.currentGrid[r][c + 1] === value) return true;
          if (r + 1 < BOARD_SIZE && this.currentGrid[r + 1][c] === value) return true;
        }
      }
      return false;
    }
    legalMoves() {
      if (this.currentOver) return [];
      const legal = [];
      for (const direction of ["up", "down", "left", "right"]) {
        if (!gridsEqual(this.currentGrid, moveGrid(this.currentGrid, direction).grid)) legal.push(direction);
      }
      return legal;
    }
  };

  // src/core/types.ts
  var DIRECTIONS = ["up", "down", "left", "right"];

  // src/ai/ai.ts
  var DEFAULT_DEPTH = 1;
  var DEFAULT_TIMEOUT_MS = 200;
  var SPAWN_PROBS = [
    [2, 0.9],
    [4, 0.1]
  ];
  var EMPTY_WEIGHT = 270;
  var SMOOTH_WEIGHT = 0.1;
  var MONO_WEIGHT = 100;
  var CORNER_WEIGHT = 500;
  function legalMoves(grid) {
    const legal = [];
    for (const direction of DIRECTIONS) {
      if (!gridsEqual(grid, moveGrid(grid, direction).grid)) legal.push(direction);
    }
    return legal;
  }
  function listEmptyCells(grid) {
    const empties = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (grid[r][c] === 0) empties.push({ row: r, col: c });
      }
    }
    return empties;
  }
  function evaluate(grid) {
    let empty = 0;
    let maxTile = 0;
    for (const row of grid) {
      for (const value of row) {
        if (value === 0) empty++;
        else if (value > maxTile) maxTile = value;
      }
    }
    let smooth = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const value = grid[r][c];
        if (value === 0) continue;
        const logValue = Math.log2(value);
        if (c + 1 < BOARD_SIZE && grid[r][c + 1] !== 0) {
          smooth -= Math.abs(logValue - Math.log2(grid[r][c + 1]));
        }
        if (r + 1 < BOARD_SIZE && grid[r + 1][c] !== 0) {
          smooth -= Math.abs(logValue - Math.log2(grid[r + 1][c]));
        }
      }
    }
    let mono = 0;
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (let r = 0; r < BOARD_SIZE - 1; r++) {
        const top = grid[r][c];
        const bottom = grid[r + 1][c];
        if (top !== 0 && bottom !== 0) {
          if (bottom >= top) mono += Math.log2(bottom) - Math.log2(top);
          else mono -= Math.log2(top) - Math.log2(bottom);
        }
      }
    }
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE - 1; c++) {
        const left = grid[r][c];
        const right = grid[r][c + 1];
        if (left !== 0 && right !== 0) {
          if (right >= left) mono += Math.log2(right) - Math.log2(left);
          else mono -= Math.log2(left) - Math.log2(right);
        }
      }
    }
    let cornerBonus = 0;
    for (const [r, c] of [
      [0, 0],
      [0, BOARD_SIZE - 1],
      [BOARD_SIZE - 1, 0],
      [BOARD_SIZE - 1, BOARD_SIZE - 1]
    ]) {
      if (grid[r][c] === maxTile) cornerBonus += CORNER_WEIGHT;
    }
    return empty * EMPTY_WEIGHT + smooth * SMOOTH_WEIGHT + mono * MONO_WEIGHT + cornerBonus;
  }
  function maxMoves(grid, depth, start, timeoutMs) {
    if (depth <= 0 || Date.now() - start > timeoutMs) return evaluate(grid);
    const moves = legalMoves(grid);
    if (moves.length === 0) return evaluate(grid);
    let best = -Infinity;
    for (const direction of moves) {
      const next = moveGrid(grid, direction).grid;
      const value = search(next, depth - 1, start, timeoutMs);
      if (value > best) best = value;
    }
    return best;
  }
  function search(grid, depth, start, timeoutMs) {
    if (depth <= 0 || Date.now() - start > timeoutMs) return evaluate(grid);
    const empties = listEmptyCells(grid);
    if (empties.length === 0) return evaluate(grid);
    let expected = 0;
    for (const { row, col } of empties) {
      for (const [value, probability] of SPAWN_PROBS) {
        const next = cloneGrid(grid);
        next[row][col] = value;
        expected += probability * maxMoves(next, depth, start, timeoutMs);
      }
    }
    return expected;
  }
  function chooseMove(grid, config = {}) {
    const cfg = {
      depth: config.depth ?? DEFAULT_DEPTH,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    };
    const moves = legalMoves(grid);
    if (moves.length === 0) return "left";
    const start = Date.now();
    let bestDirection = moves[0];
    let bestValue = -Infinity;
    for (const direction of moves) {
      const next = moveGrid(grid, direction).grid;
      const value = search(next, cfg.depth, start, cfg.timeoutMs);
      if (value > bestValue) {
        bestValue = value;
        bestDirection = direction;
      }
      if (Date.now() - start > cfg.timeoutMs) break;
    }
    return bestDirection;
  }

  // src/web/ui.ts
  var BEST_SCORE_KEY = "cometflow2048.best";
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing element #" + id);
    return node;
  }
  function readBest() {
    try {
      return Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  }
  function writeBest(value) {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(value));
    } catch {
    }
  }
  function directionFromKey(event) {
    const key = event.key;
    if (key === "ArrowUp" || key === "w" || key === "W" || key === "k" || key === "K") return "up";
    if (key === "ArrowDown" || key === "s" || key === "S" || key === "j" || key === "J") return "down";
    if (key === "ArrowLeft" || key === "a" || key === "A" || key === "h" || key === "H") return "left";
    if (key === "ArrowRight" || key === "d" || key === "D" || key === "l" || key === "L") return "right";
    return null;
  }
  var DIRECTION_ARROW = {
    up: "\u2191",
    down: "\u2193",
    left: "\u2190",
    right: "\u2192"
  };
  var Web2048 = class {
    constructor() {
      __publicField(this, "game", new Game());
      __publicField(this, "best", readBest());
      __publicField(this, "winShown", false);
      __publicField(this, "overRecorded", false);
      __publicField(this, "hintText", "");
      __publicField(this, "hintTimer", null);
      __publicField(this, "touchStart", null);
      __publicField(this, "demoOn", false);
      __publicField(this, "demoInterval", null);
      __publicField(this, "demoButton", byId("ai-demo"));
      __publicField(this, "scoreEl", byId("score"));
      __publicField(this, "bestEl", byId("best"));
      __publicField(this, "statusEl", byId("status"));
      __publicField(this, "boardEl", byId("board"));
      __publicField(this, "overlayEl", byId("overlay"));
      __publicField(this, "overlayTitleEl", byId("overlay-title"));
      __publicField(this, "overlayTextEl", byId("overlay-text"));
      __publicField(this, "cells", []);
      for (let i = 0; i < 16; i++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        this.boardEl.appendChild(cell);
        this.cells.push(cell);
      }
      byId("restart").addEventListener("click", () => this.restart());
      byId("overlay-restart").addEventListener("click", () => this.restart());
      byId("hint").addEventListener("click", () => this.showHint());
      this.demoButton.addEventListener("click", () => this.toggleDemo());
      window.addEventListener("keydown", (event) => {
        if (event.key === "r" || event.key === "R") {
          this.restart();
          return;
        }
        const direction = directionFromKey(event);
        if (direction) {
          this.stopDemo();
          event.preventDefault();
          this.move(direction);
        }
      });
      this.boardEl.addEventListener("touchstart", (event) => {
        const touch = event.changedTouches[0];
        this.touchStart = { x: touch.clientX, y: touch.clientY };
      }, { passive: true });
      this.boardEl.addEventListener("touchend", (event) => {
        const start = this.touchStart;
        this.touchStart = null;
        if (!start) return;
        this.stopDemo();
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const threshold = 24;
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? "right" : "left");
        else this.move(dy > 0 ? "down" : "up");
      }, { passive: true });
      this.render();
      this.setStatus("WASD / \u65B9\u5411\u952E / \u6ED1\u52A8\u79FB\u52A8 \xB7 R \u91CD\u5F00");
    }
    move(direction) {
      if (this.game.over) {
        this.setStatus("\u6E38\u620F\u7ED3\u675F\uFF0C\u70B9\u51FB\u300C\u91CD\u65B0\u5F00\u59CB\u300D\u518D\u73A9\u4E00\u5C40");
        return;
      }
      const prevGrid = this.game.grid;
      const outcome = this.game.move(direction);
      if (!outcome.moved) {
        this.setStatus("\u65E0\u6548\u79FB\u52A8\uFF0C\u68CB\u76D8\u4E0D\u53D8");
        this.render();
        return;
      }
      if (this.game.won && !this.winShown) {
        this.winShown = true;
        this.setStatus(`\u8FBE\u6210 ${WIN_TILE}\uFF01\u7EE7\u7EED\u6311\u6218\u66F4\u9AD8\u5206 \u{1F389}`);
      }
      if (this.game.over) {
        this.recordOver();
        if (this.demoOn) this.stopDemo();
      }
      this.render();
      this.animateMove(prevGrid, this.game.grid);
    }
    recordOver() {
      if (this.overRecorded) return;
      this.overRecorded = true;
      if (this.game.score > this.best) {
        this.best = this.game.score;
        writeBest(this.best);
      }
      this.overlayTitleEl.textContent = "Game Over";
      this.overlayTextEl.textContent = `\u6700\u7EC8\u5F97\u5206 ${this.game.score} \xB7 \u6700\u5927 tile ${this.game.maxTile}`;
      this.overlayEl.classList.remove("hidden");
    }
    restart() {
      this.stopDemo();
      this.game = new Game();
      this.winShown = false;
      this.overRecorded = false;
      this.overlayEl.classList.add("hidden");
      this.setStatus("\u65B0\u7684\u4E00\u5C40\uFF0C\u795D\u597D\u8FD0\uFF01");
      this.render();
    }
    showHint() {
      this.stopDemo();
      if (this.game.over) return;
      const direction = chooseMove(this.game.grid, { depth: 1, timeoutMs: 200 });
      this.hintText = `AI \u5EFA\u8BAE\uFF1A${DIRECTION_ARROW[direction]}`;
      this.render();
      if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
      this.hintTimer = window.setTimeout(() => {
        this.hintText = "";
        this.render();
      }, 2500);
    }
    setStatus(text) {
      this.statusEl.textContent = text;
    }
    toggleDemo() {
      if (this.demoOn) this.stopDemo();
      else this.startDemo();
    }
    startDemo() {
      if (this.game.over) return;
      this.stopDemo();
      this.demoOn = true;
      this.demoButton.textContent = "\u505C\u6B62\u6F14\u793A";
      this.demoInterval = window.setInterval(() => this.demoStep(), 150);
      this.demoStep();
    }
    stopDemo() {
      this.demoOn = false;
      if (this.demoInterval !== null) {
        window.clearInterval(this.demoInterval);
        this.demoInterval = null;
      }
      this.demoButton.textContent = "AI \u6F14\u793A";
    }
    demoStep() {
      if (this.game.over) {
        this.stopDemo();
        this.setStatus("AI \u6F14\u793A\u7ED3\u675F");
        return;
      }
      const direction = chooseMove(this.game.grid, { depth: 1, timeoutMs: 200 });
      this.move(direction);
    }
    render() {
      this.scoreEl.textContent = String(this.game.score);
      this.bestEl.textContent = String(Math.max(this.best, this.game.score));
      const grid = this.game.grid;
      for (let i = 0; i < 16; i++) {
        const value = grid[Math.floor(i / 4)][i % 4];
        const cell = this.cells[i];
        cell.textContent = value === 0 ? "" : String(value);
        cell.className = "cell" + (value === 0 ? "" : " cell-" + value);
      }
      if (this.hintText) this.statusEl.textContent = this.hintText;
    }
    cellPitch() {
      const width = this.cells[0].offsetWidth || 0;
      return width + 10;
    }
    findSlideSource(prev, used, value) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const idx = r * 4 + c;
          if (used.has(idx)) continue;
          if (prev[r][c] === value) return { r, c };
        }
      }
      return null;
    }
    findMergeSource(prev, used, value) {
      for (let line = 0; line < 4; line++) {
        for (const isRow of [true, false]) {
          const candidates = [];
          for (let k = 0; k < 4; k++) {
            const r = isRow ? line : k;
            const c = isRow ? k : line;
            const idx = r * 4 + c;
            if (used.has(idx)) continue;
            const v = prev[r][c];
            if (v !== 0 && v < value) candidates.push({ r, c, idx, v });
          }
          for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
              if (candidates[i].v + candidates[j].v === value) {
                return [candidates[i], candidates[j]];
              }
            }
          }
        }
      }
      return null;
    }
    /** 视觉动画：滑动（transform 过渡）、合并（pop）、生成（spawn）。只动样式，不改游戏状态。 */
    animateMove(prev, next) {
      const pitch = this.cellPitch();
      const used = /* @__PURE__ */ new Set();
      const slide = /* @__PURE__ */ new Map();
      const merge = /* @__PURE__ */ new Set();
      const spawn = /* @__PURE__ */ new Set();
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const value = next[r][c];
          const idx = r * 4 + c;
          if (value === 0) continue;
          const pair = this.findMergeSource(prev, used, value);
          if (pair) {
            merge.add(idx);
            for (const p of pair) used.add(p.idx);
            continue;
          }
          const source = this.findSlideSource(prev, used, value);
          if (source) {
            used.add(source.r * 4 + source.c);
            slide.set(idx, { dr: source.r - r, dc: source.c - c });
          } else {
            spawn.add(idx);
          }
        }
      }
      for (const [idx, delta] of slide) {
        this.cells[idx].style.transform = `translate(${delta.dc * pitch}px, ${delta.dr * pitch}px)`;
      }
      const settle = () => {
        for (const idx of slide.keys()) {
          this.cells[idx].style.transform = "";
        }
        for (const idx of merge) {
          const el = this.cells[idx];
          el.classList.add("cell-pop");
          window.setTimeout(() => el.classList.remove("cell-pop"), 180);
        }
        for (const idx of spawn) {
          this.cells[idx].classList.add("cell-spawn");
        }
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => window.requestAnimationFrame(settle));
      } else {
        settle();
      }
    }
  };
  new Web2048();
})();
