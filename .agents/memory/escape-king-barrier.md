---
name: Escape the King barrier system
description: How invin/barrier works — absorbs 1 hit then breaks; if not hit expires at turn start.
---

## Rule
Barrier (`invin=true`) absorbs exactly 1 attack hit, then disappears immediately. If never hit, it expires at the START of the next turn (via `invinTimer` decrement in `processTurnStartEffects`).

**Exception**: `invinTimer === 999` = permanent invincibility (e.g. train NPC). Never break these.

**Why:** Design intent — every barrier, including counter (王/竜人族), should absorb exactly one hit.

## How to apply
- Setting a barrier: `e.invin = true; e.invinTimer = Math.max(e.invinTimer||0, 1);`
- Helper function `breakBarrierOnHit(t, se, dmg)` (defined just before `applyCounterReflect`):
  - If `t.counterBarrierActive`: calls `applyCounterReflect(se, t, dmg, 0)` which reflects damage AND breaks invin
  - Else: sets `invin=false, invinTimer=0` and shows message
  - Guard: returns early if `!t.invin || t.invinTimer === 999`
- Single-target: post-attack hook in `handleAbilityTarget` calls `breakBarrierOnHit(targetEntity, se, 0)` when `targetEntity.team !== se.team && targetEntity.invin && invinTimer !== 999`
- AoE loops: every `if (!t.invin) { damage }` in handleAbilityTarget AND in cpuTurn has `else { breakBarrierOnHit(t, se, dmg); }` added
- Counter barrier (`counterBarrierActive`): `applyCounterReflect` is also called explicitly per-ability for the reflect effect; `breakBarrierOnHit` handles AoE cases that don't call it explicitly
- Iai counter also breaks barriers via its own forEach (line ~13220)
- `invinTimer` expiry at turn start handles the "not hit" case — no code change needed there.
