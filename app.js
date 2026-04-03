/**
 * EVOLU-A — Game UI Client
 * Polls the Node.js backend — Sepolia EVM + x402 payment protocol.
 */

const CONFIG = {
    gridW: 20,
    gridH: 20,
    cellSize: 40,
};

const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';

const STAGES = {
    "Collector": { hex: "#00e5c8" },
    "Merchant":  { hex: "#5a8cff" },
    "Producer":  { hex: "#ffb800" },
    "Legend":    { hex: "#ffc332" }
};

const STAGE_ORDER = ["Collector", "Merchant", "Producer", "Legend"];

const RESOURCES = {
    "wood":  { hex: "#8c5a2b" },
    "stone": { hex: "#919194" },
    "food":  { hex: "#4bd77d" }
};

// Use relative API path so it works seamlessly on Render/Vercel
const API_URL = "/api";

// ─── Chat Bubble Sprite ──────────────────────────────────────────────────────
const chatBubbleImg = new Image();
chatBubbleImg.src = 'assets/Chat BalloonsBubbles - Pixel Art/X2/Chat-Transparent.png';
// X2 spritesheet: 1792×352px — each cell: 128×176px (14 cols × 2 rows)
const BUBBLE_CELL_W = 128;
const BUBBLE_CELL_H = 176;
// We use col=0 row=0 (standard bubble with bottom-left tail)

// ─── Assets ─────────────────────────────────────────────────────────────────
const floorTiles = [];
for(let i=0; i<4; i++) {
    const img = new Image();
    img.src = 'assets/isometric tileset/separated images/tile_036.png';
    floorTiles.push(img);
}
const variantImg = new Image();
variantImg.src = 'assets/isometric tileset/separated images/tile_029.png';
floorTiles.push(variantImg);

const waterCanvas = document.createElement('canvas');
const waterTileBase = new Image();
waterTileBase.src = 'assets/isometric tileset/separated images/tile_036.png';
waterTileBase.onload = () => {
    waterCanvas.width = waterTileBase.naturalWidth;
    waterCanvas.height = waterTileBase.naturalHeight;
    const wctx = waterCanvas.getContext('2d');
    wctx.filter = 'hue-rotate(130deg) saturate(1.5) brightness(0.85)';
    wctx.drawImage(waterTileBase, 0, 0);
};

const bgAssets = {
    wood: new Image(),
    stone: new Image(),
    food: new Image(),
    gold: new Image(),
    crystal: new Image()
};
bgAssets.wood.src    = 'assets/isometric tileset/separated images/tile_053.png';
bgAssets.stone.src   = 'assets/isometric tileset/separated images/tile_060.png';
bgAssets.food.src    = 'assets/isometric tileset/separated images/tile_048.png';
bgAssets.gold.src    = 'assets/isometric tileset/separated images/tile_044.png';
bgAssets.crystal.src = 'assets/isometric tileset/separated images/tile_041.png';

const agentAnimals = {
    "Collector": new Image(),
    "Merchant":  new Image(),
    "Producer":  new Image(),
    "Legend":    new Image()
};
agentAnimals["Collector"].src = 'robot level/4.png';
agentAnimals["Merchant"].src  = 'robot level/3.png';
agentAnimals["Producer"].src  = 'robot level/2.png';
agentAnimals["Legend"].src    = 'robot level/1.png';

const avatarImg = new Image();
avatarImg.src = 'assets/avatar.png';

// ─── DOM Refs ────────────────────────────────────────────────────────────────
const dom = {
    canvas:          document.getElementById('gameCanvas'),
    agentsContainer: document.getElementById('agents-container'),
    eventLog:        document.getElementById('event-log'),
    contractBalance: document.getElementById('contract-balance'),
    turnIndicator:   document.getElementById('turnIndicator'),
    simStatus:       document.getElementById('simStatus'),
    btnReset:        document.getElementById('btn-reset'),
    fallbackBanner:  document.getElementById('fallbackBanner'),
    tabs:            document.querySelectorAll('.tab'),
    tabContents:     document.querySelectorAll('.tab-content'),
    filterBtns:      document.querySelectorAll('.filter-btn'),
};

// ─── SESSION STATE ───────────────────────────────────────────────────────────
// Read API key from sessionStorage (set by landing.js on launch)
const SESSION_API_KEY = sessionStorage.getItem('evolu_apiKey') || '';

const ctx = dom.canvas.getContext('2d');
dom.canvas.width  = 1400; // expanded for full isometric diamond view
dom.canvas.height = 900;

