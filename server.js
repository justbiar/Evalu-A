import express from 'express';
import cors from 'cors';
import path from 'path';
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
app.use(express.static(path.join(__dirname, '.')));

// ─────────────────────────────────────────────────────────────────────────────
// EVM / SEPOLIA CONNECTION
// ─────────────────────────────────────────────────────────────────────────────
const SEPOLIA_RPC     = process.env.SEPOLIA_RPC_URL || 'https://sepolia.drpc.org';
const ETHERSCAN_BASE  = 'https://sepolia.etherscan.io';
const CHAIN_ID        = 11155111; // Sepolia

const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
});

// ─────────────────────────────────────────────────────────────────────────────
// GAME CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    model:              "meta-llama/llama-3.2-3b-instruct:free",
    movementCostETH:    '0.00001',   // ETH per step
    evolutionCostETH:   '0.0005',    // ETH per evolution
    startingBudgetETH:  '0.003',     // ETH per agent (4 agents = 0.012 ETH total)
    agentCount:         4,           // total agent count
    gridW: 20, gridH: 20,
    resourceCount: 80,
    maxLogLines: 80,
    offlineMode: process.env.USE_OFFLINE_MODE === 'true',
};

const STAGE_ORDER = ["Collector", "Merchant", "Producer", "Legend"];

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────
class Logger {
    constructor() { this.entries = []; }
    log(msg, colorHex = "#c3d2e6") {
        this.entries.unshift({ text: msg, color: colorHex, ts: new Date().toISOString() });
        if (this.entries.length > CONFIG.maxLogLines) this.entries.pop();
        console.log(`[LOG] ${msg}`);
    }
}

const sysLogger = new Logger();

// ─────────────────────────────────────────────────────────────────────────────
// WORLD
// ─────────────────────────────────────────────────────────────────────────────
class World {
    constructor() {
        const pk = generatePrivateKey();
        this.treasuryAccount  = privateKeyToAccount(pk);
        this.treasuryAddress  = this.treasuryAccount.address;
        this.contractBalanceWei = 0n;
        this.resources = [];
        this.spawnResources(CONFIG.resourceCount);
        console.log(`[World] Treasury: ${this.treasuryAddress}`);
    }

    get contractBalance() {
        return parseFloat(formatEther(this.contractBalanceWei));
    }

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

