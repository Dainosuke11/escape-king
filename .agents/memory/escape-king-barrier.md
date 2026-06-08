---
name: Escape the King barrier system
description: How invin/barrier works — absorbs 1 hit then breaks; if not hit expires at turn start.
---

## Rule
Barrier (`invin=true`) absorbs exactly 1 attack hit, then disappears immediately. If never hit, it expires at the START of the next turn (via `invinTimer` decrement in `processTurnStartEffects`).

**Why:** Old behavior let barrier survive the full turn regardless of hits — too strong per design intent.

## How to apply
- Setting a barrier: `e.invin = true; e.invinTimer = Math.max(e.invinTimer||0, 1);`
- Breaking on hit: at the END of `handleAbilityTarget`, AFTER the ability handler runs (which already blocked damage via `if (!e.invin)`), there is a post-attack hook:
  ```js
  if (targetEntity && targetEntity.team !== se.team && targetEntity.invin && attackModes.includes(actionMode)) {
      targetEntity.invin = false; targetEntity.invinTimer = 0;
  }
  ```
- Iai counter also breaks barriers on hits it delivers to each entity.
- AoE ability barrier breaks are NOT automatically handled by the post-hook (only direct `targetEntity` hits). AoE-specific barrier break must be added per-ability if needed.
- `invinTimer` expiry at turn start handles the "not hit" case — no code change needed there.
