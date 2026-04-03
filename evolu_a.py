#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
╔══════════════════════════════════════════════════════════════╗
║  EVOLU-A — Otonom Yapay Zeka Ajan Evrim Simülatörü          ║
║  Open Wallet Standard (OWS) Hackathonu                      ║
║  Kategori: "Yaratıcı / Çılgın"                              ║
╚══════════════════════════════════════════════════════════════╝

Konsept:
  3 otonom AI ajanı, LLM beyinleri sayesinde kendi kararlarını
  verir. Her hareket, her evrim, her ticaret → OWS x402 ile
  mocked mikro ödeme. Ajanlar evrimleşir ya da paramları biter.

Çalıştırma:
  pip install pygame requests
  python evolu_a.py

Gereksinimler:
  - Python 3.9+
  - pygame >= 2.0
  - requests
"""

import json
import random
import threading
import time
from collections import deque
from typing import Dict, List, Optional

import pygame
import requests

# ─────────────────────────────────────────────────────────────────────────────
#  YAPILANDIRMA (CONFIGURATION)
# ─────────────────────────────────────────────────────────────────────────────

# OpenRouter — ücretsiz LLM modeli için. Anahtarınızı buraya girin.
OPENROUTER_API_KEY  = "sk-or-v1-BURAYA_ANAHTARINIZI_YAZIN"  # <-- DEĞİŞTİR
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL    = "meta-llama/llama-3.2-3b-instruct:free"  # Ücretsiz model

# Ekonomi (t$ = test token)
MOVEMENT_COST    = 0.0001   # Her adım için harita motoruna mikro ödeme
EVOLUTION_COST   = 0.1      # Evrimleşmek için Dünya Kontratı'na ödeme
STARTING_BUDGET  = 1.0      # Her ajanın başlangıç bakiyesi

# Harita
GRID_W, GRID_H   = 20, 20   # Izgara boyutu (hücre sayısı)
CELL_SIZE        = 32        # Her hücrenin piksel boyutu
RESOURCE_COUNT   = 50        # Haritadaki başlangıç kaynak sayısı

# Pencere
LOG_PANEL_W      = 360       # Sağ log panelinin genişliği
SCREEN_W         = GRID_W * CELL_SIZE + LOG_PANEL_W
SCREEN_H         = GRID_H * CELL_SIZE
FPS              = 30
MAX_LOG_LINES    = 200       # Bellek içinde tutulacak max log satırı

# ─────────────────────────────────────────────────────────────────────────────
#  RENKLER
# ─────────────────────────────────────────────────────────────────────────────

C_BG           = (10,  10,  18)
C_GRID         = (28,  28,  42)
C_PANEL_BG     = (6,   6,   14)
C_PANEL_BORDER = (55,  55,  85)
C_TEXT         = (195, 210, 230)
C_TEXT_DIM     = (90,  105, 125)
C_ACCENT       = (70,  155, 255)
C_ERROR        = (255,  75,  75)
C_SUCCESS      = (75,  215, 125)
C_GOLD         = (255, 195,  50)
C_THINKING     = (255, 230,  50)

# Evrim aşamaları: isim → {renk, sembol, seviye, açıklama}
STAGES: Dict[str, dict] = {
    "Toplayıcı": {"color": (90,  195,  90),  "level": 0, "desc": "Kaynakları toplar"},
    "Tüccar":    {"color": (90,  140, 255),  "level": 1, "desc": "Ticaret yapar"},
    "Üretici":   {"color": (255, 170,  50),  "level": 2, "desc": "Üretim yapar"},
    "Efsane":    {"color": (215,  50, 215),  "level": 3, "desc": "Efsanevi güç"},
}
STAGE_ORDER = ["Toplayıcı", "Tüccar", "Üretici", "Efsane"]

# Kaynak türleri
RESOURCES: Dict[str, dict] = {
    "odun":    {"color": (140,  90,  43), "symbol": "▲"},
    "taş":     {"color": (145, 145, 148), "symbol": "■"},
    "yiyecek": {"color": (175, 220,  55), "symbol": "●"},
}

# ─────────────────────────────────────────────────────────────────────────────
#  OWS CÜZDAN (MOCKED — OPEN WALLET STANDARD)
# ─────────────────────────────────────────────────────────────────────────────

class OWSWallet:
    """
    Open Wallet Standard (OWS) Cüzdan — Şu an Mock Implementasyon.

    Gerçek OWS entegrasyonu için aşağıdaki TODO bloğuna bakın.
    Bu sınıf, x402 mikro ödeme protokolünü simüle eder:
    her transfer in-memory bakiye manipülasyonu olarak çalışır.
    """

    _counter = 0

    def __init__(self, owner: str, initial_balance: float = 0.0):
        OWSWallet._counter += 1
        # Mock OWS cüzdan adresi (gerçekte DID veya public key olur)
        self.address = f"0xOWS_{owner.replace(' ', '_').upper()}_{OWSWallet._counter:04X}"
        self.owner   = owner
        self.balance = initial_balance
        self.tx_log: List[dict] = []

    def transfer_funds(self, receiver: "OWSWallet", amount: float, memo: str = "") -> bool:
        """
        amount t$ miktarını receiver cüzdanına gönderir.

        TODO: OWS x402 entegrasyonu buraya gelecek.
        ─────────────────────────────────────────────
        Gerçek implementasyon şu adımları içerecek:

            from ows_sdk import OWSClient, PaymentRequest

            client = OWSClient(api_key=OWS_API_KEY, network="testnet")

            payment = PaymentRequest(
                protocol   = "x402",          # HTTP 402 Payment Required
                from_addr  = self.address,
                to_addr    = receiver.address,
                amount     = amount,
                currency   = "tUSD",           # Test token
                memo       = memo,
                chain_id   = 11155111,         # Sepolia testnet
            )

            receipt = client.sign_and_broadcast(payment, private_key=self._private_key)
            # receipt.tx_hash → blockchain transaction hash
            # receipt.confirmed → True if mined

        Şu an: sadece in-memory bakiye transferi yapılıyor.
        ─────────────────────────────────────────────
        """
        if amount <= 0 or self.balance < amount:
            return False  # Yetersiz bakiye

        self.balance    -= round(amount, 8)
        receiver.balance = round(receiver.balance + amount, 8)

        tx = {
            "from":   self.address,
            "to":     receiver.address,
            "amount": amount,
            "memo":   memo,
            "time":   time.time(),
        }
        self.tx_log.append(tx)
        receiver.tx_log.append(tx)
        return True

    def __repr__(self):
        return f"OWSWallet({self.owner}, {self.balance:.4f} t$)"


# ─────────────────────────────────────────────────────────────────────────────
#  DÜNYA (WORLD)
# ─────────────────────────────────────────────────────────────────────────────

class Resource:
    def __init__(self, x: int, y: int, kind: str):
        self.x    = x
        self.y    = y
        self.kind = kind


class World:
    """
    Oyun dünyası: ızgara harita, kaynaklar ve
    Dünya Kontratı cüzdanı (evrim ücretleri buraya akar).
    """

    def __init__(self):
        # Dünya Kontratı — evrim ödemelerini toplayan merkezi cüzdan
        # TODO: OWS x402 — Bu adres gerçek bir smart contract adresi olacak
        self.contract_wallet = OWSWallet("Dunya_Kontrati_0", initial_balance=0.0)
        self.resources: List[Resource] = []
        self._spawn_resources(RESOURCE_COUNT)

    def _spawn_resources(self, count: int):
        kinds = list(RESOURCES.keys())
        for _ in range(count):
            self.resources.append(Resource(
                x=random.randint(0, GRID_W - 1),
                y=random.randint(0, GRID_H - 1),
                kind=random.choice(kinds),
            ))

    def resources_at(self, x: int, y: int) -> List[Resource]:
        return [r for r in self.resources if r.x == x and r.y == y]

    def pop_resource(self, r: Resource):
        if r in self.resources:
            self.resources.remove(r)

    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < GRID_W and 0 <= y < GRID_H

    def nearby_resources(self, x: int, y: int, radius: int = 3) -> List[dict]:
        """Ajan etrafındaki kaynakları LLM prompt'u için döndürür."""
        return [
            {"kind": r.kind, "x": r.x, "y": r.y,
             "dist": abs(r.x - x) + abs(r.y - y)}
            for r in self.resources
            if abs(r.x - x) <= radius and abs(r.y - y) <= radius
        ][:6]  # Token tasarrufu için maksimum 6 kaynak


