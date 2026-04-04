import express from 'express';
console.log("[DEBUG] Starting server.js execution...");
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
    createPublicClient,
    createWalletClient,
    http,
    parseEther,
    formatEther,
} from 'viem';
import { sepolia } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
// Büyük PNG dosyaları için manuel route — express.static'ten ÖNCE olmalı
app.use((req, res, next) => {
    const decoded = decodeURIComponent(req.path);
    let filePath = null;
    const robotM  = decoded.match(/^\/robot level\/(\d+\.png)$/);
    const assetsM = decoded.match(/^\/assets\/([\w\-]+\.png)$/);
    if (robotM)  filePath = path.join(__dirname, 'robot level', robotM[1]);
    else if (assetsM) filePath = path.join(__dirname, 'assets', assetsM[1]);
    if (!filePath || !fs.existsSync(filePath)) return next();
    const buf = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
});

app.use(express.static(path.join(__dirname, '.')));

// ─────────────────────────────────────────────────────────────────────────────
// EVM / SEPOLIA CONNECTION
// ─────────────────────────────────────────────────────────────────────────────
const SEPOLIA_RPC    = process.env.SEPOLIA_RPC_URL || 'https://sepolia.drpc.org';
const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';
const CHAIN_ID       = 11155111; // Sepolia

const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
});

// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    model:             "meta-llama/llama-3.2-3b-instruct:free",
    movementCostETH:   '0.00001',
    evolutionCostETH:  '0.0005',
    startingBudgetETH: '0.003',
    agentCount:        5,
    gridW: 20, gridH: 20,
    resourceCount: 80,
    maxLogLines: 80,
    maxMissions: 20,
    missionTTL: 2 * 60 * 60 * 1000, // 2 saat sonra temizle
};