    // ── Treasury'yi faucet'a iade et ─────────────────────────────────────────
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
            sysLogger.log(`↩ Treasury: ${formatEther(sendable)} ETH returned to faucet → ${hash.slice(0,14)}...`, "#5a8cff");
            this.contractBalanceWei = 0n;
        } catch (err) {
            sysLogger.log(`⚠️ Treasury refund failed: ${err.message.slice(0, 40)}`, "#ff4b55");
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

        // EVM wallet
        this.privateKey  = generatePrivateKey();
        this.account     = privateKeyToAccount(this.privateKey);
        this.evmAddress  = this.account.address;
        this.walletClient = createWalletClient({
            account:   this.account,
            chain:     sepolia,
            transport: http(SEPOLIA_RPC),
        });

        this.balanceWei = 0n;
        this.isFunded   = false;

        this.stage      = "Collector";
        this.inventory  = {};
        this.alive      = true;
        this.hp         = 100;
        this.allies     = [];
        this.message    = "";
        this.messageTs  = 0;

        this.isThinking = false;
        this.isFallback = false;
        this.lastAction = "Spawned";
        this.lastTxHash = null;

        console.log(`[Agent:${name}] EVM Address: ${this.evmAddress}`);
    }

    get balance() { return parseFloat(formatEther(this.balanceWei)); }
    get stageLevel() { return STAGE_ORDER.indexOf(this.stage); }

    // ── FUNDING (Sepolia faucet wallet veya offline) ─────────────────────────
    async requestFunding() {
        const faucetPk = process.env.FAUCET_PRIVATE_KEY;

        // Offline mode (default): skip all RPC calls, simulate balance instantly
        if (CONFIG.offlineMode || !faucetPk) {
            this.balanceWei = parseEther(CONFIG.startingBudgetETH);
            this.isFunded   = false;
            sysLogger.log(`💰 ${this.name}: ${CONFIG.startingBudgetETH} ETH simulated (offline mode)`, "#00e5c8");
            return false;
        }

        try {
            // Quick balance check — skip if faucet is too low
            const faucetAccount = privateKeyToAccount(faucetPk);
            const faucetBal     = await publicClient.getBalance({ address: faucetAccount.address });
            const needed        = parseEther(CONFIG.startingBudgetETH);
            if (faucetBal < needed) {
                sysLogger.log(`⚠️ ${this.name}: Faucet balance too low — offline mode`, "#ff8c42");
                this.balanceWei = needed;
                this.isFunded   = false;
                return false;
            }

            sysLogger.log(`💧 ${this.name}: Transferring ${CONFIG.startingBudgetETH} ETH from Sepolia faucet...`, "#5a8cff");
            const faucetClient  = createWalletClient({
                account:   faucetAccount,
                chain:     sepolia,
                transport: http(SEPOLIA_RPC),
            });

            const hash = await faucetClient.sendTransaction({
                to:    this.evmAddress,
                value: needed,
            });

            await publicClient.waitForTransactionReceipt({ hash, timeout: 15_000 });
            this.balanceWei = await publicClient.getBalance({ address: this.evmAddress });
            this.isFunded   = true;
            sysLogger.log(`✅ ${this.name}: ${CONFIG.startingBudgetETH} ETH received! Address: ${this.evmAddress.slice(0, 10)}...`, "#4bd77d");
            return true;
        } catch (err) {
            sysLogger.log(`⚠️ ${this.name}: Funding failed (${err.message.slice(0, 40)}) — offline mode`, "#ff4b55");
            this.balanceWei = parseEther(CONFIG.startingBudgetETH);
            this.isFunded   = false;
            return false;
        }
    }

    // ── x402 PAYMENT FLOW ────────────────────────────────────────────────────
    // x402 HTTP protocol: agent signs an ETH transfer → server broadcasts it.
    // X-PAYMENT header payload = base64(JSON { signedTx, from, to, value })
    async buildX402PaymentHeader(costWei) {
        const request = await this.walletClient.prepareTransactionRequest({
            to:    this.world.treasuryAddress,
            value: costWei,
            gas:   21000n,
        });
        const signedTx = await this.walletClient.signTransaction(request);

        const payload = JSON.stringify({
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

    // x402 settlement: broadcast the pre-signed transaction from X-PAYMENT
    async settleX402Payment(paymentHeader) {
        const raw     = Buffer.from(paymentHeader, 'base64').toString('utf8');
        const payload = JSON.parse(raw);

        // Verify recipient and value
        if (payload.to.toLowerCase() !== this.world.treasuryAddress.toLowerCase()) {
            throw new Error('x402: wrong recipient');
        }
        if (BigInt(payload.value) < parseEther(CONFIG.movementCostETH) / 2n) {
            throw new Error('x402: insufficient amount');
        }

        // Broadcast (settle)
        const txHash = await publicClient.sendRawTransaction({
            serializedTransaction: payload.signedTx,
        });

        return txHash;
    }

    // ── PAY ACTION ───────────────────────────────────────────────────────────
    async payAction(costWei) {
        if (this.isFunded) {
            try {
                // Build x402 payment header and settle on-chain
                const paymentHeader = await this.buildX402PaymentHeader(costWei);
                const txHash        = await this.settleX402Payment(paymentHeader);

                this.lastTxHash = txHash;
                sysLogger.log(`🔗 x402 Tx: ${txHash.slice(0, 14)}... ↗`, "#4a6078");

                // Sync balance from chain
                this.balanceWei = await publicClient.getBalance({ address: this.evmAddress });
                this.world.contractBalanceWei += costWei;
                return txHash;
            } catch (err) {
                sysLogger.log(`⚠️ On-chain tx failed — offline: ${err.message.slice(0, 35)}`, "#ff4b55");
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
            .map(a => ({name: a.name, pos: `(${a.x},${a.y})`, stage: a.stage, hp: a.hp, isAlly: this.allies.includes(a.name), said: a.message || ""}));

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
                    model:       CONFIG.model,
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
            if (raw.includes("```")) raw = raw.replace(/```(json)?/g, '').trim();
            return JSON.parse(raw);
        } catch (err) {
            return this._fallbackAction(err.message.substring(0, 30));
        }
    }

    _fallbackAction(reason) {
        const moveMessages = [
            "Exploring...", "Searching for resources!", "Moving out!",
            "Scouting the area...", "On patrol!", "No signal, going manual",
            "Autonomous mode active", "Grid scanning...", "Resource hunt!",
            "Where are the others?", "Need more wood...", "Staying alive!",
        ];
        if (this.balance >= parseFloat(CONFIG.evolutionCostETH) && this.stage !== "Legend") {
            return { action: "evolve", _fallback: reason, message: "Evolving! ★" };
        }
        const dirs = ["up", "down", "left", "right"];
        return {
            action: "move",
            direction: dirs[Math.floor(Math.random() * dirs.length)],
            _fallback: reason,
            message: moveMessages[Math.floor(Math.random() * moveMessages.length)],
        };
    }

    // ── EXECUTE ──────────────────────────────────────────────────────────────
    async execute(action) {
        const act        = action.action || "wait";
        this.message     = action.message || "";
        this.messageTs   = Date.now();
        const target     = action.target || "";
        const isFallback = !!action._fallback;
        this.isFallback  = isFallback;
        const prefix     = isFallback ? "🤖[FB] " : "";
        
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
        const deltas = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
        const [dx, dy] = deltas[direction] || [0, 0];
        const nx = this.x + dx, ny = this.y + dy;
        const dirIco  = { up:"↑", down:"↓", left:"←", right:"→" }[direction] || direction;
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

            const o = this.inventory['wood']    || 0;
            const t = this.inventory['stone']   || 0;
            const a = this.inventory['gold']    || 0;
            const e = this.inventory['crystal'] || 0;

            if (o < reqWood || t < reqStone || a < reqGold || e < reqCrystal) {
                this.lastAction = "Missing Resources";
                return [`${prefix}${this.name}: Not enough resources! (Need: ${reqWood} Wood, ${reqStone} Stone, ${reqGold} Gold, ${reqCrystal} Crystal)`, "#ff4b55"];
            }
        }

        const costWei = parseEther(CONFIG.evolutionCostETH);
        if (this.balanceWei < costWei) {
            return [`${this.name}: Not enough ETH to evolve! (${this.balance.toFixed(6)} ETH)`, "#ff4b55"];
        }

        await this.payAction(costWei);

        if (!isFallback) {
            let reqWood = 0, reqStone = 0, reqGold = 0, reqCrystal = 0;
            if (idx === 0) { reqWood = 5; reqStone = 3; }
            else if (idx === 1) { reqWood = 10; reqStone = 6; reqGold = 1; }
            else if (idx === 2) { reqWood = 15; reqStone = 10; reqGold = 3; reqCrystal = 1; }

            this.inventory['wood']    -= reqWood;
            this.inventory['stone']   -= reqStone;
            if (reqGold    > 0) this.inventory['gold']    -= reqGold;
            if (reqCrystal > 0) this.inventory['crystal'] -= reqCrystal;
        }

        const oldStage = this.stage;
        this.stage     = STAGE_ORDER[idx + 1];
        this.lastAction = "EVOLVED";
        return [`★ ${prefix}${this.name}: ${oldStage} → ${this.stage}! (${this.balance.toFixed(6)} ETH)`, logColor];
    }

    async _doCollect(prefix) {
        const here = this.world.resourcesAt(this.x, this.y);
        if (here.length === 0) {
            this.lastAction = "No Resources";
            return [`${this.name}: No resources here.`, "#5a697d"];
        }
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
        if (Math.abs(t.x - this.x) > 2 || Math.abs(t.y - this.y) > 2) return [`${prefix}${this.name}: '${targetName}' is out of attack range.`, "#5a697d"];

        const dmg = 25;
        t.hp -= dmg;
        this.lastAction = `Attacked: ${t.name}`;
        if (t.hp <= 0) {
            t.hp = 0;
            t.alive = false;
            t.lastAction = "KILLED";
            for (let k in t.inventory) {
                this.inventory[k] = (this.inventory[k] || 0) + t.inventory[k];
                t.inventory[k] = 0;
            }
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
        if (Math.abs(t.x - this.x) > 1 || Math.abs(t.y - this.y) > 1) return [`${prefix}${this.name}: '${targetName}' is not adjacent!`, "#5a697d"];

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

    // ── REFUND: return remaining balance to faucet ───────────────────────────
    async returnToFaucet(faucetAddress) {
        if (!this.isFunded) return; // offline mode — balance is simulated

        // Read current on-chain balance
        this.balanceWei = await publicClient.getBalance({ address: this.evmAddress });
        if (this.balanceWei === 0n) return;

        // Gas cost: 21000 gas × current baseFee (with margin)
        const feeData  = await publicClient.estimateFeesPerGas();
        const gasCost  = 21000n * (feeData.maxFeePerGas + feeData.maxPriorityFeePerGas);
        const sendable = this.balanceWei - gasCost;
        if (sendable <= 0n) return;

        try {
            const hash = await this.walletClient.sendTransaction({
                to:    faucetAddress,
                value: sendable,
                gas:   21000n,
            });
            sysLogger.log(`↩ ${this.name}: ${formatEther(sendable)} ETH returned to faucet → ${hash.slice(0,14)}...`, "#5a8cff");
            this.lastTxHash = hash;
            this.balanceWei = 0n;
        } catch (err) {
            sysLogger.log(`⚠️ ${this.name} refund failed: ${err.message.slice(0, 40)}`, "#ff4b55");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME ENGINE
// ─────────────────────────────────────────────────────────────────────────────
class GameEngine {
    constructor() {
        this.world   = new World();
        this.world.engine = this;
        this.agents  = [];
        this.agents.push(new Agent("evo", Math.floor(Math.random()*CONFIG.gridW), Math.floor(Math.random()*CONFIG.gridH), this.world));
        for (let i = 2; i <= CONFIG.agentCount; i++) {
            this.agents.push(new Agent("Agent " + i, Math.floor(Math.random()*CONFIG.gridW), Math.floor(Math.random()*CONFIG.gridH), this.world));
        }
        this.running  = false;
        this.starting = false;
        this.turnIdx  = 0;
        this.apiKey   = "";
    }

    async start(apiKey, agentNames) {
        if (this.running || this.starting) return;
        this.apiKey   = apiKey;
        this.starting = true;

        // Apply custom agent names if provided
        if (Array.isArray(agentNames)) {
            agentNames.forEach((n, i) => {
                if (n && this.agents[i]) this.agents[i].name = n;
            });
        }

        sysLogger.log("🚀 EVOLU-A starting — preparing Sepolia EVM wallets...", "#00e5c8");

        // Fund all agents in parallel
        await Promise.all(this.agents.map(a => a.requestFunding()));

        const allOffline = this.agents.every(a => !a.isFunded);
        if (allOffline) {
            sysLogger.log("⚠️ No Sepolia connection — running in Offline (simulated) mode.", "#ff8c42");
        } else {
            sysLogger.log(`✅ Sepolia aktif! Treasury: ${this.world.treasuryAddress}`, "#4bd77d");
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
            await new Promise(r => setTimeout(r, 300));

            const decision = await agent.getLLMDecision(this.agents, this.apiKey);
            agent.isThinking = false;

            const [logMsg, color] = await agent.execute(decision);
            sysLogger.log(logMsg, color);
        }

        await new Promise(r => setTimeout(r, 800));
        this.turnIdx = (this.turnIdx + 1) % this.agents.length;

        if (!this.agents.some(a => a.alive)) {
            sysLogger.log("☠️ All agents died! Game over.", "#ff4b55");
            this.running = false;
            this._returnFundsToFaucet(); // async, non-blocking
            return;
        }
        if (this.running) this.runTurn();
    }

    async _returnFundsToFaucet() {
        const faucetPk = process.env.FAUCET_PRIVATE_KEY;
        if (!faucetPk) return; // offline modda iade gerekmiyor

        const faucetAddress = privateKeyToAccount(faucetPk).address;
        const anyFunded     = this.agents.some(a => a.isFunded);
        if (!anyFunded) return;

        sysLogger.log("💸 Game over — returning balances to faucet...", "#5a8cff");

        // Agent bakiyeleri + treasury'yi paralel iade et
        await Promise.all([
            ...this.agents.map(a => a.returnToFaucet(faucetAddress)),
            this.world.returnTreasuryToFaucet(faucetAddress),
        ]);

        sysLogger.log(`✅ Refund complete → ${faucetAddress.slice(0, 10)}...`, "#4bd77d");
    }

    getState() {
        return {
            world: {
                resources:        this.world.resources,
                contractBalance:  this.world.contractBalance,
                treasuryAddress:  this.world.treasuryAddress,
                network:          'sepolia',
                chainId:          CHAIN_ID,
                explorerBase:     ETHERSCAN_BASE,
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
            logs:     sysLogger.entries,
            running:  this.running,
            starting: this.starting,
            isFallbackMode: !this.apiKey,
        };
    }
}

const engine = new GameEngine();

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── x402 Payment Gate (/action) ───────────────────────────────────────────────
// External tools can use this endpoint to make payments via the x402 protocol.
// The game engine calls internal functions directly.
app.post('/api/action', (req, res) => {
    const paymentHeader = req.headers['x-payment'];

    if (!paymentHeader) {
        // HTTP 402 — x402 Payment Required
        return res.status(402).json({
            x402Version: 1,
            accepts: [{
                scheme:             'exact-eth',
                network:            `eip155:${CHAIN_ID}`,
                maxAmountRequired:  parseEther(CONFIG.movementCostETH).toString(),
                resource:           `${req.protocol}://${req.get('host')}${req.path}`,
                description:        'EVOLU-A agent action fee (x402 protocol)',
                mimeType:           'application/json',
                payTo:              engine.world.treasuryAddress,
                maxTimeoutSeconds:  300,
                asset:              'ETH',
                extra: {
                    note:    'Powered by x402 + Sepolia',
                    project: 'EVOLU-A',
                },
            }],
        });
    }

    // X-PAYMENT header mevcut — verify & respond
    try {
        const raw     = Buffer.from(paymentHeader, 'base64').toString('utf8');
        const payload = JSON.parse(raw);

        if (payload.to?.toLowerCase() !== engine.world.treasuryAddress.toLowerCase()) {
            return res.status(400).json({ error: 'x402: wrong payment recipient' });
        }

        // Settlement happens on-chain (fire and forget for external callers)
        if (payload.signedTx) {
            publicClient.sendRawTransaction({ serializedTransaction: payload.signedTx })
                .then(hash => sysLogger.log(`🔗 External x402 Tx: ${hash.slice(0,14)}...`, "#4a6078"))
                .catch(() => {});
        }

        res.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({
            success: true, network: 'sepolia', treasury: engine.world.treasuryAddress,
        })).toString('base64'));

        return res.json({ ok: true, message: 'Payment received via x402' });
    } catch (err) {
        return res.status(400).json({ error: 'x402: invalid payment header' });
    }
});

