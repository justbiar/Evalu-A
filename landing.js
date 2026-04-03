/**
 * EVOLU-A — Landing Page JS
 * Sepolia EVM + x402 payment protocol
 */

const API_URL       = "http://localhost:3000";
const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

// ─── BG CANVAS ───────────────────────────────────────────────────────────────
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');

let particles = [];
let gridLines = [];

function resizeBg() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    initGridLines();
}

function initGridLines() {
    gridLines = [];
    const spacing = 60;
    for (let x = 0; x < bgCanvas.width; x += spacing) {
        gridLines.push({ x, y: 0, horizontal: false, opacity: Math.random() * 0.3 + 0.05 });
    }
    for (let y = 0; y < bgCanvas.height; y += spacing) {
        gridLines.push({ x: 0, y, horizontal: true, opacity: Math.random() * 0.3 + 0.05 });
    }
}

function initParticles() {
    particles = [];
    for (let i = 0; i < 60; i++) {
        particles.push({
            x: Math.random() * bgCanvas.width,
            y: Math.random() * bgCanvas.height,
            size: Math.random() * 2 + 0.5,
            speed: Math.random() * 0.4 + 0.1,
            opacity: Math.random() * 0.5 + 0.1,
            hue: Math.random() > 0.5 ? 174 : 43, // teal or amber
        });
    }
}

