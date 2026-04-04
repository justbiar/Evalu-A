/**
 * EVOLU-A — Landing Page JS
 * Sepolia EVM + x402 payment protocol
 */

// Use relative API path so it works seamlessly on Render
const API_URL       = "/api";
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
        kind: ['resource-wood', 'resource-stone', 'resource-food', 'resource-gold'][Math.floor(Math.random() * 4)]
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
const STAGE_NAMES = ['Collector', 'Merchant', 'Producer', 'Legend'];
const agentNames = ['evo', 'Agent 2', 'Agent 3'];
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

// ─── LAUNCH MODAL ────────────────────────────────────────────────────────────
const AGENT_COLORS  = ['#00e5c8', '#5a8cff', '#ffb800', '#ff8c42', '#ff4b55'];
const AGENT_DEFAULTS = ['evo', 'Agent 2', 'Agent 3', 'Agent 4', 'Agent 5'];

function buildAgentList() {
    const list = document.getElementById('lmAgentList');
    if (!list) return;
    list.innerHTML = AGENT_DEFAULTS.map((name, i) => `
        <div class="launch-agent-row">
            <div class="launch-agent-icon" style="--col:${AGENT_COLORS[i]}">A${i+1}</div>
            <input type="text" class="lm-agent-name" value="${name}" placeholder="${name}" maxlength="12">
            <span class="agent-config-wallet" style="font-size:10px;opacity:0.6">OWS</span>
        </div>
    `).join('');
}

function showLaunchStep(n) {
    [1,2,3].forEach(i => {
        const el = document.getElementById(`launchStep${i}`);
        if (el) el.classList.toggle('hidden', i !== n);
    });
}