let state = null;
let pollingInterval = null;
let turnCount = 0;

// Speech bubble tracking: store client-side timestamp when a new message is first seen
const bubbleSeen = {}; // agentName → { msg, ts }

// Chat log: accumulates all agent messages for the CHAT tab
const chatHistory = []; // { name, color, msg, ts }
const MAX_CHAT_HISTORY = 60;

// Canvas panning
let panX = 0;
let panY = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

dom.canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        panX += (e.clientX - lastMouseX);
        panY += (e.clientY - lastMouseY);
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

// Touch support for panning
dom.canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        isDragging = true;
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    }
});

window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches.length === 1) {
        panX += (e.touches[0].clientX - lastMouseX);
        panY += (e.touches[0].clientY - lastMouseY);
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    }
});

window.addEventListener('touchend', () => {
    isDragging = false;
});

// ─── TABS ────────────────────────────────────────────────────────────────────
dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        dom.tabs.forEach(t => t.classList.remove('active'));
        dom.tabContents.forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
    });
});

// ─── LOG FILTERS ─────────────────────────────────────────────────────────────
dom.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        dom.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// ─── FETCH STATE ─────────────────────────────────────────────────────────────
async function fetchState() {
    try {
        const res = await fetch(`${API_URL}/state`);
        if (!res.ok) return;
        const newState = await res.json();

        // Count turns
        if (state && newState.agents) {
            if (!state.logs || newState.logs.length !== state.logs.length) {
                turnCount++;
                if (dom.turnIndicator) dom.turnIndicator.textContent = `Turn ${turnCount}`;
            }
        }

        state = newState;

        if (state.starting && dom.simStatus) {
            dom.simStatus.style.display = 'flex';
            dom.simStatus.innerHTML = `<div class="pulse-dot" style="background:#5a8cff"></div><span style="color:#5a8cff">Funding agents from Sepolia...</span>`;
        } else if (state.running === false && dom.simStatus && state.agents && state.agents.length > 0 && !state.agents.some(a => a.alive)) {
            dom.simStatus.style.display = 'flex';
            dom.simStatus.innerHTML = `<div class="pulse-dot" style="background:#ff4b55;animation:none;box-shadow:none;"></div><span style="color:#ff4b55">Simulation Ended</span>`;
        } else if (dom.simStatus) {
            dom.simStatus.style.display = 'none';
            dom.simStatus.innerHTML = '';
        }

        renderDOM();
    } catch (e) {
        console.warn("Backend unreachable", e);
    }
}

