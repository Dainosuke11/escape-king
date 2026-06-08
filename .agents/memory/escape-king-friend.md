---
name: Escape the King friend system
description: Friend list feature — DB, REST API, and frontend tab in online lobby.
---

## Database
- Table: `ek_friends` created via raw SQL (`CREATE TABLE IF NOT EXISTS`) in `artifacts/api-server/src/routes/friends.ts` at module load time
- Schema: id SERIAL PK, user_id TEXT, friend_user_id TEXT, friend_name TEXT, friend_icon TEXT, added_at TIMESTAMP; UNIQUE(user_id, friend_user_id)
- Max 10 friends per user enforced by count check before INSERT

## REST API (all at /api/friends)
- `GET /api/friends/:userId` — returns [{friend_user_id, friend_name, friend_icon}] ordered by added_at DESC
- `POST /api/friends` — body: {userId, friendUserId, friendName, friendIcon}; responds {ok:true}
- `DELETE /api/friends` — body: {userId, friendUserId}; responds {ok:true}
- Router registered in `artifacts/api-server/src/routes/index.ts` as `router.use(friendsRouter)`

## Frontend (index.html)
- New "👥 フレンド" tab button: id="tab-friend" in .lobby-tabs
- Panel: id="friend-panel" — friend list div + add form (input + button) + status + userId display
- `switchLobbyTab('friend')` shows friend-panel, calls `loadFriends()`, sets #my-user-id-display
- Functions: `loadFriends()`, `addFriend()`, `removeFriend(friendId)`, `escapeHtml(s)` (all async where needed)
- Uses `getUserId()` for the local user's ID; uses `getApiBase()` for API URL construction

**Why:** Friends stored server-side (not localStorage) so they persist across devices and sessions. Raw SQL used for table creation because drizzle schema file not accessible from routes layer without full migration setup.
