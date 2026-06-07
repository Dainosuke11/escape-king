---
name: Escape the King — 仙人 job & 戦隊ヒーロー item restriction
description: Gauge system, element alternation, ability/skill handlers, sentai item restriction details
---

## 仙人 Gauge System
- `senninGauge` initialized via `senninUnit: true` in JOB_DATA (spread at entity init)
- AP conservation (`applyApRestRecovery`): sennin/senninUnit entities get gauge += remainAp instead of HP/ability recovery
- `unzan_angya` ability: AP+2, `_unzanTurn=turn`, gauge+1; next turn-start if `_senninSkillUsedTurn !== turn-1` → bonus gauge+3
- Skill `isSkillConditionMet`: always true for sennin (gauge=0 → min scale)

## Element Alternation
- `processTurnStartEffects`: `e.element = (turn%2===1) ? 'water' : 'grass'`
- Initial JOB_ELEMENT: `grass`; JOB_SKILL_ELEMENT: `water`

## Abilities
| Key | Effect |
|-----|--------|
| unzan_angya | AP+2, gauge+1, bonus+3 next turn if no skill |
| fundo_gekkoh | gauge≥1 consume, r1 4dmg+knockback fire |
| kako_tosen | gauge≥1 consume, r2 3dmg grass |
| kyoshin_tankai | gauge≥1 consume, line-5 4dmg+knockback water |
| meikyo_shisui | 1T invincible+AP+1+gauge+1 / r2 enemies AP-2+4seal |
| banzai_jiai | r1 3dmg+5-cell knockback, chain 3dmg water, gauge+1 |
| seisei_ruten | turn≥5, front wolf+falcon+rock (monsterTemplate), 2T expiry, gauge+1 |

## Skill: 自然淘汰 (skill_sennin_tota)
- `executeSkill`: saves `_senninSkillGauge=gauge`, resets gauge=0, sets `actionMode='skill_sennin_tota'`
- Scale: gauge ≤1→r2/d2, ≤3→r3/d3, ≤5→r4/d4, ≤7→r5/d5, ≤9→r6/d6, ≤11→r7/d7, ≥12→r8/d8
- `executeRushSkill`: AoE dmg+AP-2+knockback+4-seal all enemies in range; gauge+3 after

## monsterTemplate additions
Added `wolf` (HP2/AP3/bite) and `falcon` (HP3/AP2/peck/flying) cases for 生々流転.

## 戦隊ヒーロー Item Restriction
- `applyItem`: if `entity.type === 'sentai_hero' && entity.sentaiMembers`
  - `star`: only active member maxHp+10, entity.maxHp+10 (shared pool)
  - `shoes`: only entity.ap+1 (no maxAp change), shoesTimer=3
  - `sword`: atkBonus+1 as normal (1 member benefit with flavour msg)
- **Why:** Heroes rely on teamwork not items; prevents over-stacking on shared-HP pool.