// ─── CANVAS RENDER ───────────────────────────────────────────────────────────
function renderCanvas() {
    ctx.fillStyle = '#080d1a'; 
    ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);

    if (!state) { requestAnimationFrame(renderCanvas); return; }

    const tileW = 40;
    const tileH = 20;
    const offsetX = dom.canvas.width / 2 + panX;
    const offsetY = 120 + panY;

    // Draw Isometric Floor with Water borders
    const pad = 4; // water boundary
    for (let y = -pad; y < CONFIG.gridH + pad; y++) {
        for (let x = -pad; x < CONFIG.gridW + pad; x++) {
            const px = offsetX + (x - y) * (tileW / 2);
            const py = offsetY + (x + y) * (tileH / 2);
            
            const isWater = (x < 0 || x >= CONFIG.gridW || y < 0 || y >= CONFIG.gridH);
            let img = isWater ? waterCanvas : floorTiles[Math.abs(x * 13 + y * 7) % floorTiles.length];

            const srcW = img.naturalWidth || img.width;
            const srcH = img.naturalHeight || img.height;

            if (srcW && srcW > 0) {
                const drawH = srcH * (tileW / srcW);
                const shiftY = isWater ? 12 : 0;
                ctx.drawImage(img, px - tileW/2, py + shiftY, tileW, drawH);
            }
        }
    }

    // Depth Sorting List
    let drawables = [];
    
    // Resources
    state.world.resources.forEach(r => {
        drawables.push({
            type: 'resource',
            x: r.x, y: r.y,
            kind: r.kind,
            depth: r.x + r.y
        });
    });

    // Agents
    state.agents.forEach(a => {
        drawables.push({
            type: 'agent',
            x: a.x, y: a.y,
            data: a,
            depth: a.x + a.y + 0.1 
        });
    });

    drawables.sort((a, b) => a.depth - b.depth);

    // Render Sorted Items
    drawables.forEach(item => {
        const px = offsetX + (item.x - item.y) * (tileW / 2);
        const py = offsetY + (item.x + item.y) * (tileH / 2);

        if (item.type === 'resource') {
            let rImg = bgAssets[item.kind] || null;

            if (rImg && rImg.complete && rImg.naturalWidth > 0) {
                const drawH = rImg.naturalHeight * (tileW / rImg.naturalWidth);
                const drawY = py - (drawH - tileH);
                ctx.drawImage(rImg, px - tileW/2, drawY, tileW, drawH);
            } else {
                const color = RESOURCES[item.kind]?.hex || '#fff';
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(px, py + tileH/2, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        } 
        else if (item.type === 'agent') {
            const a = item.data;
            const color = STAGES[a.stage]?.hex || '#00e5c8';

            let robH = 40;
            const aImg = agentAnimals[a.stage] || avatarImg;
            if (aImg.complete && aImg.naturalWidth > 0) {
                robH = aImg.naturalHeight * (40 / aImg.naturalWidth);
            }

            // Thinking Outline
            if (a.isThinking) {
                ctx.fillStyle = color + '55';
                ctx.beginPath();
                ctx.ellipse(px, py + tileH/2, tileW/2, tileH/2, 0, 0, Math.PI*2);
                ctx.fill();
            }

            if (!a.alive) {
                ctx.strokeStyle = 'rgba(255,75,85,0.8)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(px-5, py); ctx.lineTo(px+5, py+tileH);
                ctx.moveTo(px+5, py); ctx.lineTo(px-5, py+tileH);
                ctx.stroke();
                return;
            }

            if (aImg.complete && aImg.naturalWidth > 0) {
                const robW = 40;
                robH = aImg.naturalHeight * (robW / aImg.naturalWidth);
                const drawX = px - robW/2;
                const drawY = py - robH + tileH;

                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.ellipse(px, py + tileH/2, tileW/3, tileH/4, 0, 0, Math.PI*2);
                ctx.fill();

                ctx.drawImage(aImg, drawX, drawY, robW, robH);
            } else {
                ctx.fillStyle = color + 'AA';
                ctx.fillRect(px - 10, py - 10, 20, 20);
            }
            
            // Nameplate
            ctx.fillStyle = 'rgba(8,13,26,0.85)';
            ctx.fillRect(px - 14, py - 20, 28, 14);
            ctx.fillStyle = color;
            ctx.font = 'bold 9px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(a.name.slice(0, 4), px, py - 12);
            
            const stageIdx = STAGE_ORDER.indexOf(a.stage);
            ctx.fillStyle = '#ffc332';
            ctx.font = '8px sans-serif';
            ctx.fillText('★'.repeat(stageIdx + 1), px, py - 2);

            // HP Bar
            const hpWidth = 28;
            const hpx = px - 14;
            const hpy = py - 24;
            ctx.fillStyle = '#ff4b55';
            ctx.fillRect(hpx, hpy, hpWidth, 3);
            ctx.fillStyle = '#4bd77d';
            ctx.fillRect(hpx, hpy, Math.max(0, hpWidth * (a.hp / 100)), 3);

            // Chat Bubble — pixel art sprite with fade
            if (a.message) {
                const prev = bubbleSeen[a.name];
                if (!prev || prev.msg !== a.message) {
                    bubbleSeen[a.name] = { msg: a.message, ts: Date.now() };
                }
                const age = Date.now() - bubbleSeen[a.name].ts;
                const alpha = Math.max(0, 1 - age / 5000);

                if (alpha > 0.05) {
                    ctx.save();
                    ctx.globalAlpha = alpha;

                    const text = a.message.length > 36 ? a.message.slice(0, 36) + '…' : a.message;
                    ctx.font = 'bold 10px "Fira Code", monospace';
                    const textW = ctx.measureText(text).width;

                    const bW = Math.max(80, textW + 22);
                    const bH = 36;
                    const bx = px - bW / 2;
                    const by = py - robH + tileH - bH - 14;

                    if (chatBubbleImg.complete && chatBubbleImg.naturalWidth > 0) {
                        // Draw pixel art bubble sprite (col 0, row 0)
                        ctx.drawImage(
                            chatBubbleImg,
                            0, 0, BUBBLE_CELL_W, BUBBLE_CELL_H,
                            bx, by, bW, bH + 14
                        );
                    } else {
                        ctx.fillStyle = 'rgba(240,240,255,0.92)';
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(bx, by, bW, bH, 6);
                        else ctx.rect(bx, by, bW, bH);
                        ctx.fill();
                    }

                    ctx.fillStyle = '#0d1525';
                    ctx.font = 'bold 10px "Fira Code", monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, px, by + bH / 2 - 2);
                    ctx.restore();
                }
            }
        }
    });

    requestAnimationFrame(renderCanvas);
}

// ─── DOM RENDER ──────────────────────────────────────────────────────────────
function renderDOM() {
    if (!state) return;

    dom.contractBalance.textContent = `${Number(state.world.contractBalance).toFixed(6)} ETH`;

    if (dom.fallbackBanner) {
        dom.fallbackBanner.classList.toggle('hidden', !state.isFallbackMode);
    }
    if (dom.agentsContainer.children.length === 0 && state.agents.length > 0) {
        buildAgentCards();
    }

    state.agents.forEach((a, i) => {
        updateAgentCard(a, i);
        // Track new messages for the chat tab
        if (a.message && a.alive) {
            const prev = bubbleSeen[a.name];
            if (!prev || prev.msg !== a.message) {
                const color = STAGES[a.stage]?.hex || '#00e5c8';
                chatHistory.unshift({ name: a.name, color, msg: a.message, ts: Date.now(), isFallback: a.isFallback });
                if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.pop();
            }
        }
    });
    renderLog();
    renderChat();
}

function buildAgentCards() {
    state.agents.forEach((a, i) => {
        const color = STAGES[a.stage]?.hex || '#00e5c8';
        const card  = document.createElement('div');
        card.className = 'agent-card';
        card.id = `agent-card-${i}`;
        card.style.setProperty('--stage-color', color);

        const shortAddr  = a.evmAddress
            ? `${a.evmAddress.slice(0, 6)}...${a.evmAddress.slice(-4)}`
            : 'N/A';
        const explorerUrl = `${ETHERSCAN_BASE}/address/${a.evmAddress}`;

        const imgSrc = agentAnimals[a.stage]?.src || 'assets/avatar.png';

        card.innerHTML = `
            <div class="agent-header">
                <img class="agent-avatar" id="agent-avatar-${i}" src="${imgSrc}" alt="Agent" style="border-color: ${color}; image-rendering: pixelated; object-fit: contain;">
                <div class="agent-info">
                    <div class="agent-name-row">
                        <span class="agent-name" style="color:${color}">${a.name}</span>
                        <span class="agent-status" id="agent-s-${i}"></span>
                    </div>
                    <a class="agent-address" href="${explorerUrl}" target="_blank"
                       title="Etherscan Sepolia: ${a.evmAddress}"
                       style="color:inherit;text-decoration:none;cursor:pointer;">${shortAddr} ↗</a>
                </div>
            </div>
            <div class="agent-details">
                <div class="agent-detail-item">
                    <div class="detail-label">Stage</div>
                    <div class="detail-value teal" id="agent-stage-${i}">${a.stage}</div>
                </div>
                <div class="agent-detail-item">
                    <div class="detail-label">Balance</div>
                    <div class="detail-value amber" id="agent-bal-${i}">${Number(a.balance).toFixed(6)} ETH</div>
                </div>
                <div class="agent-detail-item">
                    <div class="detail-label">HP</div>
                    <div class="detail-value" id="agent-hp-${i}" style="color:${a.hp > 30 ? '#4bd77d' : '#ff4b55'}">${a.hp || 0} / 100</div>
                </div>
                <div class="agent-detail-item">
                    <div class="detail-label">Position</div>
                    <div class="detail-value" id="agent-pos-${i}">(${a.x}, ${a.y})</div>
                </div>
                <div class="agent-detail-item">
                    <div class="detail-label">Last Tx</div>
                    <div class="detail-value" id="agent-tx-${i}" style="font-size:9px">—</div>
                </div>
            </div>
            <div class="agent-stage-bar" id="agent-bar-${i}">
                <div class="stage-pip"></div>
                <div class="stage-pip"></div>
                <div class="stage-pip"></div>
                <div class="stage-pip"></div>
            </div>
        `;
        dom.agentsContainer.appendChild(card);
    });
}

function updateAgentCard(a, i) {
    const card = document.getElementById(`agent-card-${i}`);
    if (!card) return;

    const color = STAGES[a.stage]?.hex || '#00e5c8';
    card.style.setProperty('--stage-color', color);

    const statusEl = document.getElementById(`agent-s-${i}`);
    const balEl    = document.getElementById(`agent-bal-${i}`);
    const posEl    = document.getElementById(`agent-pos-${i}`);
    const stageEl  = document.getElementById(`agent-stage-${i}`);
    const barEl    = document.getElementById(`agent-bar-${i}`);
    const avatarEl = document.getElementById(`agent-avatar-${i}`);

    if (!a.alive) {
        card.classList.add('dead');
        card.classList.remove('thinking');
        if (statusEl) { statusEl.textContent = '[DEAD]'; statusEl.style.color = 'var(--red)'; statusEl.style.animation = 'none'; }
    } else {
        card.classList.remove('dead');
        if (a.isThinking) {
            card.classList.add('thinking');
            if (statusEl) { statusEl.textContent = '◉ Thinking...'; statusEl.style.color = 'var(--thinking)'; statusEl.style.animation = ''; }
        } else {
            card.classList.remove('thinking');
            if (statusEl) { statusEl.textContent = a.lastAction || ''; statusEl.style.color = 'var(--text-dim)'; statusEl.style.animation = 'none'; }
        }
    }

    const hpEl = document.getElementById(`agent-hp-${i}`);
    if (hpEl) {
        hpEl.textContent = `${a.hp} / 100`;
        hpEl.style.color = a.hp > 30 ? '#4bd77d' : '#ff4b55';
    }

    // Fallback badge
    let fallbackBadge = card.querySelector('.fallback-badge');
    if (a.isFallback && a.alive) {
        if (!fallbackBadge) {
            fallbackBadge = document.createElement('span');
            fallbackBadge.className = 'fallback-badge';
            fallbackBadge.textContent = '🤖 Fallback';
            const nameRow = card.querySelector('.agent-name-row');
            if (nameRow) nameRow.appendChild(fallbackBadge);
        }
    } else if (fallbackBadge) {
        fallbackBadge.remove();
    }

    // Online/offline badge on address link
    let modeBadge = card.querySelector('.mode-badge');
    if (!modeBadge) {
        modeBadge = document.createElement('span');
        modeBadge.className = 'mode-badge';
        modeBadge.style.cssText = 'font-size:9px;margin-left:4px;opacity:0.7;';
        const addrEl = card.querySelector('.agent-address');
        if (addrEl) addrEl.parentNode.insertBefore(modeBadge, addrEl.nextSibling);
    }
    modeBadge.textContent = a.isFunded ? '⬡ Sepolia' : '◌ offline';
    modeBadge.style.color = a.isFunded ? '#4bd77d' : '#ff8c42';

    if (avatarEl) {
        avatarEl.style.borderColor = color;
        const expectedSrc = agentAnimals[a.stage]?.src || 'assets/avatar.png';
        if (!avatarEl.src.includes(expectedSrc)) {
            avatarEl.src = expectedSrc;
        }
    }
    const nameEl = card.querySelector('.agent-name');
    if (nameEl) nameEl.style.color = color;

    if (stageEl) stageEl.textContent = a.stage;
    if (posEl)   posEl.textContent   = `(${a.x}, ${a.y})`;

    if (balEl) {
        balEl.textContent = `${Number(a.balance).toFixed(6)} ETH`;
        balEl.className   = `detail-value ${a.balance > 0.005 ? 'amber' : 'red'}`;
    }

    // Transaction link
    const txEl = document.getElementById(`agent-tx-${i}`);
    if (txEl && a.lastTxHash) {
        const txUrl = `${ETHERSCAN_BASE}/tx/${a.lastTxHash}`;
        txEl.innerHTML = `<a href="${txUrl}" target="_blank" style="color:var(--teal);text-decoration:none;">${a.lastTxHash.slice(0, 12)}... ↗</a>`;
    } else if (txEl && !a.isFunded && !a.lastTxHash) {
        txEl.textContent = 'offline sim';
        txEl.style.color = 'var(--text-dim)';
    }

    // Inventory
    const invEl = document.getElementById(`agent-inv-${i}`);
    if (invEl) {
        const inv = Object.entries(a.inventory).map(([k, v]) => `${k}:${v}`).join(' ');
        invEl.textContent = inv || '—';
    }

    // Stage progress pips
    if (barEl) {
        const stageIdx = STAGE_ORDER.indexOf(a.stage);
        const pips     = barEl.querySelectorAll('.stage-pip');
        pips.forEach((pip, idx) => {
            pip.classList.toggle('filled', idx <= stageIdx);
            pip.style.background = idx <= stageIdx ? color : '';
        });
    }
}

function renderChat() {
    const container = document.getElementById('chat-log');
    if (!container) return;
    container.innerHTML = '';

    if (chatHistory.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#4a6a80;font-size:11px;text-align:center;padding:16px 0;';
        empty.textContent = 'Agents haven\'t spoken yet...';
        container.appendChild(empty);
        return;
    }

    chatHistory.forEach(entry => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

        const header = document.createElement('div');
        header.style.cssText = `font-size:9px;color:${entry.color};font-weight:700;letter-spacing:0.05em;display:flex;align-items:center;gap:5px;`;
        const time = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        header.innerHTML = `<span style="opacity:.5">${time}</span> <span>${entry.name}</span>${entry.isFallback ? '<span style="color:#ff8c42;font-size:8px"> 🤖FB</span>' : ''}`;

        const bubble = document.createElement('div');
        bubble.style.cssText = `background:rgba(255,255,255,0.06);border:1px solid ${entry.color}33;border-radius:4px;padding:5px 8px;font-size:10px;color:#c8daea;line-height:1.4;font-family:"Fira Code",monospace;`;
        bubble.textContent = entry.msg;

        row.appendChild(header);
        row.appendChild(bubble);
        container.appendChild(row);
    });
}