app.post('/api/start', async (req, res) => {
    const { apiKey, model, agentNames } = req.body;
    if (model) CONFIG.model = model;
    engine.start(apiKey, agentNames); // async, non-blocking
    res.json({ status: "starting", model: CONFIG.model, network: 'sepolia', chainId: CHAIN_ID });
});

app.get('/api/state', (_req, res) => {
    res.json(engine.getState());
});

// ── Set API key at any time (switch from fallback → LLM mode) ────────────────
app.post('/api/setkey', (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey || apiKey.trim().length < 5) {
        return res.status(400).json({ error: 'Invalid API key' });
    }
    engine.apiKey = apiKey.trim();
    sysLogger.log(`🔑 API key updated — LLM mode active!`, '#4bd77d');
    res.json({ ok: true });
});

app.post('/api/reset', async (req, res) => {
    const { apiKey } = req.body || {};
    if (apiKey) engine.apiKey = apiKey;
    
    // Return old agent and treasury balances in the background
    const oldContext = { agents: [...engine.agents], world: engine.world };
    engine._returnFundsToFaucet.call(oldContext).catch(err => console.error("Reset refund var", err));

    // Full simulation restart — recreate world, agents, and re-run
    engine.running  = false;
    engine.starting = false;
    engine.world    = new World();
    engine.world.engine = engine;
    engine.agents   = [];
    engine.agents.push(new Agent("evo", Math.floor(Math.random()*CONFIG.gridW), Math.floor(Math.random()*CONFIG.gridH), engine.world));
    for (let i = 2; i <= CONFIG.agentCount; i++) {
        engine.agents.push(new Agent("Agent " + i, Math.floor(Math.random()*CONFIG.gridW), Math.floor(Math.random()*CONFIG.gridH), engine.world));
    }
    engine.turnIdx  = 0;
    sysLogger.log("♻️ Simulation reset — agents respawned.", "#00e5c8");

    // Re-start the engine asynchronously using the saved apiKey
    engine.start(engine.apiKey, null);

    res.json({ status: "reset" });
});