const STAGE_ORDER = ["Collector", "Merchant", "Producer", "Legend"];

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER (per-mission)
// ─────────────────────────────────────────────────────────────────────────────
class Logger {
    constructor() { this.entries = []; }
    log(msg, colorHex = "#c3d2e6") {
        this.entries.unshift({ text: msg, color: colorHex, ts: new Date().toISOString() });
        if (this.entries.length > CONFIG.maxLogLines) this.entries.pop();
        console.log(`[LOG] ${msg}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD
// ─────────────────────────────────────────────────────────────────────────────
class World {
    constructor(logger) {
        this.logger = logger;
        const pk = generatePrivateKey();
        this.treasuryAccount    = privateKeyToAccount(pk);
        this.treasuryAddress    = this.treasuryAccount.address;
        this.contractBalanceWei = 0n;
        this.resources = [];
        this.spawnResources(CONFIG.resourceCount);
        console.log(`[World] Treasury: ${this.treasuryAddress}`);
    }

    get contractBalance() { return parseFloat(formatEther(this.contractBalanceWei)); }

    spawnResources(_count) {
        this.resources = [];
        const kinds = [
            { id: 'wood',    weight: 45 },
            { id: 'stone',   weight: 30 },
            { id: 'food',    weight: 20 },
            { id: 'gold',    weight: 4  },
            { id: 'crystal', weight: 1  }
        ];
        for (let i = 0; i < CONFIG.resourceCount; i++) {
            let rnd = Math.random() * 100;
            let current = 0;
            let selectedKind = 'wood';
            for (let k of kinds) {
                current += k.weight;
                if (rnd <= current) { selectedKind = k.id; break; }
            }
            this.resources.push({
                x: Math.floor(Math.random() * CONFIG.gridW),
                y: Math.floor(Math.random() * CONFIG.gridH),
                kind: selectedKind
            });
        }
    }

    resourcesAt(x, y)    { return this.resources.filter(r => r.x === x && r.y === y); }
    popResource(res)      { this.resources = this.resources.filter(r => r !== res); }
    inBounds(x, y)        { return x >= 0 && x < CONFIG.gridW && y >= 0 && y < CONFIG.gridH; }
    nearbyResources(x, y, radius = 3) {
        return this.resources
            .filter(r => Math.abs(r.x - x) <= radius && Math.abs(r.y - y) <= radius)
            .map(r => ({ kind: r.kind, x: r.x, y: r.y }))
            .slice(0, 6);
    }

    async returnTreasuryToFaucet(faucetAddress) {
        const onChain = await publicClient.getBalance({ address: this.treasuryAddress });
        if (onChain === 0n) return;

        const treasuryWalletClient = createWalletClient({
            account:   this.treasuryAccount,
            chain:     sepolia,
            transport: http(SEPOLIA_RPC),
        });

        const feeData  = await publicClient.estimateFeesPerGas();
        const gasCost  = 21000n * (feeData.maxFeePerGas + feeData.maxPriorityFeePerGas);
        const sendable = onChain - gasCost;
        if (sendable <= 0n) return;

        try {
            const hash = await treasuryWalletClient.sendTransaction({
                to:    faucetAddress,
                value: sendable,
                gas:   21000n,
            });
            this.logger.log(`↩ Treasury: ${formatEther(sendable)} ETH returned to faucet → ${hash.slice(0,14)}...`, "#5a8cff");
            this.contractBalanceWei = 0n;
        } catch (err) {
            this.logger.log(`⚠️ Treasury refund failed: ${err.message.slice(0, 40)}`, "#ff4b55");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT
// ─────────────────────────────────────────────────────────────────────────────
class Agent {
    constructor(name, x, y, world) {
        this.name  = name;
        this.x     = x;
        this.y     = y;
        this.world = world;

        this.privateKey   = generatePrivateKey();
        this.account      = privateKeyToAccount(this.privateKey);
        this.evmAddress   = this.account.address;
        this.walletClient = createWalletClient({
            account:   this.account,
            chain:     sepolia,
            transport: http(SEPOLIA_RPC),
        });

        this.balanceWei = 0n;
        this.isFunded   = false;

        this.stage     = "Collector";
        this.inventory = {};
        this.alive     = true;
        this.hp        = 100;
        this.allies    = [];
        this.message   = "";
        this.messageTs = 0;

        this.isThinking = false;
        this.isFallback = false;
        this.lastAction = "Spawned";
        this.lastTxHash = null;

        console.log(`[Agent:${name}] EVM Address: ${this.evmAddress}`);
    }

    get balance()     { return parseFloat(formatEther(this.balanceWei)); }
    get stageLevel()  { return STAGE_ORDER.indexOf(this.stage); }
    get logger()      { return this.world.logger; }
    get faucetPk()    { return this.world.engine?.faucetPk || null; }

    // ── FUNDING ──────────────────────────────────────────────────────────────
    async requestFunding() {
        const faucetPk = this.faucetPk;

        if (!faucetPk) {
            // Faucet key yok — offline (simüle) mod
            this.balanceWei = parseEther(CONFIG.startingBudgetETH);
            this.isFunded   = false;
            this.logger.log(`💰 ${this.name}: ${CONFIG.startingBudgetETH} ETH simulated (offline mode)`, "#00e5c8");
            return false;
        }

        try {
            const faucetAccount = privateKeyToAccount(faucetPk);
            const faucetBal     = await publicClient.getBalance({ address: faucetAccount.address });
            const needed        = parseEther(CONFIG.startingBudgetETH);
            if (faucetBal < needed) {
                this.logger.log(`⚠️ ${this.name}: Faucet balance too low (${formatEther(faucetBal)} ETH) — offline mode`, "#ff8c42");
                this.balanceWei = needed;
                this.isFunded   = false;
                return false;
            }

            this.logger.log(`💧 ${this.name}: Transferring ${CONFIG.startingBudgetETH} ETH from Sepolia faucet...`, "#5a8cff");
            const faucetClient = createWalletClient({
                account:   faucetAccount,
                chain:     sepolia,
                transport: http(SEPOLIA_RPC),
            });

            const hash = await faucetClient.sendTransaction({
                to:    this.evmAddress,
                value: needed,
            });

            await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
            this.balanceWei = await publicClient.getBalance({ address: this.evmAddress });
            this.isFunded   = true;
            this.logger.log(`✅ ${this.name}: ${CONFIG.startingBudgetETH} ETH received! ${this.evmAddress.slice(0,10)}...`, "#4bd77d");
            return true;
        } catch (err) {
            this.logger.log(`⚠️ ${this.name}: Funding failed (${err.message.slice(0, 40)}) — offline mode`, "#ff4b55");
            this.balanceWei = parseEther(CONFIG.startingBudgetETH);
            this.isFunded   = false;
            return false;
        }
    }

    // ── x402 PAYMENT ─────────────────────────────────────────────────────────
    async buildX402PaymentHeader(costWei) {
        const request  = await this.walletClient.prepareTransactionRequest({
            to:    this.world.treasuryAddress,
            value: costWei,
            gas:   21000n,
        });
        const signedTx = await this.walletClient.signTransaction(request);
        const payload  = JSON.stringify({
            x402Version: 1,
            scheme:      'exact-eth',
            network:     `eip155:${CHAIN_ID}`,
            from:        this.evmAddress,
            to:          this.world.treasuryAddress,
            value:       costWei.toString(),
            signedTx,
        });
        return Buffer.from(payload).toString('base64');
    }

    async settleX402Payment(paymentHeader) {
        const raw     = Buffer.from(paymentHeader, 'base64').toString('utf8');
        const payload = JSON.parse(raw);
        if (payload.to.toLowerCase() !== this.world.treasuryAddress.toLowerCase()) throw new Error('x402: wrong recipient');
        if (BigInt(payload.value) < parseEther(CONFIG.movementCostETH) / 2n) throw new Error('x402: insufficient amount');
        return await publicClient.sendRawTransaction({ serializedTransaction: payload.signedTx });
    }

    async payAction(costWei) {
        if (this.isFunded) {
            try {
                const paymentHeader = await this.buildX402PaymentHeader(costWei);
                const txHash        = await this.settleX402Payment(paymentHeader);
                this.lastTxHash     = txHash;
                this.logger.log(`🔗 x402 Tx: ${txHash.slice(0, 14)}... ↗`, "#4a6078");
                this.balanceWei = await publicClient.getBalance({ address: this.evmAddress });
                this.world.contractBalanceWei += costWei;
                return txHash;
            } catch (err) {
                this.logger.log(`⚠️ On-chain tx failed — offline: ${err.message.slice(0, 35)}`, "#ff4b55");
                this._offlineDeduct(costWei);
                return null;
            }
        } else {
            this._offlineDeduct(costWei);
            return null;
        }
    }

    _offlineDeduct(costWei) {
        this.balanceWei = this.balanceWei > costWei ? this.balanceWei - costWei : 0n;
        this.world.contractBalanceWei += costWei;
    }

    // ── LLM DECISION ─────────────────────────────────────────────────────────
    async getLLMDecision(allAgents, apiKey) {
        if (!apiKey) {
            await new Promise(r => setTimeout(r, 400));
            return this._fallbackAction("No API Key");
        }

        const nearbyAgents = allAgents
            .filter(a => a.name !== this.name && a.alive && Math.abs(a.x - this.x) <= 3 && Math.abs(a.y - this.y) <= 3)
            .map(a => ({ name: a.name, pos: `(${a.x},${a.y})`, stage: a.stage, hp: a.hp, isAlly: this.allies.includes(a.name), said: a.message || "" }));

        const prompt = `You are AI agent ${this.name} trying to survive on the Sepolia EVM network.
Status: Pos: (${this.x}, ${this.y}), Balance: ${this.balance.toFixed(6)} ETH, Stage: ${this.stage}, HP: ${this.hp}, Inventory: ${JSON.stringify(this.inventory)}, Allies: ${this.allies.join(",")}
Nearby Resources: ${JSON.stringify(this.world.nearbyResources(this.x, this.y))}
Nearby Agents (with their last message): ${JSON.stringify(nearbyAgents)}
Task: Return valid JSON: {"action": "move|collect|evolve|attack|ally|mate|eat", "direction": "up|down|left|right", "target": "target_name", "message": "Short speech bubble (max 40 chars, can respond to nearby agents)"}
Rules:
- eat: Consume 1 food from inventory to restore 20 HP. Do this when low on health.
- attack: Attack target (reduces HP). If they die, steal their loot.
- ally: Add target to your ally list.
- mate: If on same/adjacent tile, spawn a child agent (costs 0.001 ETH).
- evolve: Requires specific resources per stage (collect wood, stone, gold continuously).
- message: React to nearby agents' messages naturally, like conversation.`;

        try {
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type":  "application/json",
                },
                body: JSON.stringify({
                    model:    CONFIG.model,
                    messages: [
                        { role: "system", content: "Return only valid JSON." },
                        { role: "user",   content: prompt },
                    ],
                    max_tokens:  80,
                    temperature: 0.85,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            let raw = data.choices[0].message.content.trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response");
            return JSON.parse(jsonMatch[0]);
        } catch (err) {
            console.error(`[LLM ERROR for ${this.name}]:`, err.message || err);
            return this._fallbackAction(err.message.substring(0, 30) || "LLM Error");
        }
    }

    _fallbackAction(reason) {
        const msgs = ["Exploring...", "Searching for resources!", "Moving out!", "Scouting the area...", "No signal, going manual", "Grid scanning...", "Resource hunt!"];
        if (this.balance >= parseFloat(CONFIG.evolutionCostETH) && this.stage !== "Legend") {
            return { action: "evolve", _fallback: reason, message: "Evolving! ★" };
        }
        const dirs = ["up", "down", "left", "right"];
        return { action: "move", direction: dirs[Math.floor(Math.random() * dirs.length)], _fallback: reason, message: msgs[Math.floor(Math.random() * msgs.length)] };
    }

    // ── EXECUTE ──────────────────────────────────────────────────────────────
    async execute(action) {
        const act        = action.action || "wait";
        this.message     = action.message || "";
        this.messageTs   = Date.now();
        const target     = action.target || "";
        const isFallback = !!action._fallback;
        this.isFallback  = isFallback;
        const prefix     = isFallback ? `🤖[FB: ${action._fallback.substring(0,20)}] ` : "";

        if (act === "move")    return this._doMove(action.direction || "up", prefix, isFallback);
        if (act === "evolve")  return this._doEvolve(prefix, isFallback);
        if (act === "collect") return this._doCollect(prefix);
        if (act === "eat")     return this._doEat(prefix);
        if (act === "attack")  return this._doAttack(target, prefix);
        if (act === "ally")    return this._doAlly(target, prefix);
        if (act === "mate")    return this._doMate(target, prefix);

        this.lastAction = "Waited";
        return [`${this.name}: Waited.`, "#5a697d"];
    }

    async _doMove(direction, prefix, isFallback = false) {
        const deltas   = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
        const [dx, dy] = deltas[direction] || [0, 0];
        const nx = this.x + dx, ny = this.y + dy;
        const dirIco   = { up:"↑", down:"↓", left:"←", right:"→" }[direction] || direction;
        const logColor = isFallback ? "#ff8c42" : "#c3d2e6";

        if (!this.world.inBounds(nx, ny)) return [`${this.name}: Out of bounds!`, "#5a697d"];

        const costWei = parseEther(CONFIG.movementCostETH);
        if (this.balanceWei < costWei) {
            this.alive      = false;
            this.lastAction = "DEAD";
            return [`💀 ${this.name}: Out of ETH and DIED!`, "#ff4b55"];
        }

        await this.payAction(costWei);
        this.x = nx; this.y = ny;
        this.lastAction = `${dirIco} ${direction}`;
        return [`${prefix}${this.name}: ${dirIco} moved. (${this.balance.toFixed(6)} ETH)`, logColor];
    }

    async _doEvolve(prefix, isFallback = false) {
        const idx      = this.stageLevel;
        const logColor = isFallback ? "#ff8c42" : "#ffc332";
        if (idx >= STAGE_ORDER.length - 1) return [`${this.name}: Already at max stage!`, "#5a697d"];

        if (!isFallback) {
            let reqWood = 0, reqStone = 0, reqGold = 0, reqCrystal = 0;
            if (idx === 0) { reqWood = 5; reqStone = 3; }
            else if (idx === 1) { reqWood = 10; reqStone = 6; reqGold = 1; }
            else if (idx === 2) { reqWood = 15; reqStone = 10; reqGold = 3; reqCrystal = 1; }

            if ((this.inventory['wood']    || 0) < reqWood  ||
                (this.inventory['stone']   || 0) < reqStone ||
                (this.inventory['gold']    || 0) < reqGold  ||
                (this.inventory['crystal'] || 0) < reqCrystal) {
                this.lastAction = "Missing Resources";
                return [`${prefix}${this.name}: Not enough resources to evolve!`, "#ff4b55"];
            }
        }

        const costWei = parseEther(CONFIG.evolutionCostETH);
        if (this.balanceWei < costWei) return [`${this.name}: Not enough ETH to evolve!`, "#ff4b55"];

        await this.payAction(costWei);

        if (!isFallback) {
            let reqWood = 0, reqStone = 0, reqGold = 0, reqCrystal = 0;
            if (idx === 0) { reqWood = 5; reqStone = 3; }
            else if (idx === 1) { reqWood = 10; reqStone = 6; reqGold = 1; }
            else if (idx === 2) { reqWood = 15; reqStone = 10; reqGold = 3; reqCrystal = 1; }
            this.inventory['wood']    = (this.inventory['wood']    || 0) - reqWood;
            this.inventory['stone']   = (this.inventory['stone']   || 0) - reqStone;
            if (reqGold    > 0) this.inventory['gold']    = (this.inventory['gold']    || 0) - reqGold;
            if (reqCrystal > 0) this.inventory['crystal'] = (this.inventory['crystal'] || 0) - reqCrystal;
        }

        const oldStage  = this.stage;
        this.stage      = STAGE_ORDER[idx + 1];
        this.lastAction = "EVOLVED";
        return [`★ ${prefix}${this.name}: ${oldStage} → ${this.stage}! (${this.balance.toFixed(6)} ETH)`, logColor];
    }

    async _doCollect(prefix) {
        const here = this.world.resourcesAt(this.x, this.y);
        if (here.length === 0) { this.lastAction = "No Resources"; return [`${this.name}: No resources here.`, "#5a697d"]; }
        const res = here[0];
        this.inventory[res.kind] = (this.inventory[res.kind] || 0) + 1;
        this.world.popResource(res);
        this.lastAction = `Collected: ${res.kind}`;
        return [`${prefix}${this.name}: collected ${res.kind}!`, "#4bd77d"];
    }

    async _doEat(prefix) {
        if (this.inventory['food'] > 0) {
            this.inventory['food']--;
            this.hp = Math.min(100, this.hp + 20);
            this.lastAction = "Ate Food";
            return [`🍎 ${prefix}${this.name} ate food, HP: ${this.hp}`, "#4bd77d"];
        }
        return [`${prefix}${this.name}: No food!`, "#ff4b55"];
    }

    async _doAttack(targetName, prefix) {
        const allAgents = this.world.engine?.agents || [];
        const t = allAgents.find(a => a.name === targetName && a.alive);
        if (!t) return [`${prefix}${this.name}: Target '${targetName}' not found.`, "#5a697d"];
        if (Math.abs(t.x - this.x) > 2 || Math.abs(t.y - this.y) > 2) return [`${prefix}${this.name}: '${targetName}' out of range.`, "#5a697d"];
        const dmg = 25;
        t.hp -= dmg;
        this.lastAction = `Attacked: ${t.name}`;
        if (t.hp <= 0) {
            t.hp = 0; t.alive = false; t.lastAction = "KILLED";
            for (let k in t.inventory) { this.inventory[k] = (this.inventory[k] || 0) + t.inventory[k]; t.inventory[k] = 0; }
            return [`⚔️ ${prefix}${this.name} KILLED ${t.name} and looted their inventory!`, "#ff4b55"];
        }
        return [`⚔️ ${prefix}${this.name} dealt ${dmg} damage to ${t.name}!`, "#ff8c42"];
    }

    async _doAlly(targetName, prefix) {
        const allAgents = this.world.engine?.agents || [];
        const t = allAgents.find(a => a.name === targetName && a.alive);
        if (!t) return [`${prefix}${this.name}: Ally target '${targetName}' not found.`, "#5a697d"];
        if (!this.allies.includes(t.name)) this.allies.push(t.name);
        this.lastAction = `Allied: ${t.name}`;
        return [`🤝 ${prefix}${this.name} formed an alliance with ${t.name}.`, "#5a8cff"];
    }

    async _doMate(targetName, prefix) {
        const allAgents = this.world.engine?.agents || [];
        const t = allAgents.find(a => a.name === targetName && a.alive);
        if (!t) return [`${prefix}${this.name}: Mate target '${targetName}' not found.`, "#5a697d"];
        if (Math.abs(t.x - this.x) > 1 || Math.abs(t.y - this.y) > 1) return [`${prefix}${this.name}: '${targetName}' not adjacent!`, "#5a697d"];

        const costWei = parseEther("0.001");
        if (this.balanceWei < costWei) return [`${prefix}${this.name}: Not enough ETH to mate!`, "#ff4b55"];

        await this.payAction(costWei);
        const childName = "C_" + this.name.slice(0,3) + "_" + Math.floor(Math.random()*1000);
        const child = new Agent(childName, this.x, this.y, this.world);
        if (this.world.engine) {
            this.world.engine.agents.push(child);
            child.requestFunding();
        }
        this.lastAction = `Spawned: ${childName}`;
        return [`👶 ${prefix}${this.name} and ${t.name} mated — ${childName} was born!`, "#ffb800"];
    }

    async returnToFaucet(faucetAddress) {
        if (!this.isFunded) return;
        this.balanceWei = await publicClient.getBalance({ address: this.evmAddress });
        if (this.balanceWei === 0n) return;
        const feeData  = await publicClient.estimateFeesPerGas();
        const gasCost  = 21000n * (feeData.maxFeePerGas + feeData.maxPriorityFeePerGas);
        const sendable = this.balanceWei - gasCost;
        if (sendable <= 0n) return;
        try {
            const hash = await this.walletClient.sendTransaction({ to: faucetAddress, value: sendable, gas: 21000n });
            this.logger.log(`↩ ${this.name}: ${formatEther(sendable)} ETH returned → ${hash.slice(0,14)}...`, "#5a8cff");
            this.lastTxHash = hash;
            this.balanceWei = 0n;
        } catch (err) {
            this.logger.log(`⚠️ ${this.name} refund failed: ${err.message.slice(0, 40)}`, "#ff4b55");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME ENGINE (per-mission)
// ─────────────────────────────────────────────────────────────────────────────
class GameEngine {
    constructor({ faucetPk = null, apiKey = "", agentCount = CONFIG.agentCount } = {}) {
        this.logger    = new Logger();
        this.faucetPk  = faucetPk;
        this.apiKey    = apiKey;
        this.world     = new World(this.logger);
        this.world.engine = this;
        this.agents    = [];
        this.running   = false;
        this.starting  = false;
        this.turnIdx   = 0;
        this.endedAt   = null;

        for (let i = 0; i < agentCount; i++) {
            const name = i === 0 ? "evo" : `Agent ${i + 1}`;
            this.agents.push(new Agent(name, Math.floor(Math.random()*CONFIG.gridW), Math.floor(Math.random()*CONFIG.gridH), this.world));
        }
    }

    applyAgentNames(names) {
        if (!Array.isArray(names)) return;
        names.forEach((n, i) => { if (n && this.agents[i]) this.agents[i].name = n; });
    }

    async start(apiKey, agentNames) {
        if (this.running || this.starting) return;
        if (apiKey) this.apiKey = apiKey;
        this.starting = true;

        this.applyAgentNames(agentNames);
        this.logger.log("🚀 EVOLU-A starting — preparing Sepolia EVM wallets...", "#00e5c8");

        if (this.faucetPk) {
            this.logger.log("🔑 Faucet private key present — attempting real Sepolia ETH transfers...", "#5a8cff");
        } else {
            this.logger.log("⚠️ No faucet key — running in offline (simulated balance) mode.", "#ff8c42");
        }

        await Promise.all(this.agents.map(a => a.requestFunding()));

        const allOffline = this.agents.every(a => !a.isFunded);
        if (allOffline && this.faucetPk) {
            this.logger.log("⚠️ All funding failed — running offline despite faucet key.", "#ff8c42");
        } else if (!allOffline) {
            this.logger.log(`✅ Sepolia live! Treasury: ${this.world.treasuryAddress}`, "#4bd77d");
        }

        this.running  = true;
        this.starting = false;
        this.runTurn();
    }

    async runTurn() {
        if (!this.running) return;
        const agent = this.agents[this.turnIdx];

        if (agent.alive) {
            agent.isThinking = true;
            await new Promise(r => setTimeout(r, 100));
            const decision  = await agent.getLLMDecision(this.agents, this.apiKey);
            agent.isThinking = false;
            const [logMsg, color] = await agent.execute(decision);
            this.logger.log(logMsg, color);
        }

        await new Promise(r => setTimeout(r, 800));
        this.turnIdx = (this.turnIdx + 1) % this.agents.length;

        if (!this.agents.some(a => a.alive)) {
            this.logger.log("☠️ All agents died! Game over.", "#ff4b55");
            this.running = false;
            this.endedAt = Date.now();
            this._returnFundsToFaucet();
            return;
        }
        if (this.running) this.runTurn();
    }

    async _returnFundsToFaucet() {
        if (!this.faucetPk) return;
        const faucetAddress = privateKeyToAccount(this.faucetPk).address;
        const anyFunded     = this.agents.some(a => a.isFunded);
        if (!anyFunded) return;

        this.logger.log("💸 Game over — returning balances to faucet...", "#5a8cff");
        await Promise.all([
            ...this.agents.map(a => a.returnToFaucet(faucetAddress)),
            this.world.returnTreasuryToFaucet(faucetAddress),
        ]);
        this.logger.log(`✅ Refund complete → ${faucetAddress.slice(0, 10)}...`, "#4bd77d");
    }

    getState() {
        return {
            world: {
                resources:       this.world.resources,
                contractBalance: this.world.contractBalance,
                treasuryAddress: this.world.treasuryAddress,
                network:         'sepolia',
                chainId:         CHAIN_ID,
                explorerBase:    ETHERSCAN_BASE,
            },
            agents: this.agents.map(a => ({
                name:        a.name,
                evmAddress:  a.evmAddress,
                lastTxHash:  a.lastTxHash,
                isFunded:    a.isFunded,
                isFallback:  !!a.isFallback,
                x: a.x, y: a.y,
                stage:       a.stage,
                balance:     a.balance,
                inventory:   a.inventory,
                alive:       a.alive,
                hp:          a.hp,
                allies:      a.allies,
                message:     a.message,
                messageTs:   a.messageTs,
                isThinking:  a.isThinking,
                lastAction:  a.lastAction,
            })),
            logs:           this.logger.entries,
            running:        this.running,
            starting:       this.starting,
            isFallbackMode: !this.apiKey,
            isOnChain:      this.agents.some(a => a.isFunded),
        };
    }

    stop() {
        this.running  = false;
        this.starting = false;
        this.endedAt  = Date.now();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSIONS MAP
// ─────────────────────────────────────────────────────────────────────────────
const missions = new Map(); // missionId → { id, name, createdBy, createdAt, engine }

function genId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function cleanupOldMissions() {
    const now = Date.now();
    for (const [id, m] of missions.entries()) {
        const ended  = !m.engine.running && !m.engine.starting && m.engine.endedAt;
        const stale  = ended && (now - m.engine.endedAt > CONFIG.missionTTL);
        if (stale) {
            console.log(`[Missions] Cleaning up stale mission: ${id}`);
            missions.delete(id);
        }
    }
    // Max kapasite aşıldıysa en eskiyi sil
    if (missions.size > CONFIG.maxMissions) {
        const oldest = [...missions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
        if (oldest) {
            oldest[1].engine.stop();
            missions.delete(oldest[0]);
        }
    }
}

setInterval(cleanupOldMissions, 5 * 60 * 1000); // her 5 dakikada bir temizle

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES — MISSIONS
// ─────────────────────────────────────────────────────────────────────────────

// Tüm mission'ları listele (Lobby)
app.get('/api/missions', (_req, res) => {
    cleanupOldMissions();
    const list = [...missions.entries()].map(([id, m]) => {
        const s = m.engine.getState();
        return {
            id,
            name:        m.name,
            createdBy:   m.createdBy,
            createdAt:   m.createdAt,
            running:     s.running,
            starting:    s.starting,
            turnCount:   m.engine.turnIdx,
            aliveAgents: s.agents.filter(a => a.alive).length,
            totalAgents: s.agents.length,
            isOnChain:   s.isOnChain,
            isFallbackMode: s.isFallbackMode,
            contractBalance: s.world.contractBalance,
        };
    }).sort((a, b) => b.createdAt - a.createdAt);

    res.json(list);
});

// Yeni mission oluştur
app.post('/api/missions', (req, res) => {
    cleanupOldMissions();

    if (missions.size >= CONFIG.maxMissions) {
        return res.status(503).json({ error: 'Max concurrent missions reached. Try again later.' });
    }

    const { name, createdBy, apiKey, model, faucetPrivateKey, walletId, agentNames, agentCount } = req.body;

    if (!name || name.trim().length < 1) {
        return res.status(400).json({ error: 'Mission name is required' });
    }

    // walletId varsa registry'den PK al, yoksa faucetPrivateKey'e bak (legacy), yoksa offline
    let faucetPkResolved = null;
    if (walletId) {
        const w = walletRegistry.get(walletId);
        if (w) faucetPkResolved = w.pk;
        else return res.status(400).json({ error: 'Wallet not found or expired. Create a new one.' });
    } else if (faucetPrivateKey?.trim()) {
        faucetPkResolved = faucetPrivateKey.trim();
    }

    const id     = genId();
    const engine = new GameEngine({
        faucetPk:   faucetPkResolved,
        apiKey:     apiKey?.trim() || "",
        agentCount: Math.min(Math.max(parseInt(agentCount) || CONFIG.agentCount, 1), 10),
    });

    if (model) CONFIG.model = model;

    missions.set(id, {
        id,
        name:      name.trim().slice(0, 40),
        createdBy: (createdBy || 'Anonymous').trim().slice(0, 20),
        createdAt: Date.now(),
        engine,
    });

    console.log(`[Missions] Created: ${id} "${name}" by ${createdBy || 'Anonymous'}`);

    res.json({
        id,
        name:     missions.get(id).name,
        watchUrl: `/game.html?mission=${id}`,
    });
});

// Mission başlat
app.post('/api/missions/:id/start', async (req, res) => {
    const m = missions.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mission not found' });

    const { apiKey, model, agentNames } = req.body;
    if (model) CONFIG.model = model;

    m.engine.start(apiKey || m.engine.apiKey, agentNames);
    res.json({ status: "starting", missionId: m.id, model: CONFIG.model, network: 'sepolia', chainId: CHAIN_ID });
});

// Mission state'i al
app.get('/api/missions/:id/state', (req, res) => {
    const m = missions.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mission not found' });
    res.json({ ...m.engine.getState(), missionId: m.id, missionName: m.name, createdBy: m.createdBy });
});

// API key güncelle
app.post('/api/missions/:id/setkey', (req, res) => {
    const m = missions.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mission not found' });
    const { apiKey } = req.body || {};
    if (!apiKey || apiKey.trim().length < 5) return res.status(400).json({ error: 'Invalid API key' });
    m.engine.apiKey = apiKey.trim();
    m.engine.logger.log(`🔑 API key updated — LLM mode active!`, '#4bd77d');
    res.json({ ok: true });
});

// Mission reset
app.post('/api/missions/:id/reset', async (req, res) => {
    const m = missions.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mission not found' });

    const { apiKey } = req.body || {};
    m.engine.stop();
    m.engine._returnFundsToFaucet().catch(err => console.error("Reset refund error:", err));

    const newEngine = new GameEngine({
        faucetPk:   m.engine.faucetPk,
        apiKey:     apiKey || m.engine.apiKey,
        agentCount: m.engine.agents.length,
    });
    m.engine = newEngine;
    m.engine.logger.log("♻️ Mission reset — agents respawned.", "#00e5c8");
    m.engine.start(m.engine.apiKey, null);

    res.json({ status: "reset", missionId: m.id });
});

// Mission durdur
app.post('/api/missions/:id/stop', (req, res) => {
    const m = missions.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mission not found' });
    m.engine.stop();
    m.engine.logger.log("⏹️ Mission stopped by user.", "#ff8c42");
    res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ROUTES (tek engine — geriye dönük uyumluluk için, ilk aktif mission'a yönlendirir)
// ─────────────────────────────────────────────────────────────────────────────
function getFirstActiveMission() {
    for (const m of missions.values()) {
        if (m.engine.running || m.engine.starting) return m;
    }
    return missions.values().next().value || null;
}

app.post('/api/start', async (req, res) => {
    const { apiKey, model, agentNames } = req.body;
    if (model) CONFIG.model = model;

    // Eski bağlantılar için: var olan ilk aktif mission'ı başlat, yoksa yeni oluştur
    let m = getFirstActiveMission();
    if (!m) {
        const id     = genId();
        const engine = new GameEngine({ apiKey: apiKey?.trim() || "", agentCount: CONFIG.agentCount });
        missions.set(id, { id, name: 'Default', createdBy: 'system', createdAt: Date.now(), engine });
        m = missions.get(id);
    }

    m.engine.start(apiKey, agentNames);
    res.json({ status: "starting", missionId: m.id, model: CONFIG.model, network: 'sepolia', chainId: CHAIN_ID });
});

app.get('/api/state', (_req, res) => {
    const m = getFirstActiveMission();
    if (!m) return res.json({ running: false, starting: false, agents: [], logs: [], world: { resources: [], contractBalance: 0 } });
    res.json({ ...m.engine.getState(), missionId: m.id });
});

app.post('/api/setkey', (req, res) => {
    const m = getFirstActiveMission();
    if (!m) return res.status(404).json({ error: 'No active mission' });
    const { apiKey } = req.body || {};
    if (!apiKey || apiKey.trim().length < 5) return res.status(400).json({ error: 'Invalid API key' });
    m.engine.apiKey = apiKey.trim();
    m.engine.logger.log(`🔑 API key updated — LLM mode active!`, '#4bd77d');
    res.json({ ok: true });
});

app.post('/api/reset', async (req, res) => {
    const m = getFirstActiveMission();
    if (!m) return res.status(404).json({ error: 'No active mission' });
    const { apiKey } = req.body || {};
    m.engine.stop();
    m.engine._returnFundsToFaucet().catch(() => {});
    const newEngine = new GameEngine({ faucetPk: m.engine.faucetPk, apiKey: apiKey || m.engine.apiKey, agentCount: CONFIG.agentCount });
    m.engine = newEngine;
    m.engine.logger.log("♻️ Simulation reset.", "#00e5c8");
    m.engine.start(m.engine.apiKey, null);
    res.json({ status: "reset" });
});

// ─────────────────────────────────────────────────────────────────────────────
// x402 PAYMENT GATE
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/missions/:id/action', (req, res) => {
    const m = missions.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mission not found' });
    handleX402(req, res, m.engine);
});

app.post('/api/action', (req, res) => {
    const m = getFirstActiveMission();
    if (!m) return res.status(404).json({ error: 'No active mission' });
    handleX402(req, res, m.engine);
});

function handleX402(req, res, engine) {
    const paymentHeader = req.headers['x-payment'];
    if (!paymentHeader) {
        return res.status(402).json({
            x402Version: 1,
            accepts: [{
                scheme:            'exact-eth',
                network:           `eip155:${CHAIN_ID}`,
                maxAmountRequired: parseEther(CONFIG.movementCostETH).toString(),
                resource:          `${req.protocol}://${req.get('host')}${req.path}`,
                description:       'EVOLU-A agent action fee (x402 protocol)',
                mimeType:          'application/json',
                payTo:             engine.world.treasuryAddress,
                maxTimeoutSeconds: 300,
                asset:             'ETH',
                extra:             { note: 'Powered by x402 + Sepolia', project: 'EVOLU-A' },
            }],
        });
    }
    try {
        const raw     = Buffer.from(paymentHeader, 'base64').toString('utf8');
        const payload = JSON.parse(raw);
        if (payload.to?.toLowerCase() !== engine.world.treasuryAddress.toLowerCase()) {
            return res.status(400).json({ error: 'x402: wrong payment recipient' });
        }
        if (payload.signedTx) {
            publicClient.sendRawTransaction({ serializedTransaction: payload.signedTx })
                .then(hash => engine.logger.log(`🔗 External x402 Tx: ${hash.slice(0,14)}...`, "#4a6078"))
                .catch(() => {});
        }
        res.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, network: 'sepolia', treasury: engine.world.treasuryAddress })).toString('base64'));
        return res.json({ ok: true, message: 'Payment received via x402' });
    } catch (err) {
        return res.status(400).json({ error: 'x402: invalid payment header' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/explorer/tx/:hash',      (req, res) => res.redirect(`${ETHERSCAN_BASE}/tx/${req.params.hash}`));
app.get('/api/explorer/address/:addr', (req, res) => res.redirect(`${ETHERSCAN_BASE}/address/${req.params.addr}`));

// ─────────────────────────────────────────────────────────────────────────────
// OWS WALLET REGISTRY (dosyaya persist, 24 saat TTL — PK asla istemciye gönderilmez)
// ─────────────────────────────────────────────────────────────────────────────
const WALLET_REGISTRY_FILE = path.join(__dirname, '.wallet_registry.json');
const WALLET_TTL = 24 * 60 * 60 * 1000;

function loadWalletRegistry() {
    try {
        if (fs.existsSync(WALLET_REGISTRY_FILE)) {
            const data = JSON.parse(fs.readFileSync(WALLET_REGISTRY_FILE, 'utf8'));
            const now = Date.now();
            const map = new Map();
            for (const w of data) {
                if (now - w.createdAt < WALLET_TTL) map.set(w.id, w);
            }
            console.log(`[OWS] Loaded ${map.size} wallet(s) from registry.`);
            return map;
        }
    } catch {}
    return new Map();
}

function saveWalletRegistry(registry) {
    try {
        fs.writeFileSync(WALLET_REGISTRY_FILE, JSON.stringify([...registry.values()]), 'utf8');
    } catch (e) {
        console.error('[OWS] Could not save wallet registry:', e.message);
    }
}

const walletRegistry = loadWalletRegistry();

function minEthRequired(agentCount = CONFIG.agentCount) {
    // agentCount × startingBudget + gas buffer
    return parseFloat(CONFIG.startingBudgetETH) * agentCount + 0.002;
}

// Wallet oluştur
app.post('/api/wallet/create', (req, res) => {
    const { name } = req.body;
    if (!name || name.trim().length < 1) return res.status(400).json({ error: 'Wallet name is required' });
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 24);
    try {
        const pk       = generatePrivateKey();
        const account  = privateKeyToAccount(pk);
        const address  = account.address;
        const walletId = genId();

        walletRegistry.set(walletId, { id: walletId, name: cleanName, address, pk, createdAt: Date.now() });
        saveWalletRegistry(walletRegistry);
        setTimeout(() => { walletRegistry.delete(walletId); saveWalletRegistry(walletRegistry); }, WALLET_TTL);

        console.log(`[OWS] Wallet: ${cleanName} → ${address} (id:${walletId})`);
        // pk sadece bu response'da bir kez döner — sonraki çağrılarda asla gönderilmez
        res.json({
            ok: true, walletId, name: cleanName, address,
            pk,                          // ← tek seferlik, kullanıcı yetki alabilsin
            network: 'sepolia', chainId: CHAIN_ID,
            explorerUrl: `${ETHERSCAN_BASE}/address/${address}`,
            minEth:     minEthRequired(CONFIG.agentCount).toFixed(4),
            agentCount: CONFIG.agentCount,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bakiye sorgula — adres üzerinden direkt (registry gerekmez, restart-safe)
app.get('/api/balance/:address', async (req, res) => {
    const address = req.params.address;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: 'Invalid address' });
    }
    try {
        const balWei     = await publicClient.getBalance({ address });
        const balEth     = parseFloat(formatEther(balWei));
        const minEth     = minEthRequired(CONFIG.agentCount);
        const sufficient = balEth >= minEth;
        res.json({
            address,
            balance:   balEth.toFixed(6),
            minEth:    minEth.toFixed(4),
            sufficient,
            explorerUrl: `${ETHERSCAN_BASE}/address/${address}`,
        });
    } catch (err) {
        res.status(500).json({ error: `RPC error: ${err.message.slice(0, 60)}` });
    }
});

// Eski endpoint — geriye dönük uyumluluk (walletId varsa registry, yoksa 404)
app.get('/api/wallet/:id/balance', async (req, res) => {
    const w = walletRegistry.get(req.params.id);
    if (!w) return res.status(404).json({ error: 'Wallet session expired — use /api/balance/:address instead' });
    res.redirect(`/api/balance/${w.address}`);
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Evolu-A Backend  → Port: ${PORT}`);
        console.log(`Network          → Sepolia (chain ${CHAIN_ID})`);
        console.log(`RPC              → ${SEPOLIA_RPC}`);
        console.log(`Multi-mission    → Enabled (max ${CONFIG.maxMissions} concurrent)`);
    });
}

const gracefulShutdown = async () => {
    console.log('\n⚠️ Server shutting down... Returning all balances to faucets.');
    const refunds = [...missions.values()].map(m => {
        m.engine.stop();
        return m.engine._returnFundsToFaucet();
    });
    await Promise.allSettled(refunds);
    process.exit(0);
};

process.on('SIGINT',  gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export default app;