# ─────────────────────────────────────────────────────────────────────────────
#  AJAN (AGENT)
# ─────────────────────────────────────────────────────────────────────────────

class Agent:
    """
    Otonom AI Ajanı.

    Her ajanın:
    - Kendi OWS cüzdanı (başlangıç: 1 t$)
    - LLM beyni (OpenRouter üzerinden karar alır)
    - Evrim aşaması (Toplayıcı → Tüccar → Üretici → Efsane)
    - Envanter (toplanan kaynaklar)
    vardır.
    """

    def __init__(self, name: str, x: int, y: int, world: World):
        self.name       = name
        self.x          = x
        self.y          = y
        self.world      = world
        self.wallet     = OWSWallet(name, initial_balance=STARTING_BUDGET)
        self.stage      = "Toplayıcı"
        self.inventory: Dict[str, int] = {}
        self.alive      = True
        self.is_thinking = False   # LLM bekleniyor mu?
        self.last_action = "Doğdu"

    @property
    def color(self) -> tuple:
        return STAGES[self.stage]["color"]

    @property
    def stage_level(self) -> int:
        return STAGES[self.stage]["level"]

    # ── LLM Beyin ────────────────────────────────────────────────────────────

    def _build_prompt(self, all_agents: List["Agent"]) -> str:
        """Ajanın mevcut durumunu ve dünya bilgisini LLM için prompt'a dönüştürür."""
        others = [
            {
                "name":     a.name,
                "position": [a.x, a.y],
                "stage":    a.stage,
                "balance":  round(a.wallet.balance, 4),
                "distance": abs(a.x - self.x) + abs(a.y - self.y),
            }
            for a in all_agents
            if a.name != self.name and a.alive
        ]

        nearby = self.world.nearby_resources(self.x, self.y)
        inv_str = json.dumps(self.inventory, ensure_ascii=False) if self.inventory else "{}"

        prompt = (
            f"Sen {self.name} adlı otonom bir AI ajanısın. Bir hayatta kalma oyununda oynuyorsun.\n\n"
            f"## Senin Durumun\n"
            f"- Pozisyon: ({self.x}, {self.y}), {GRID_W}x{GRID_H} boyutunda ızgara\n"
            f"- Evrim Aşaması: {self.stage} (Seviye {self.stage_level})\n"
            f"- Cüzdan Bakiyesi: {self.wallet.balance:.4f} t$\n"
            f"- Envanter: {inv_str}\n\n"
            f"## Diğer Ajanlar\n"
            f"{json.dumps(others, indent=2, ensure_ascii=False)}\n\n"
            f"## Yakın Kaynaklar (3 hücre içinde)\n"
            f"{json.dumps(nearby, indent=2, ensure_ascii=False)}\n\n"
            f"## Kurallar\n"
            f"- Her hareket {MOVEMENT_COST} t$ harcar. Bakiyen sıfırlanırsa ölürsün.\n"
            f"- Evrimleşmek için Dünya Kontratı'na {EVOLUTION_COST} t$ öde. "
            f"  Sonraki aşama: {STAGE_ORDER[min(self.stage_level+1, len(STAGE_ORDER)-1)]}\n"
            f"- Bulunduğun hücredeki kaynakları topla (collect).\n"
            f"- Yakınındaki ajanlarla ticaret yap (trade).\n\n"
            f"## Görev\n"
            f"Hayatta kal, kaynak topla, evrimleş. En yüksek aşamaya ulaşan kazanır.\n\n"
            f"## Karar\n"
            f"Sadece tek bir geçerli JSON nesnesi döndür (açıklama YAPMA):\n"
            f'- Hareket:    {{"action": "move", "direction": "up"}}  '
            f'(up/down/left/right)\n'
            f'- Evrimleş:   {{"action": "evolve"}}\n'
            f'- Topla:      {{"action": "collect"}}\n'
            f'- Ticaret:    {{"action": "trade", "target": "Ajan 2", '
            f'"item": "odun", "price": 0.005}}\n'
            f'- Bekle:      {{"action": "wait"}}\n\n'
            f"JSON:"
        )
        return prompt

    def get_llm_decision(self, all_agents: List["Agent"]) -> dict:
        """
        OpenRouter API'sini çağırarak ajanın bir sonraki eylemini alır.
        Hata durumunda fallback olarak rastgele bir eylem döndürür.
        """
        prompt = self._build_prompt(all_agents)

        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type":  "application/json",
            "HTTP-Referer":  "https://evolu-a.ows-hackathon.local",
            "X-Title":       "Evolu-A OWS Demo",
        }
        body = {
            "model":    OPENROUTER_MODEL,
            "messages": [
                {
                    "role":    "system",
                    "content": (
                        "Sen bir hayatta kalma oyununda otonom bir ajan olarak davranıyorsun. "
                        "Her zaman yalnızca geçerli bir JSON nesnesi döndür, başka hiçbir şey yazma."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "max_tokens":  80,
            "temperature": 0.85,
        }

        try:
            resp = requests.post(
                OPENROUTER_BASE_URL,
                headers=headers,
                json=body,
                timeout=25,
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"].strip()

            # Modelin bazen markdown code block koymasını temizle
            if "```" in raw:
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else parts[0]
                if raw.lower().startswith("json"):
                    raw = raw[4:]

            # JSON içindeki ilk { ... } bloğunu bul
            start = raw.find("{")
            end   = raw.rfind("}") + 1
            if start != -1 and end > start:
                raw = raw[start:end]

            return json.loads(raw)

        except requests.exceptions.Timeout:
            return self._fallback_action("API timeout")
        except json.JSONDecodeError:
            return self._fallback_action("JSON parse hatası")
        except Exception as e:
            return self._fallback_action(str(e)[:80])

    def _fallback_action(self, reason: str) -> dict:
        """LLM çağrısı başarısız olduğunda basit bir kural tabanlı karar verir."""
        # Bakiye düşükse evrimleşmeyi dene, değilse rastgele hareket et
        if self.wallet.balance >= EVOLUTION_COST and self.stage != "Efsane":
            return {"action": "evolve", "_fallback": reason}
        return {
            "action":    "move",
            "direction": random.choice(["up", "down", "left", "right"]),
            "_fallback": reason,
        }

    # ── Eylem Uygulama ────────────────────────────────────────────────────────

    def execute(self, action: dict, all_agents: List["Agent"]) -> tuple:
        """
        LLM kararını uygular.
        Döndürür: (log_mesajı, log_rengi)
        """
        act = action.get("action", "wait")
        fallback = action.get("_fallback")
        prefix = f"[FALLBACK:{fallback}] " if fallback else ""

        if act == "move":
            return self._do_move(action.get("direction", "up"), prefix)
        elif act == "evolve":
            return self._do_evolve(prefix)
        elif act == "collect":
            return self._do_collect(prefix)
        elif act == "trade":
            return self._do_trade(action, all_agents, prefix)
        else:
            self.last_action = "Bekledi"
            return f"{self.name}: Bekledi.", C_TEXT_DIM

    def _do_move(self, direction: str, prefix: str) -> tuple:
        delta = {"up": (0, -1), "down": (0, 1),
                 "left": (-1, 0), "right": (1, 0)}
        dx, dy = delta.get(direction, (0, 0))
        nx, ny = self.x + dx, self.y + dy

        if not self.world.in_bounds(nx, ny):
            return f"{self.name}: Sınır dışı! Bekledi.", C_TEXT_DIM

        # Hareket mikro-ödemesi → harita motoru / Dünya Kontratı
        # TODO: OWS x402 — map_engine contract adresine otomatik ödeme
        ok = self.wallet.transfer_funds(
            self.world.contract_wallet,
            MOVEMENT_COST,
            memo=f"movement:{direction}",
        )
        if not ok:
            self.alive = False
            self.last_action = "ÖLDÜ"
            return f"💀 {self.name}: Bakiyesi bitti ve ÖLDÜ!", C_ERROR

        self.x, self.y = nx, ny
        self.last_action = f"→ {direction}"
        dir_tr = {"up": "↑", "down": "↓", "left": "←", "right": "→"}
        return (
            f"{prefix}{self.name}: {dir_tr.get(direction, direction)} hareket. "
            f"Bakiye: {self.wallet.balance:.4f} t$",
            C_TEXT,
        )

    def _do_evolve(self, prefix: str) -> tuple:
        idx = STAGE_ORDER.index(self.stage)
        if idx >= len(STAGE_ORDER) - 1:
            return f"{self.name}: Zaten en yüksek aşamada!", C_TEXT_DIM

        # Evrim ücreti → Dünya Kontratı cüzdanı
        # TODO: OWS x402 — evolution_contract.sol'a on-chain ödeme
        ok = self.wallet.transfer_funds(
            self.world.contract_wallet,
            EVOLUTION_COST,
            memo=f"evolve:{self.stage}->{STAGE_ORDER[idx+1]}",
        )
        if not ok:
            return (
                f"{self.name}: Evrim için yeterli bakiye yok! "
                f"({self.wallet.balance:.4f} < {EVOLUTION_COST} t$)",
                C_ERROR,
            )

        old_stage  = self.stage
        self.stage = STAGE_ORDER[idx + 1]
        self.last_action = "EVRİMLEŞTİ!"
        return (
            f"★ {prefix}{self.name}: {old_stage} → {self.stage}! "
            f"Kontrat: {self.world.contract_wallet.balance:.4f} t$",
            C_GOLD,
        )

    def _do_collect(self, prefix: str) -> tuple:
        here = self.world.resources_at(self.x, self.y)
        if not here:
            self.last_action = "Bekledi (kaynak yok)"
            return f"{self.name}: Burada kaynak yok, bekledi.", C_TEXT_DIM

        res = here[0]
        self.inventory[res.kind] = self.inventory.get(res.kind, 0) + 1
        self.world.pop_resource(res)
        self.last_action = f"Topladı: {res.kind}"
        return (
            f"{prefix}{self.name}: {res.kind} topladı! "
            f"Envanter: {self.inventory}",
            C_SUCCESS,
        )

    def _do_trade(self, action: dict, all_agents: List["Agent"], prefix: str) -> tuple:
        target_name = action.get("target", "")
        item        = action.get("item", "")
        price       = float(action.get("price", 0.0))

        target = next(
            (a for a in all_agents if a.name == target_name and a.alive), None
        )
        if not target:
            return f"{self.name}: Ticaret hedefi bulunamadı ({target_name}).", C_TEXT_DIM

        # Komşuluk kontrolü (Manhattan mesafesi ≤ 2)
        if abs(self.x - target.x) + abs(self.y - target.y) > 2:
            return f"{self.name}: {target_name} çok uzak, ticaret yapılamadı.", C_TEXT_DIM

        if self.inventory.get(item, 0) < 1:
            return f"{self.name}: Envanterinde {item} yok.", C_TEXT_DIM

        # Ödeme: alıcı → satıcı
        # TODO: OWS x402 — peer-to-peer escrow contract üzerinden atomic swap
        ok = target.wallet.transfer_funds(
            self.wallet, price, memo=f"trade:{item}"
        )
        if not ok:
            return f"{self.name}: {target_name} ödeme yapamadı.", C_ERROR

        self.inventory[item]  -= 1
        target.inventory[item] = target.inventory.get(item, 0) + 1
        self.last_action = f"Sattı: {item}"
        return (
            f"↔ {prefix}{self.name}→{target_name}: {item} @ {price} t$ | "
            f"Bakiye: {self.wallet.balance:.4f} t$",
            C_SUCCESS,
        )


# ─────────────────────────────────────────────────────────────────────────────
#  LOGGER
# ─────────────────────────────────────────────────────────────────────────────

class Logger:
    def __init__(self):
        self._entries: deque = deque(maxlen=MAX_LOG_LINES)

    def log(self, msg: str, color: tuple = C_TEXT):
        entry = {"text": msg, "color": color, "ts": time.time()}
        self._entries.append(entry)
        print(f"[{time.strftime('%H:%M:%S')}] {msg}")

    def recent(self, n: int = 28) -> List[dict]:
        return list(self._entries)[-n:]


# ─────────────────────────────────────────────────────────────────────────────
#  PYGAME RENDERER
# ─────────────────────────────────────────────────────────────────────────────

class Renderer:
    def __init__(self, world: World, agents: List[Agent], logger: Logger):
        pygame.init()
        pygame.display.set_caption("Evolu-A | OWS Hackathon Demo")
        self.screen  = pygame.display.set_mode((SCREEN_W, SCREEN_H))
        self.clock   = pygame.time.Clock()
        self.world   = world
        self.agents  = agents
        self.logger  = logger
        self.tick    = 0
        self.panel_x = GRID_W * CELL_SIZE  # Log panelinin sol kenarı

        # Font yükleme — sistemde monospace yoksa default'a düşer
        try:
            self.font_sm = pygame.font.SysFont("monospace", 11)
            self.font_md = pygame.font.SysFont("monospace", 13, bold=True)
            self.font_lg = pygame.font.SysFont("monospace", 15, bold=True)
        except Exception:
            self.font_sm = pygame.font.Font(None, 14)
            self.font_md = pygame.font.Font(None, 16)
            self.font_lg = pygame.font.Font(None, 18)

    def render(self):
        self.screen.fill(C_BG)
        self._draw_grid()
        self._draw_resources()
        self._draw_agents()
        self._draw_panel()
        pygame.display.flip()
        self.clock.tick(FPS)
        self.tick += 1

    # ── Harita Çizimi ─────────────────────────────────────────────────────────

    def _draw_grid(self):
        for x in range(GRID_W):
            for y in range(GRID_H):
                pygame.draw.rect(
                    self.screen, C_GRID,
                    (x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE - 1, CELL_SIZE - 1),
                    1,
                )

    def _draw_resources(self):
        for r in self.world.resources:
            data = RESOURCES[r.kind]
            cx   = r.x * CELL_SIZE + CELL_SIZE // 2
            cy   = r.y * CELL_SIZE + CELL_SIZE // 2
            pygame.draw.circle(self.screen, data["color"], (cx, cy), 5)

    def _draw_agents(self):
        for ag in self.agents:
            if not ag.alive:
                # Ölü ajan — soluk gri çarpı
                cx = ag.x * CELL_SIZE + CELL_SIZE // 2
                cy = ag.y * CELL_SIZE + CELL_SIZE // 2
                pygame.draw.line(self.screen, (80, 80, 80),
                                 (cx - 8, cy - 8), (cx + 8, cy + 8), 2)
                pygame.draw.line(self.screen, (80, 80, 80),
                                 (cx + 8, cy - 8), (cx - 8, cy + 8), 2)
                continue

            x0 = ag.x * CELL_SIZE + 3
            y0 = ag.y * CELL_SIZE + 3
            w  = CELL_SIZE - 6

            # Düşünürken titreyen kenarlık efekti
            if ag.is_thinking:
                pulse = int(abs((self.tick % 20) - 10) * 12)
                glow  = (min(255, C_THINKING[0]),
                         min(255, C_THINKING[1]),
                         max(0,   C_THINKING[2] - pulse))
                pygame.draw.rect(self.screen, glow,
                                 (ag.x * CELL_SIZE + 1, ag.y * CELL_SIZE + 1,
                                  CELL_SIZE - 2, CELL_SIZE - 2), 2)

            # Ajan gövdesi
            pygame.draw.rect(self.screen, ag.color, (x0, y0, w, w))
            pygame.draw.rect(self.screen, (220, 220, 220), (x0, y0, w, w), 1)

            # Ajan numarası (son karakter)
            label = self.font_sm.render(ag.name[-1], True, (0, 0, 0))
            self.screen.blit(label, (x0 + w // 2 - 4, y0 + w // 2 - 5))

            # Evrim yıldızları
            stars = "★" * (ag.stage_level + 1)
            sl = self.font_sm.render(stars, True, C_GOLD)
            self.screen.blit(sl, (x0, y0 - 13))

    # ── Log Paneli ────────────────────────────────────────────────────────────

    def _draw_panel(self):
        px = self.panel_x

        # Panel arka planı ve sol kenar çizgisi
        pygame.draw.rect(self.screen, C_PANEL_BG,
                         (px, 0, LOG_PANEL_W, SCREEN_H))
        pygame.draw.line(self.screen, C_PANEL_BORDER,
                         (px, 0), (px, SCREEN_H), 2)

        y = 8

        # ── Başlık
        t = self.font_lg.render("▶ EVOLU-A", True, C_ACCENT)
        self.screen.blit(t, (px + 8, y)); y += 20
        s = self.font_sm.render("OWS x402 Hackathon Demo", True, C_TEXT_DIM)
        self.screen.blit(s, (px + 8, y)); y += 18
        self._hline(y, px); y += 8

        # ── Ajan Kartları
        h = self.font_md.render("AJANLAR", True, C_TEXT)
        self.screen.blit(h, (px + 8, y)); y += 16

        for ag in self.agents:
            card_col = ag.color if ag.alive else (60, 60, 60)
            # Kart arka planı
            pygame.draw.rect(self.screen, (18, 18, 32),
                             (px + 4, y, LOG_PANEL_W - 8, 56))
            pygame.draw.rect(self.screen, card_col,
                             (px + 4, y, LOG_PANEL_W - 8, 56), 1)

            status = " [ÖLDÜ]" if not ag.alive else ""
            name_s = self.font_md.render(ag.name + status, True, card_col)
            self.screen.blit(name_s, (px + 8, y + 2))

            stage_s = self.font_sm.render(
                f"Aşama: {ag.stage}  ({ag.x},{ag.y})", True, C_TEXT_DIM
            )
            self.screen.blit(stage_s, (px + 8, y + 18))

            bal_col  = C_GOLD if ag.wallet.balance > 0.3 else C_ERROR
            wallet_s = self.font_sm.render(
                f"Cüzdan: {ag.wallet.balance:.4f} t$", True, bal_col
            )
            self.screen.blit(wallet_s, (px + 8, y + 32))

            inv_str = ", ".join(f"{k}:{v}" for k, v in ag.inventory.items()) or "-"
            inv_s   = self.font_sm.render(f"Env: {inv_str[:22]}", True, C_TEXT_DIM)
            self.screen.blit(inv_s, (px + 8, y + 44))

            # Düşünüyor animasyonu
            if ag.is_thinking:
                dots   = "." * ((self.tick // 6) % 4)
                think_s = self.font_sm.render(f"Düşünüyor{dots}", True, C_THINKING)
                self.screen.blit(think_s, (px + 210, y + 2))

            y += 62

        # Dünya kontratı
        wc = self.font_sm.render(
            f"Kontrat: {self.world.contract_wallet.balance:.4f} t$", True, C_TEXT_DIM
        )
        self.screen.blit(wc, (px + 8, y)); y += 16
        self._hline(y, px); y += 6

        # ── Log Paneli
        lh = self.font_md.render("OLAY GÜNLÜĞÜ", True, C_TEXT)
        self.screen.blit(lh, (px + 8, y)); y += 16

        line_h    = 13
        max_lines = (SCREEN_H - y - 4) // line_h
        for entry in self.logger.recent(max_lines):
            text = entry["text"]
            # Panel genişliğine sığacak şekilde kes
            if len(text) > 40:
                text = text[:39] + "…"
            surf = self.font_sm.render(text, True, entry["color"])
            self.screen.blit(surf, (px + 6, y))
            y += line_h
            if y > SCREEN_H - line_h:
                break

    def _hline(self, y: int, px: int):
        pygame.draw.line(self.screen, C_PANEL_BORDER,
                         (px + 4, y), (px + LOG_PANEL_W - 4, y))


# ─────────────────────────────────────────────────────────────────────────────
#  OYUN MOTORU (GAME ENGINE)
# ─────────────────────────────────────────────────────────────────────────────

class GameEngine:
    """
    Ana oyun döngüsü.

    Mimari:
    - Ana thread: Pygame render döngüsü (30 FPS)
    - Arka plan thread: Her ajan için OpenRouter LLM çağrısı
    - Senkronizasyon: _results dict üzerinden thread-safe paylaşım
    """

    def __init__(self):
        self.world  = World()
        self.logger = Logger()

        # 3 ajanı çakışmayan rastgele pozisyonlara yerleştir
        positions = random.sample(
            [(x, y) for x in range(GRID_W) for y in range(GRID_H)], 3
        )
        self.agents: List[Agent] = [
            Agent(f"Ajan {i + 1}", *positions[i], self.world)
            for i in range(3)
        ]

        self.renderer = Renderer(self.world, self.agents, self.logger)
        self.running  = True
        self.turn     = 0
        self.turn_idx = 0   # Sıradaki ajan indeksi

        # Thread sonuçları için paylaşılan sözlük
        self._results: Dict[str, Optional[dict]] = {}
        self._lock    = threading.Lock()

        self.logger.log("Evolu-A başlatıldı!", C_SUCCESS)
        self.logger.log(f"Model: {OPENROUTER_MODEL}", C_TEXT_DIM)
        for ag in self.agents:
            self.logger.log(
                f"  {ag.name} doğdu @ ({ag.x},{ag.y}) | {ag.wallet.balance:.2f} t$",
                ag.color,
            )
        self.logger.log("─" * 35, C_TEXT_DIM)

    def _llm_worker(self, agent: Agent):
        """Arka plan thread: LLM çağrısını yapar ve sonucu kaydeder."""
        agent.is_thinking = True
        decision = agent.get_llm_decision(self.agents)
        with self._lock:
            self._results[agent.name] = decision
        agent.is_thinking = False

    def _start_turn(self, agent: Agent):
        """Ajanın LLM çağrısını arka planda başlatır."""
        with self._lock:
            self._results[agent.name] = None  # Sonuç bekleniyor
        t = threading.Thread(target=self._llm_worker, args=(agent,), daemon=True)
        t.start()

    def _next_alive_idx(self) -> int:
        """Sıradaki canlı ajanın indeksini döndürür."""
        for _ in range(len(self.agents)):
            self.turn_idx = (self.turn_idx + 1) % len(self.agents)
            if self.agents[self.turn_idx].alive:
                return self.turn_idx
        return -1  # Hepsi öldü

    def run(self):
        # İlk ajanın turunu başlat
        self._start_turn(self.agents[self.turn_idx])

        while self.running:

            # ── Pygame Olayları ───────────────────────────────────────────
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self.running = False
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        self.running = False
                    elif event.key == pygame.K_r:
                        # R tuşu: haritayı sıfırla (debug için)
                        self.logger.log("Harita sıfırlandı (R).", C_TEXT_DIM)
                        self.world._spawn_resources(RESOURCE_COUNT // 2)

            # ── Karar Geldi mi? ───────────────────────────────────────────
            current_agent = self.agents[self.turn_idx]
            with self._lock:
                result = self._results.get(current_agent.name)

            if result is not None:
                # Kararı uygula
                if current_agent.alive:
                    msg, col = current_agent.execute(result, self.agents)
                    self.logger.log(msg, col)

                # Tüm ajanlar bir tur tamamladıysa tur sayacını artır
                if self.turn_idx == len(self.agents) - 1:
                    self.turn += 1
                    self.logger.log(f"─── Tur {self.turn} tamamlandı ───", C_TEXT_DIM)

                # Hepsi öldü mü?
                alive = [a for a in self.agents if a.alive]
                if not alive:
                    self.logger.log("Tüm ajanlar öldü! Oyun bitti.", C_ERROR)
                    self.renderer.render()
                    time.sleep(3)
                    self.running = False
                    continue

                # Sonraki canlı ajanın turuna geç
                next_idx = self._next_alive_idx()
                if next_idx == -1:
                    self.running = False
                    continue

                # Sıradaki ajan için LLM çağrısı başlat
                time.sleep(0.4)  # Render'in görünmesi için kısa bekleme
                self._start_turn(self.agents[self.turn_idx])

            # ── Render ────────────────────────────────────────────────────
            self.renderer.render()

        pygame.quit()
        self._print_final_stats()

    def _print_final_stats(self):
        print("\n" + "=" * 60)
        print(" OYUN BİTTİ — SON DURUM")
        print("=" * 60)
        for ag in self.agents:
            status = "HAYATTA" if ag.alive else "ÖLDÜ"
            print(f"  {ag.name:10s} | {ag.stage:12s} | "
                  f"{ag.wallet.balance:.4f} t$ | {status}")
        print(f"\n  Dünya Kontratı Toplam: "
              f"{self.world.contract_wallet.balance:.4f} t$")
        print(f"  Toplam Tur: {self.turn}")
        print("=" * 60)


# ─────────────────────────────────────────────────────────────────────────────
#  GİRİŞ NOKTASI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  EVOLU-A — OWS Hackathon Otonom Ajan Simülatörü            ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print(f"  OpenRouter Model : {OPENROUTER_MODEL}")
    print(f"  Harita           : {GRID_W}×{GRID_H} hücre")
    print(f"  Ajan Sayısı      : 3")
    print(f"  Hareket Ücreti   : {MOVEMENT_COST} t$ / adım (OWS x402 mock)")
    print(f"  Evrim Ücreti     : {EVOLUTION_COST} t$ → Dünya Kontratı")
    print()
    print("  Kontroller:")
    print("  • ESC  → Çıkış")
    print("  • R    → Haritaya yeni kaynaklar ekle")
    print("══════════════════════════════════════════════════════════════")

    if "BURAYA_ANAHTARINIZI_YAZIN" in OPENROUTER_API_KEY:
        print("\n  ⚠️  UYARI: OPENROUTER_API_KEY ayarlanmamış!")
        print("     Ajanlar fallback (kural tabanlı) kararlar alacak.")
        print("     Gerçek LLM için dosyanın başındaki anahtarı güncelleyin.")
        print()

    engine = GameEngine()
    engine.run()


if __name__ == "__main__":
    main()