function renderLog() {
    if (!state || !state.logs) return;
    dom.eventLog.innerHTML = '';

    const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';

    let entries = [...state.logs];
    if (activeFilter === 'evolve') {
        entries = entries.filter(e => e.text.includes('EVOLVED') || e.text.includes('★'));
    } else if (activeFilter === 'action') {
        entries = entries.filter(e => e.text.includes('moved') || e.text.includes('collected'));
    }

    entries.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.style.color = entry.color;
        const time = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        div.textContent = `[${time}] ${entry.text}`;
        dom.eventLog.appendChild(div);
    });
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────
dom.btnReset?.addEventListener('click', () => {
    fetch(`${API_URL}/reset`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: SESSION_API_KEY })
    });
});

document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'r') {
        fetch(`${API_URL}/reset`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: SESSION_API_KEY })
        });
    }
    if (e.key === 'Escape') {
        window.location.href = 'index.html';
    }
});

// ─── INIT ────────────────────────────────────────────────────────────────────

// If there's a saved API key, ensure the backend has it.
// This handles cases where the server restarted after the simulation started.
async function syncApiKeyToBackend() {
    if (!SESSION_API_KEY) return;
    try {
        const res = await fetch(`${API_URL}/state`);
        if (!res.ok) return;
        const st = await res.json();
        // Only re-send if backend is in fallback mode (no key set)
        if (st.isFallbackMode) {
            const model = sessionStorage.getItem('evolu_model') || '';
            await fetch(`${API_URL}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: SESSION_API_KEY, model })
            });
            console.log('[EVOLU-A] API key re-synced to backend.');
        }
    } catch (e) {
        console.warn('[EVOLU-A] Could not sync API key:', e);
    }
}

// ─── INLINE API KEY APPLY ────────────────────────────────────────────────────
const inlineApplyBtn = document.getElementById('inlineApplyKey');
const inlineKeyInput = document.getElementById('inlineApiKey');

if (inlineApplyBtn && inlineKeyInput) {
    // Pre-fill from sessionStorage if available
    if (SESSION_API_KEY) inlineKeyInput.value = SESSION_API_KEY;

    const applyKey = async () => {
        const key = inlineKeyInput.value.trim();
        if (!key || key.length < 5) return;
        inlineApplyBtn.textContent = '...';
        try {
            const r = await fetch(`${API_URL}/setkey`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key })
            });
            if (r.ok) {
                sessionStorage.setItem('evolu_apiKey', key);
                inlineApplyBtn.textContent = '✓ Aktif!';
                inlineApplyBtn.style.background = '#4bd77d';
                // Banner will auto-hide on next state poll (isFallbackMode = false)
                setTimeout(() => {
                    inlineApplyBtn.textContent = 'Apply ✓';
                    inlineApplyBtn.style.background = 'var(--amber)';
                }, 2000);
            } else {
                inlineApplyBtn.textContent = '✗ Error';
                setTimeout(() => { inlineApplyBtn.textContent = 'Apply ✓'; }, 2000);
            }
        } catch {
            inlineApplyBtn.textContent = '✗ No connection';
            setTimeout(() => { inlineApplyBtn.textContent = 'Apply ✓'; }, 2000);
        }
    };

    inlineApplyBtn.addEventListener('click', applyKey);
    inlineKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyKey(); });
}

syncApiKeyToBackend();
pollingInterval = setInterval(fetchState, 400);
fetchState();
requestAnimationFrame(renderCanvas);