function animateBg(ts) {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    // Grid
    bgCtx.lineWidth = 0.5;
    gridLines.forEach(l => {
        bgCtx.strokeStyle = `rgba(0, 229, 200, ${l.opacity})`;
        bgCtx.beginPath();
        if (l.horizontal) {
            bgCtx.moveTo(0, l.y); bgCtx.lineTo(bgCanvas.width, l.y);
        } else {
            bgCtx.moveTo(l.x, 0); bgCtx.lineTo(l.x, bgCanvas.height);
        }
        bgCtx.stroke();
    });

    // Particles
    particles.forEach(p => {
        bgCtx.beginPath();
        bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        bgCtx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.opacity})`;
        bgCtx.fill();
        p.y -= p.speed;
        if (p.y < -5) { p.y = bgCanvas.height + 5; p.x = Math.random() * bgCanvas.width; }
    });

    // Occasional scan line
    const scanY = (ts * 0.05) % bgCanvas.height;
    const gradient = bgCtx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
    gradient.addColorStop(0, 'rgba(0,229,200,0)');
    gradient.addColorStop(0.5, 'rgba(0,229,200,0.04)');
    gradient.addColorStop(1, 'rgba(0,229,200,0)');
    bgCtx.fillStyle = gradient;
    bgCtx.fillRect(0, scanY - 40, bgCanvas.width, 80);

    requestAnimationFrame(animateBg);
}

window.addEventListener('resize', () => { resizeBg(); initParticles(); });
resizeBg();
initParticles();
requestAnimationFrame(animateBg);

// ─── MINI PREVIEW GRID ────────────────────────────────────────────────────────
const COLS = 16, ROWS = 12;
const gridEl = document.getElementById('miniGrid');

// Build cells
for (let i = 0; i < COLS * ROWS; i++) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    cell.id = `gc-${i}`;
    gridEl.appendChild(cell);
}

// Mock data animation
const mockAgents = [
    { x: 3, y: 2, col: '#00e5c8' },
    { x: 9, y: 7, col: '#5a8cff' },
    { x: 13, y: 4, col: '#ffb800' },
];

const mockResources = [];
for (let i = 0; i < 20; i++) {
    mockResources.push({
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
        kind: ['resource-odun', 'resource-tas', 'resource-yiyecek'][Math.floor(Math.random() * 3)]
    });
}

function updateMiniGrid() {
    // Reset all cells
    for (let i = 0; i < COLS * ROWS; i++) {
        const c = document.getElementById(`gc-${i}`);
        c.className = 'grid-cell';
        c.style.background = '';
        c.style.boxShadow = '';
    }

    // Resources
    mockResources.forEach(r => {
        if (r.x < COLS && r.y < ROWS) {
            const c = document.getElementById(`gc-${r.y * COLS + r.x}`);
            if (c) c.className = `grid-cell ${r.kind}`;
        }
    });

    // Agents
    mockAgents.forEach(a => {
        if (a.x < COLS && a.y < ROWS) {
            const c = document.getElementById(`gc-${a.y * COLS + a.x}`);
            if (c) {
                c.className = 'grid-cell agent-cell';
                c.style.background = a.col;
                c.style.boxShadow = `0 0 8px ${a.col}`;
            }
        }
    });
}

function moveMockAgents() {
    mockAgents.forEach(a => {
        const dir = Math.floor(Math.random() * 4);
        if (dir === 0 && a.y > 0) a.y--;
        else if (dir === 1 && a.y < ROWS - 1) a.y++;
        else if (dir === 2 && a.x > 0) a.x--;
        else if (dir === 3 && a.x < COLS - 1) a.x++;
    });
    updateMiniGrid();
}

updateMiniGrid();
setInterval(moveMockAgents, 800);

// Preview agents panel
const previewAgents = document.getElementById('previewAgents');
const STAGE_NAMES = ['Toplayıcı', 'Tüccar', 'Üretici', 'Efsane'];
const agentNames = ['evo', 'Ajan 2', 'Ajan 3'];
const agentCols = ['#00e5c8', '#5a8cff', '#ffb800'];

agentNames.forEach((name, i) => {
    const div = document.createElement('div');
    div.className = 'mini-agent';
    div.id = `mini-agent-${i}`;
    div.innerHTML = `
        <div class="mini-agent-name" style="color:${agentCols[i]}">${name}</div>
        <div class="mini-agent-stage">${STAGE_NAMES[0]}</div>
    `;
    previewAgents.appendChild(div);
});

// ─── BACKEND CHECK ───────────────────────────────────────────────────────────
async function checkBackend() {
    const statusEl = document.getElementById('backendStatus');
    const dotEl = document.getElementById('backendDot');
    const textEl = document.getElementById('backendText');

    try {
        const res = await fetch(`${API_URL}/state`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
            if (statusEl) { statusEl.textContent = 'Online ✓'; statusEl.className = 'param-value mono active'; }
            if (dotEl)    dotEl.className = 'status-dot teal';
            if (textEl)   textEl.textContent = 'Backend is running — ready to launch!';
        } else {
            throw new Error('bad');
        }
    } catch {
        if (statusEl) { statusEl.textContent = 'Offline'; statusEl.className = 'param-value mono error'; }
        if (dotEl)    dotEl.className = 'status-dot error';
        if (textEl)   textEl.textContent = 'Backend offline — run: node server.js';
    }
}

checkBackend();
setInterval(checkBackend, 5000);

// ─── API KEY TOGGLE ───────────────────────────────────────────────────────────
const toggleBtn = document.getElementById('toggleKey');
const apiInput = document.getElementById('api-key-input');
let keyVisible = false;

toggleBtn.addEventListener('click', () => {
    keyVisible = !keyVisible;
    apiInput.type = keyVisible ? 'text' : 'password';
});

apiInput.addEventListener('input', () => {
    const apiStatus = document.getElementById('api-status');
    const haKey = apiInput.value.trim().length > 10;
    apiStatus.innerHTML = haKey
        ? `<div class="status-dot active"></div><span>API key configured — LLM decisions enabled</span>`
        : `<div class="status-dot dim"></div><span>Not configured — fallback mode</span>`;
});

// ─── LAUNCH ──────────────────────────────────────────────────────────────────
const btnLaunch = document.getElementById('btn-launch');

btnLaunch.addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const model = document.getElementById('model-select').value;

    // Read agent names from inputs
    const agentInputs = [...document.querySelectorAll('.agent-name-input')];
    const agentNameValues = agentInputs.map(i => i.value.trim() || i.placeholder);

    btnLaunch.disabled = true;
    btnLaunch.querySelector('.btn-launch-text').textContent = 'Launching...';

    try {
        // Send start to backend
        const res = await fetch(`${API_URL}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                apiKey, 
                model,
                agentNames: agentNameValues 
            })
        });

        if (res.ok) {
            sessionStorage.setItem('evolu_apiKey', apiKey);
            sessionStorage.setItem('evolu_model', model);
            sessionStorage.setItem('evolu_agents', JSON.stringify(agentNameValues));
            window.location.href = 'game.html';
        } else {
            throw new Error('Failed to start');
        }
    } catch (err) {
        btnLaunch.disabled = false;
        btnLaunch.querySelector('.btn-launch-text').textContent = 'Backend Offline — Start server first';
        setTimeout(() => {
            btnLaunch.querySelector('.btn-launch-text').textContent = 'Launch Simulation';
        }, 3000);
    }
});