// Etherscan redirect helpers
app.get('/api/explorer/tx/:hash', (req, res) => {
    res.redirect(`${ETHERSCAN_BASE}/tx/${req.params.hash}`);
});
app.get('/api/explorer/address/:address', (req, res) => {
    res.redirect(`${ETHERSCAN_BASE}/address/${req.params.address}`);
});

// ── OWS Wallet Creation — EVM ─────────────────────────────────────────────────
app.post('/api/wallet/create', (req, res) => {
    const { name } = req.body;
    if (!name || name.trim().length < 1) {
        return res.status(400).json({ error: 'Wallet name is required' });
    }
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 24);
    try {
        const pk      = generatePrivateKey();
        const account = privateKeyToAccount(pk);
        const address = account.address;

        sysLogger.log(`🆕 OWS EVM Wallet: "${cleanName}" → ${address.slice(0, 10)}...`, "#5a8cff");
        console.log(`[OWS] New wallet: ${cleanName} → ${address}`);

        res.json({
            ok:          true,
            name:        cleanName,
            address,
            network:     'sepolia',
            chainId:     CHAIN_ID,
            explorerUrl: `${ETHERSCAN_BASE}/address/${address}`,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Evolu-A Backend  → Port: ${PORT}`);
        console.log(`Network          → Sepolia (chain ${CHAIN_ID})`);
        console.log(`RPC              → ${SEPOLIA_RPC}`);
        console.log(`x402 Action Gate → http://localhost:${PORT}/api/action`);
    });
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async () => {
    console.log('\n⚠️ Server shutting down... Returning balances to faucet wallet.');
    engine.running = false;
    await engine._returnFundsToFaucet();
    process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export default app;