function openLaunchModal() {
    buildAgentList();
    renderLaunchWalletBox();
    showLaunchStep(1);
    document.getElementById('launchModalOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('lm-mission-name')?.focus(), 100);
}

function closeLaunchModal() {
    document.getElementById('launchModalOverlay').classList.add('hidden');
}

// Toggle eye button
document.getElementById('lmToggleApiKey')?.addEventListener('click', () => {
    const inp = document.getElementById('lm-api-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
});

// API key live hint
document.getElementById('lm-api-key')?.addEventListener('input', function() {
    const hint = document.getElementById('lmApiStatus');
    if (!hint) return;
    if (this.value.trim().length > 10) {
        hint.textContent = '✓ API key set — real LLM decisions enabled';
        hint.style.color = '#4bd77d';
    } else {
        hint.textContent = 'No API key — agents will use fallback (random) mode';
        hint.style.color = '';
    }
});

document.getElementById('launchModalClose')?.addEventListener('click', closeLaunchModal);
document.getElementById('launchModalCancel')?.addEventListener('click', closeLaunchModal);
document.getElementById('launchRetry')?.addEventListener('click', () => {
    document.getElementById('launchModalConfirm').disabled = false;
    showLaunchStep(1);
});

// Close on overlay click
document.getElementById('launchModalOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('launchModalOverlay')) closeLaunchModal();
});

document.getElementById('launchModalConfirm')?.addEventListener('click', async function() {
    this.disabled = true;
    const missionName     = document.getElementById('lm-mission-name')?.value.trim() || 'My Mission';
    const createdBy       = document.getElementById('lm-creator')?.value.trim() || 'Anonymous';
    const apiKey          = document.getElementById('lm-api-key')?.value.trim() || '';
    const model           = document.getElementById('lm-model')?.value || 'meta-llama/llama-3.2-3b-instruct:free';
    const agentNameValues = [...document.querySelectorAll('.lm-agent-name')].map(i => i.value.trim() || i.placeholder);
    const faucetPrivateKey = activeWallet?.pk || null;

    showLaunchStep(2);

    try {
        const statusMsg = document.getElementById('launchStatusMsg');
        if (statusMsg) statusMsg.textContent = faucetPrivateKey
            ? `Funding agents from ${activeWallet.name}...`
            : 'Preparing simulated wallets...';

        const createRes = await fetch(`${API_URL}/missions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: missionName, createdBy, apiKey, model, faucetPrivateKey, agentNames: agentNameValues })
        });

        if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${createRes.status}`);
        }

        const { id: missionId } = await createRes.json();
        if (statusMsg) statusMsg.textContent = 'Starting agents...';

        await fetch(`${API_URL}/missions/${missionId}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, agentNames: agentNameValues })
        });

        sessionStorage.setItem('evolu_apiKey', apiKey);
        sessionStorage.setItem('evolu_model', model);
        sessionStorage.setItem('evolu_missionId', missionId);

        window.location.href = `game.html?mission=${missionId}`;
    } catch (err) {
        const errEl = document.getElementById('launchErrorMsg');
        if (errEl) errEl.textContent = err.message || 'Launch failed. Check server connection.';
        showLaunchStep(3);
        document.getElementById('launchModalConfirm').disabled = false;
    }
});

// ─── LAUNCH BUTTON → open modal ──────────────────────────────────────────────
const btnLaunch = document.getElementById('btn-launch');
btnLaunch.addEventListener('click', openLaunchModal);

// ─── LOBBY COUNT ─────────────────────────────────────────────────────────────
async function updateLobbyCount() {
    try {
        const res  = await fetch(`${API_URL}/missions`);
        if (!res.ok) return;
        const list = await res.json();
        const countEl = document.getElementById('lobbyCount');
        if (countEl) countEl.textContent = list.length;
    } catch { /* silent */ }
}
updateLobbyCount();
setInterval(updateLobbyCount, 5000);

// ─── ACTIVE WALLET STATE ─────────────────────────────────────────────────────
// { walletId, name, address, pk }  — sessionStorage'da saklanır
let activeWallet = JSON.parse(sessionStorage.getItem('evolu_wallet') || 'null');

function saveActiveWallet(w) {
    activeWallet = w;
    sessionStorage.setItem('evolu_wallet', JSON.stringify(w));
    renderLaunchWalletBox();
    renderWalletCard();
}

function disconnectWallet() {
    activeWallet = null;
    sessionStorage.removeItem('evolu_wallet');
    renderLaunchWalletBox();
    renderWalletCard();
}

function renderLaunchWalletBox() {
    const box = document.getElementById('lmWalletBox');
    if (!box) return;
    if (activeWallet) {
        box.innerHTML = `
            <div class="lm-wallet-active">
                <div class="lm-wallet-indicator funded"></div>
                <div class="lm-wallet-info">
                    <span class="lm-wallet-name">${escHtml(activeWallet.name)}</span>
                    <span class="lm-wallet-addr mono">${activeWallet.address.slice(0,10)}...${activeWallet.address.slice(-6)}</span>
                </div>
                <button class="lm-wallet-change" id="lmBtnChangeWallet">Change</button>
            </div>
            <div class="launch-hint" style="color:#4bd77d">⚡ Real Sepolia ETH — on-chain transactions enabled</div>`;
        document.getElementById('lmBtnChangeWallet')?.addEventListener('click', () => {
            closeLaunchModal();
            openOwsModal();
        });
    } else {
        box.innerHTML = `
            <div class="lm-wallet-active">
                <div class="lm-wallet-indicator empty"></div>
                <div class="lm-wallet-info">
                    <span class="lm-wallet-name" style="color:var(--text-muted)">No wallet linked</span>
                    <span class="lm-wallet-addr" style="font-size:10px;color:var(--text-muted)">Simulated balance mode</span>
                </div>
                <button class="lm-wallet-change" id="lmBtnCreateWallet">+ Create</button>
            </div>
            <div class="launch-hint">No wallet — agents will use simulated ETH balance</div>`;
        document.getElementById('lmBtnCreateWallet')?.addEventListener('click', () => {
            closeLaunchModal();
            openOwsModal();
        });
    }
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── WALLET CARD (sağ panel) ─────────────────────────────────────────────────
function renderWalletCard() {
    const empty     = document.getElementById('walletCardEmpty');
    const connected = document.getElementById('walletCardConnected');
    if (!empty || !connected) return;

    if (!activeWallet) {
        empty.classList.remove('hidden');
        connected.classList.add('hidden');
        return;
    }

    empty.classList.add('hidden');
    connected.classList.remove('hidden');

    // İsim + adres
    const nameEl = document.getElementById('wcName');
    const addrEl = document.getElementById('wcAddress');
    if (nameEl) nameEl.textContent = activeWallet.name;
    if (addrEl) addrEl.textContent = activeWallet.address.slice(0,10) + '...' + activeWallet.address.slice(-6);

    // Etherscan link
    const ethLink = document.getElementById('wcEtherscan');
    if (ethLink) ethLink.href = `https://sepolia.etherscan.io/address/${activeWallet.address}`;

    // PK gizle
    const pkReveal = document.getElementById('wcPkReveal');
    if (pkReveal) pkReveal.classList.add('hidden');

    // PK yoksa (eski session) key butonu disabled
    const keyBtn = document.getElementById('wcBtnShowKey');
    if (keyBtn) keyBtn.disabled = !activeWallet.pk;

    // Dot: funded/unknown
    const dot = document.getElementById('wcDot');
    if (dot) dot.className = 'wc-dot'; // reset, balance refresh güncelleyecek

    // Bakiyeyi çek
    refreshWalletCardBalance();
}

async function refreshWalletCardBalance() {
    if (!activeWallet) return;
    const balEl     = document.getElementById('wcBalance');
    const dot       = document.getElementById('wcDot');
    const statusTxt = document.getElementById('wcStatusText');
    if (balEl) balEl.textContent = '...';

    try {
        const res  = await fetch(`${API_URL}/balance/${activeWallet.address}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (balEl) balEl.textContent = `${data.balance} ETH`;

        if (data.sufficient) {
            if (dot)       { dot.className = 'wc-dot funded'; }
            if (statusTxt) statusTxt.textContent = 'Funded ⚡';
        } else {
            if (dot)       { dot.className = 'wc-dot low'; }
            if (statusTxt) statusTxt.textContent = `Need ${data.minEth} ETH min`;
        }
    } catch {
        if (balEl)     balEl.textContent = '— ETH';
        if (statusTxt) statusTxt.textContent = 'RPC error';
    }
}

// Wallet card event listeners
document.getElementById('wcBtnDisconnect')?.addEventListener('click', () => {
    if (confirm('Disconnect wallet? Private key will be removed from this session.')) {
        disconnectWallet();
    }
});

document.getElementById('wcBtnRefresh')?.addEventListener('click', refreshWalletCardBalance);

document.getElementById('wcBtnCopyAddr')?.addEventListener('click', () => {
    if (!activeWallet) return;
    navigator.clipboard.writeText(activeWallet.address).then(() => {
        const btn = document.getElementById('wcBtnCopyAddr');
        if (btn) { const orig = btn.innerHTML; btn.textContent = '✓ Copied'; setTimeout(() => btn.innerHTML = orig, 1500); }
    });
});

let pkVisible = false;
document.getElementById('wcBtnShowKey')?.addEventListener('click', () => {
    if (!activeWallet?.pk) return;
    const reveal = document.getElementById('wcPkReveal');
    const pkText = document.getElementById('wcPkText');
    const btn    = document.getElementById('wcBtnShowKey');
    if (!reveal) return;

    pkVisible = !pkVisible;
    if (pkVisible) {
        if (pkText) pkText.textContent = activeWallet.pk;
        reveal.classList.remove('hidden');
        if (btn) btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Hide Key`;
    } else {
        reveal.classList.add('hidden');
        if (btn) btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Private Key`;
    }
});

document.getElementById('wcBtnCopyKey')?.addEventListener('click', () => {
    if (!activeWallet?.pk) return;
    navigator.clipboard.writeText(activeWallet.pk).then(() => {
        const btn = document.getElementById('wcBtnCopyKey');
        if (btn) { const orig = btn.innerHTML; btn.textContent = '✓ Copied'; setTimeout(() => btn.innerHTML = orig, 1500); }
    });
});

// Sayfa yüklenince mevcut wallet'ı göster
renderWalletCard();

// ─── OWS WALLET MODAL ────────────────────────────────────────────────────────
const owsOverlay   = document.getElementById('owsModalOverlay');
const owsClose     = document.getElementById('owsModalClose');
const owsBtnOpen   = document.getElementById('btnCreateWallet');
const owsBtnCancel = document.getElementById('owsBtnCancel');
const owsBtnCreate = document.getElementById('owsBtnCreate');
const owsBtnRetry  = document.getElementById('owsBtnRetry');
const owsNameInput = document.getElementById('owsWalletName');
const owsCodePrev  = document.getElementById('owsCodePreview');

const OWS_STEPS = ['owsStep1', 'owsStep2', 'owsStep3', 'owsStep4', 'owsStep5'];
let currentOwsWalletId  = null;
let currentOwsAddress   = null;
let currentOwsPk        = null;
let balancePollInterval = null;

function showOwsStep(id) {
    OWS_STEPS.forEach(s => document.getElementById(s)?.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
}

function openOwsModal() {
    owsOverlay.classList.remove('hidden');
    showOwsStep('owsStep1');
    if (owsNameInput) owsNameInput.value = '';
    if (owsCodePrev)  owsCodePrev.textContent = 'my-wallet';
    clearInterval(balancePollInterval);
    setTimeout(() => owsNameInput?.focus(), 120);
}

function closeOwsModal() {
    owsOverlay.classList.add('hidden');
    clearInterval(balancePollInterval);
}

owsBtnOpen?.addEventListener('click', openOwsModal);
owsClose?.addEventListener('click', closeOwsModal);
owsBtnCancel?.addEventListener('click', closeOwsModal);
owsBtnRetry?.addEventListener('click', () => showOwsStep('owsStep1'));

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && owsOverlay && !owsOverlay.classList.contains('hidden')) closeOwsModal();
});
owsOverlay?.addEventListener('click', e => { if (e.target === owsOverlay) closeOwsModal(); });
owsNameInput?.addEventListener('input', () => {
    if (owsCodePrev) owsCodePrev.textContent = owsNameInput.value.trim() || 'my-wallet';
});
owsNameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') owsBtnCreate?.click(); });

owsBtnCreate?.addEventListener('click', async () => {
    const name = owsNameInput?.value.trim() || 'my-wallet';
    showOwsStep('owsStep2');
    try {
        const res  = await fetch(`${API_URL}/wallet/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Wallet creation failed');

        currentOwsWalletId = data.walletId;
        currentOwsAddress  = data.address;
        currentOwsPk       = data.pk;

        // Step 3: Private Key göster
        const pkEl = document.getElementById('owsPrivateKey');
        if (pkEl) pkEl.textContent = data.pk;

        // "Kaydettim" checkbox sıfırla
        const savedCheck = document.getElementById('owsPkSavedCheck');
        const continueBtn = document.getElementById('owsBtnPkContinue');
        if (savedCheck) savedCheck.checked = false;
        if (continueBtn) continueBtn.disabled = true;

        // Step 4 (funding) için verileri önceden hazırla
        document.getElementById('owsResultName').textContent     = data.name;
        document.getElementById('owsResultAddress').textContent  = data.address;
        document.getElementById('owsMinEth').textContent         = `${data.minEth} ETH`;
        document.getElementById('owsBalanceAgents').textContent  = `${data.agentCount} agents × 0.003 ETH + gas`;
        document.getElementById('owsCurrentBalance').textContent = '—';
        const explorerLink = document.getElementById('owsExplorerLink');
        if (explorerLink) explorerLink.href = data.explorerUrl;
        const etherscanLink = document.getElementById('owsEtherscanLink');
        if (etherscanLink) etherscanLink.href = data.explorerUrl;
        const activateBtn = document.getElementById('owsBtnActivate');
        if (activateBtn) activateBtn.disabled = true;
        const balStatus = document.getElementById('owsBalanceStatus');
        if (balStatus) balStatus.classList.add('hidden');

        showOwsStep('owsStep3');
    } catch (err) {
        const errMsg = document.getElementById('owsErrorMsg');
        if (errMsg) errMsg.textContent = err.message || 'Connection error. Is the backend running?';
        showOwsStep('owsStep5');
    }
});

// "Kaydettim" checkbox → Continue butonu aktif olsun
document.getElementById('owsPkSavedCheck')?.addEventListener('change', function() {
    const btn = document.getElementById('owsBtnPkContinue');
    if (btn) btn.disabled = !this.checked;
});

// Private key kopyala
document.getElementById('owsCopyPk')?.addEventListener('click', () => {
    const pk = document.getElementById('owsPrivateKey')?.textContent;
    if (!pk || pk === '—') return;
    navigator.clipboard.writeText(pk).then(() => {
        const btn = document.getElementById('owsCopyPk');
        if (btn) {
            btn.style.color = '#4bd77d';
            btn.textContent = '✓ Copied';
            setTimeout(() => {
                btn.style.color = '';
                btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
            }, 2000);
        }
    });
});

// Step 3 → Step 4 (fonlama ekranı)
document.getElementById('owsBtnPkContinue')?.addEventListener('click', () => {
    // PK'yı DOM'dan sil — artık gösterilmeyecek
    const pkEl = document.getElementById('owsPrivateKey');
    if (pkEl) pkEl.textContent = '••••••••••••••••••••••••••••••••••••••••••••••••••••••';
    showOwsStep('owsStep4');
});

// Kopyala butonu
document.getElementById('owsCopyAddr')?.addEventListener('click', () => {
    if (!currentOwsAddress) return;
    navigator.clipboard.writeText(currentOwsAddress).then(() => {
        const btn = document.getElementById('owsCopyAddr');
        if (btn) { btn.style.color = '#4bd77d'; setTimeout(() => btn.style.color = '', 1500); }
    });
});

// Bakiye kontrol — adres üzerinden direkt (registry/restart bağımsız)
async function checkOwsBalance() {
    if (!currentOwsAddress) return;
    const btn         = document.getElementById('owsBtnCheckBalance');
    const valEl       = document.getElementById('owsCurrentBalance');
    const statusEl    = document.getElementById('owsBalanceStatus');
    const activateBtn = document.getElementById('owsBtnActivate');

    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res  = await fetch(`${API_URL}/balance/${currentOwsAddress}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (valEl) valEl.textContent = `${data.balance} ETH`;

        if (data.sufficient) {
            if (statusEl) {
                statusEl.textContent = `✓ Balance sufficient — ready to launch!`;
                statusEl.style.color = '#4bd77d';
                statusEl.classList.remove('hidden');
            }
            if (activateBtn) activateBtn.disabled = false;
        } else {
            const needed = (parseFloat(data.minEth) - parseFloat(data.balance)).toFixed(4);
            if (statusEl) {
                statusEl.textContent = `Need ${needed} more ETH (min: ${data.minEth} ETH)`;
                statusEl.style.color = '#ff8c42';
                statusEl.classList.remove('hidden');
            }
            if (activateBtn) activateBtn.disabled = true;
        }
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `Check failed: ${err.message.slice(0, 40)}`;
            statusEl.style.color = '#ff4b55';
            statusEl.classList.remove('hidden');
        }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.65"/></svg> Check'; }
    }
}

document.getElementById('owsBtnCheckBalance')?.addEventListener('click', checkOwsBalance);

// "Use This Wallet" — wallet'ı aktif et, modal'ı kapat
document.getElementById('owsBtnActivate')?.addEventListener('click', () => {
    if (!currentOwsWalletId || !currentOwsAddress) return;
    const name = document.getElementById('owsResultName')?.textContent || 'my-wallet';
    // PK'yı da sakla — sonradan erişim için
    saveActiveWallet({ walletId: currentOwsWalletId, name, address: currentOwsAddress, pk: currentOwsPk });
    closeOwsModal();
});