// ─── OWS CREATE WALLET MODAL ─────────────────────────────────────────────────
const owsOverlay   = document.getElementById('owsModalOverlay');
const owsClose     = document.getElementById('owsModalClose');
const owsBtnOpen   = document.getElementById('btnCreateWallet');
const owsBtnCancel = document.getElementById('owsBtnCancel');
const owsBtnCreate = document.getElementById('owsBtnCreate');
const owsBtnDone   = document.getElementById('owsBtnDone');
const owsBtnRetry  = document.getElementById('owsBtnRetry');
const owsNameInput = document.getElementById('owsWalletName');
const owsCodePrev  = document.getElementById('owsCodePreview');

const OWS_STEPS = ['owsStep1', 'owsStep2', 'owsStep3', 'owsStep4'];

function showOwsStep(id) {
    OWS_STEPS.forEach(s => document.getElementById(s)?.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
}

function openOwsModal() {
    owsOverlay.classList.remove('hidden');
    showOwsStep('owsStep1');
    if (owsNameInput) { owsNameInput.value = ''; }
    if (owsCodePrev)  { owsCodePrev.textContent = 'my-agent'; }
    setTimeout(() => owsNameInput?.focus(), 120);
}

function closeOwsModal() { owsOverlay.classList.add('hidden'); }

owsBtnOpen?.addEventListener('click', openOwsModal);
owsClose?.addEventListener('click', closeOwsModal);
owsBtnCancel?.addEventListener('click', closeOwsModal);
owsBtnDone?.addEventListener('click', closeOwsModal);
owsBtnRetry?.addEventListener('click', () => showOwsStep('owsStep1'));

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && owsOverlay && !owsOverlay.classList.contains('hidden')) closeOwsModal();
});

owsOverlay?.addEventListener('click', e => { if (e.target === owsOverlay) closeOwsModal(); });

owsNameInput?.addEventListener('input', () => {
    if (owsCodePrev) owsCodePrev.textContent = owsNameInput.value.trim() || 'my-agent';
});

owsNameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') owsBtnCreate?.click(); });

owsBtnCreate?.addEventListener('click', async () => {
    const name = owsNameInput?.value.trim() || 'my-agent';
    showOwsStep('owsStep2');

    try {
        const res = await fetch(`${API_URL}/wallet/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Wallet creation failed');

        document.getElementById('owsResultName').textContent    = data.name;
        document.getElementById('owsResultAddress').textContent = data.address;

        // Show network badge
        const netBadge = document.getElementById('owsResultNetwork');
        if (netBadge) netBadge.textContent = `Sepolia (chain ${data.chainId})`;

        const explorerLink = document.getElementById('owsExplorerLink');
        if (explorerLink) {
            explorerLink.href = data.explorerUrl || `${ETHERSCAN_BASE}/address/${data.address}`;
            explorerLink.textContent = 'Etherscan\'da Gör ↗';
        }

        showOwsStep('owsStep3');
    } catch (err) {
        const errMsg = document.getElementById('owsErrorMsg');
        if (errMsg) errMsg.textContent = err.message || 'Bağlantı hatası. Backend çalışıyor mu?';
        showOwsStep('owsStep4');
    }
});
