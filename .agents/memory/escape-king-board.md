---
name: Escape the King board geometry
description: Fixed coordinate conventions for the 21x21 game board and stage layouts
---

# Board geometry (artifacts/escape-king/index.html)

- Board is `SIZE=21` (rows/cols 0-20). Center = (10,10). Player (p1) starts bottom (row ~20), CPU (c1) top (row 0).
- Player territory = high rows (bottom); enemy territory = low rows (top). `checkEnemyTerritory`: player crosses at r<=9, cpu at r>=11.
- `isWalkable` blocked terrain list: `['river','rock','volcano','mine','bridge_up','whirlpool']`. Any NEW impassable tile type must be added here. All other new tile types are walkable by default.

## Stage layouts (after the big rework)
- **Castle**: 9x9 `castle_tile` at rows/cols 6-14; moat (river) ring at row 5/15 & col 5/15; symmetric width-1 drawbridges N(5,10) S(15,10) W(10,5) E(10,15); switches at (7,10)(13,10)(10,7)(10,13); `BRIDGE_TILE_MAP` must match bridge tile coords.
- **BigRiver**: river rows 6-14; edge bridges at col 1 and col 19 (NOT center); whirlpools in river; boats at (6,4)(6,16)(14,4)(14,16) river edges; kraken spawns turn 3 then every 5.
- **Mountain**: 9x9 snow rows/cols 6-14; summit 6x6 rows/cols 7-12; 4 cannons at summit corners; 8 roll-rocks on summit; cable_board+cable_tile L-routes: enemy (5,5)->summit, player (15,15)->summit. Cable movement: board/exit only at cable_board or summit ends (enforced in handleTileClick mountain block).

**Why:** these coordinates are interdependent (BRIDGE_TILE_MAP vs bridge placement, cable restriction vs cable tile coords). Changing one without the others silently breaks bridges/cable.

## Phase B stages (graveyard/nighttown/skyfort/chaos/random) — DONE & e2e tested
- New impassable tiles added to `isWalkable`: `gravestone`, `sky_void`, `fallen_floor`.
- Soul economy: globals `souls={player,cpu}`, `currentActingTeam` (set to team in `startTurn`, to `'npc'` at top of `npcLogic`). `reapSouls()` runs at top of `checkWin()`; only credits when actingTeam is player/cpu. NPC monsters carry `soulValue`/`soulCounted`.
- `monsterTemplate(type,r,c)` + `spawnAt()` + `randomEmptyCells(n)` build/spawn zombie/frankenstein/spirit/great_spirit/bat/werewolf/vampire. Bite (heal self) & possess (AP-1) handled in npcLogic generic melee branch by `n.abilities.bite/possess`.
- Spawns in `startTurn`: graveyard/chaos zombies turn>=3 every 3 (10% franken); nighttown monster every 2; skyfort `resolveFallingFloors()` turn>=3; `mergeSpirits()` (2 spirits within radius3 → 大悪霊 hp5) on graveyard/nighttown/chaos.
- Church purification: `doPurify(entity)` consumes `souls[team]` → heal that many HP + reset abilities to `entity.initialAbilities` (snapshotted on p1/c1 at init). Button shown in updateUI when on `church` tile.
- Items: `placeChurchesAndItems()` sets 2 hidden `item_tile` per side; `applyItem` → star(maxHp+10), shoes(maxAp+1 for 3 turns via `shoesTimer` in processTurnStartEffects), sword(`atkBonus`+1 permanent, added to sword/punch/dagger/poison_dagger/spear damage).
- Bridge-cross on graveyard/chaos with souls → spawns spirits near enemy, zeroes souls (in checkTileEffects).
- `defaultGround()` returns stage's base ground (graveyard_ground/nighttown_ground/fortress_floor/plains) — use when clearing item/gravestone tiles.
- UI: ability buttons relabeled `（残り◯回使用可能）`/`（無制限）` + `ABILITY_TIPS` tooltips; `#souls-indicator` HUD; `falling-warn` red highlight in render for skyfort.

## Phase C progress
DONE & e2e tested (contained items): assassin decoy doll (`decoy` ability=1, type 'decoy' HP1/AP2 punch∞, self -1hp at own turn start, assassin `decoyStealth` keeps stealth while ally decoy alive — maintained in processTurnStartEffects); stacking poison (`poisonStacks` incremented on poison_dagger/poison_bow, damage=stacks in processTurnStartEffects, reset when timer expires); bow uses 3→5; infantry squad skill ONCE (removed the 5-turn skillUsed re-enable block); drop-rock-30dmg via `isRockSurrounded(r,c)` (4 orthogonal rocks; board edge counts as rock) — handled in isValidTarget('drop_rock') + handleAbilityTarget drop_rock branch; enemy stepping on magic_circle removes it (added magic_circle→plains in cpuLogic 2 move branches + npcLogic move branch). King invincibility transparent move/rock-destroy already done in Phase A.

## Phase C REMAINING (big new jobs)
- 泥棒/thief (hp30,ap2): drop_rock∞, dagger×10, dash×10, trap×5, shatter×3, smokescreen×3, miner_call×1, steal×5, skill=copy. Smokescreen: radius2, enemy AP-1+knockback, thief stealth 1T. miner_call: HP3 miner (ap2, shatter∞ pickaxe-atk1 r1, dig∞ r1 — enemy crossing dug tile -2AP & tile vanishes; 2+ dug tiles + ally stops on one → hole_move teleport between holes; each rock miner shatters +1 pickaxe atk). steal: r1, steal random ability (not shatter) from enemy, 1 use granted/enemy loses 1. copy skill: r2, copy enemy's skill, usable from that turn.
- 獣使い/beastmaster (hp30,ap2): drop_rock∞, shatter×5, dash×5, wolf_summon×1, tame×1, falcon_summon×1, punch×5, great_summon×1, charge_order×1, skill=dragon_summon. Summon abilities & skill only after turn 5. tame: r2, permanently converts a non-job monster/summon to ally. falcon: bird hp3 ap2 peck atk1∞ flying (transparent move, 50% dodge melee, ranged≥2 always hits). great_summon: random ally summon from hp≥3 pool (yeti/golem/oni). dragon_summon skill: 2-tall dragon hp8 ap2, fire-breath r2 4-tile-square AoE atk2∞, bite r1 atk2∞, flying; if beastmaster within r1 → rideable (merge stats like camel).
- Add both to JOB_DATA + 3 job <select> dropdowns + cpuJobs arrays.

## Phase D TODO
tutorial start-screen option (駒/アビリティ/スキル/体力/魔法陣/大砲/敵陣突破ボーナス説明); Firebase anon auth + Firestore matchmaking_queue/rooms (±1→±5 staged, no-rematch-within-2 RP void); ranked RP (unlock after single-player Lv8; base 10,格上 +D*2, deflate: rank1-5 no loss, rank6-10 -5; rankup at 100 carryover; rankdown below 0 →90, floor rank1); 1-min turn timer; reconnect (api-server WebSocket: session-id in localStorage, 15-30s Suspended grace, snapshot resync; client auto-reconnect 3s×5).
