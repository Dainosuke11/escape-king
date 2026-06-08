---
name: Escape the King painter job
description: Implementation details and design decisions for the painter (絵描き) job.
---

# Painter Job Implementation

## Core Architecture

- `painterUnit: true` flag on entity, initialized with `imaginationGauge:0, _painterElements:[], _activePaintColors:[]`
- `rainbowTileMap` global: `"r,c" -> {origTile, ownerTeam}` — always restore via this map, never hardcode
- PAINT_COLORS = ['red_paint','blue_paint','green_paint','white_paint','black_paint']
- PAINT_ELEM_MAP = { red_paint:'fire', blue_paint:'water', green_paint:'grass', white_paint:'light', black_paint:'dark' }

## Turn Start (processTurnStartEffects)

Insert after barbarianUnit block. Each turn: IG+1, shuffle 5 elements pick 2 as `_painterElements`, consume `_pendingPainterElement` (set by moving_painting death), reset `_activePaintColors`.

## Color Combo System (setMode interceptor)

Color abilities are intercepted in `setMode()` BEFORE setting `actionMode`. On first color: set `_activePaintColors=[color]`, actionMode='paint_combo'. On additional colors: append to array. IG check: must have IG >= X (number of colors). Only colors matching `_painterElements` elements are allowed.

## paint_combo in handleAbilityTarget

- Entity target: X*2 damage + each color's effect (red=burn2T, blue=all abilities seal 1T, green=knockback2, white=defDebuff+1(2T), black=poison3T)
- Tile target (no entity): place rainbow_tile at that location
- Consumes IG-X and each selected color ability -1

## Rainbow Tile Step-On

In tile step-on handler (before magic_circle block). Own team: HP+1 + up to 5 random ability+1. Enemy team: 2 damage. Always restores original tile from `rainbowTileMap`.

## frame_throw (額縁投げ)

Saves `_paintOrigData` on target, converts to `painted_entity` (HP99/AP0), sets `_paintReleaseOnTurn = turn+1`. Release check is in processTurnStartEffects (checks ALL entities with that flag, not just painter).

## moving_painting Death Callback

In `deadSpecials` filter (add `e.type==='moving_painting'`). Finds master via `_mpMasterId`. Grants all color abilities +1, IG+1, sets `_pendingPainterElement` for next turn.

## executeSkill: 虹の大傑作

Conditions: IG≥5 + all 5 elements in `_painterElements` + all 5 color abilities ≥1. Effect: IG-5, all colors-1, radius 7 rainbow tiles, all enemies -7 HP.

**Why:** Conditions make it very hard to achieve normally — requires sanpo/dessin/moving_painting to accumulate elements and IG.
