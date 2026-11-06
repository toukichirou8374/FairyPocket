# H3-1：FairyPocket ↔ Fairy Hub 同步（行為說明，含 H3-1.1 修補）

> 分支 `feat/h3-pocket-sync`（從 H2.3 驗收版 `b599b4a` 分出；H2.3 本身保留在 `feat/h2-hub`，並加上本機標籤 `h2.3-accepted`）。
> 本批是「隔離整合」：同步適配器與測試都完成，但**還沒接進 App 的畫面與流程**（接上是下一階段）。

## 1. FairyPocket v0.49.2 實際資料核對
| 項目 | 實際程式 | 同步方式 |
|---|---|---|
| PetState | `src/game/state.ts`：version 1、id（`ABCD-1234`）、name（12 字）、personality、health 1–20、hunger 0–20、energy／affection／mood 0–100、asleep、onboarded、createdAt、lastSeen、stats（fed／petted／played）、memory | 第一次同步時用 `pet/register` 整份登記（Hub 嚴格驗證）；之後只送事件 |
| 存檔 | `src/game/save.ts`：localStorage `fairypocket.save.v1`（備份 `…v1.bak`），格式 `{app, format:1, savedAt, pet}` | **不讀寫、不修改**；同步資料另存 `fairypocket.hubsync.v1` |
| 感情 | 只在 `feed()`（+3，最愛 +6）、`pet()`（+1.5）、`play()`（+4）改變 | 對應事件 FED／PETTED／PLAYED，Hub 用相同規則計算 |
| 名字 | `main.ts` 的 rename 與 onboard 兩處 | 新事件 RENAME（只限手機） |
| 記憶 | `src/brain/brain.ts`：`fairypocket.brain.mem.v1` 的 `notes`（字串，最多 40）與 `turns`（最近 16 句） | notes → MEMORY_ADD／MEMORY_REMOVE（private）；turns → DIALOGUE_ADD（可選） |
| 生活數值（飽食、精神、心情、生命） | `tickPet()` 每幀在手機上變化 | 手機控制期間不同步（VITALS_SYNC 停用）；從 Minecraft 接回控制權時採用 Hub 的值 |
| 個人雲端 AI | `scripts/cloud-ai.mjs`＋轉接服務的 `/api/cloud/*` | **不相關、不變**；適配器不碰雲端 |

## 2. 同步適配器（`src/hub/pocketSync.ts`）
App 在原本的動作之後呼叫（下一階段接上）：
```
recordFed(food) / recordPetted() / recordPlayed() / recordRename(name) / recordDialogue(who, name, text)
syncNotes()        // 比對本機記憶，產生新增／刪除
sync()             // 同步一次
takeover()         // 主人明確「把悅靈叫回手機」
```

### 2.1 離線與重送
- 每個動作**先寫進本機的待送佇列**（`fairypocket.hubsync.v1`），送成功（APPLIED 或 DUPLICATE）才移除。
- opId＝`fp-<來源 ID 後 8 碼>-<遞增序號>`，序號存在本機；**重送時 opId 不變**，Hub 依（角色, 來源 ID, opId）去重。
- 來源 ID（`pocket-<16 個十六進位字>`）第一次產生後固定，App 重啟、斷線重連都一樣。
- 情況：
  - 完全離線 → 佇列保留，狀態 `offline`；App 重啟後佇列還在。
  - 請求已到 Hub、回應遺失 → 重送時 Hub 回 DUPLICATE，不會多算。
  - **本機同步資料損壞（H3-1.1）**：無法解析、或可解析但結構異常（舊版格式、來源 ID、opId、序號、型別、欄位不對）→ 狀態 `localCorrupt`：停止同步、不連線、**不建立新的來源 ID、不覆寫原始內容、不清空待送事件**（原始內容就是證據）；之後的 record* 回傳 false（不假裝記下）。沒有安全依據時不做任何自動復原，需要人工處理。只有「完全沒有同步資料」才會建立新的。
  - **本機寫入失敗（H3-1.1）**：所有本機狀態變更都在複本上進行，寫入成功才換上；寫入失敗回 `localSaveFailed`，不算同步成功（Hub 若已提交，之後重送會是 DUPLICATE）。

### 2.1.1 首次登記（H3-1.1）
- 第一次同步前，先把「登記快照（當下的 PetState）＋分界序號（當下的最後一個事件序號）」存進本機，之後的重試、回應遺失、App 重啟都用**同一份**。
- **登記識別碼（H3-1.2）**：快照建立時一併產生隨機的 `regId`（`reg-` ＋ 32 個十六進位字）並存進本機；登記請求帶上它。Hub 把「請求的來源 ID＋regId 的雜湊」和悅靈文件同一個交易保存（跟著耐久儲存與備份走，只存雜湊）。識別碼只用來確認登記冪等性，**不是裝置身分認證**。
- 回應的判斷（H3-1.2）：
  - `201`：這次登記成功。
  - `200 DUPLICATE`：Hub 核對來源 ID 與識別碼雜湊都相同 → 是這台裝置先前完成的同一次登記（回應遺失、App 或 Hub 重啟後的重試）。
  - `409 EXISTS`＋`registration: other`：別的裝置或來源已建立 → `registrationConflict`。
  - `409 EXISTS`＋`registration: unknown`（舊資料沒有可靠紀錄、或文件損壞）→ `registrationUnverified`。
  - 兩種 409 都**停止**：不刪事件、不讀取、不送事件、不改手機的數值與記憶、不回報 ok；快照、來源 ID、事件 ID、佇列全部保留，等人處理。
- 登記成功（201，或 Hub 證實的 200 DUPLICATE）時，在同一次本機寫入裡：標記已登記、保存 Hub 回傳的 revision／epoch、**只移除序號 ≤ 分界的 FED／PETTED／PLAYED／RENAME**（它們的效果已經在快照裡）。
- 序號 > 分界的事件（登記期間、重啟後新增的）保留並照常送出；記憶與對話不在快照裡，分界前的也照常送出。
- App 的使用方式：先照原本規則改本機狀態，**再**呼叫 record*（快照才會包含分界前的動作）。

### 2.2 revision 衝突
- 每次送出都帶最新讀到的 `baseRevision` 與 `epoch`。
- 收到 `REVISION_CONFLICT`／`STALE_EPOCH`／`NOT_CONTROLLER` → **重新讀取**，再用**同樣的 opId**把同一批事件送到新版本上。手機的事件都是增量（+1 次摸頭）或附加（一條記憶），套在新版本上結果正確，不會蓋掉別人的變化。
- 收到 `ID_COLLISION`／400／403 → 一筆一筆送找出是哪一筆，放進「無法送出」清單保留給人檢查，不無限重試。
- 507／503／其他 → 停止，佇列保留，下次再試。

### 2.3 跨平台控制權交接
| 情況 | 適配器的行為 |
|---|---|
| 手機是控制者 | 直接送 |
| 沒有控制者（例如 Minecraft 已放開） | 取得控制權後送 |
| Minecraft 正在控制 | **不搶**：先送不改數值的事件（記憶、改名、對話），數值事件留在佇列，狀態 `waitingControl` |
| 主人按「叫回手機」（`takeover()`） | 即使 Minecraft 正在控制也取得控制權；Minecraft 手上的舊 epoch 立刻失效 |
| 從 Minecraft 接回控制權（正在控制或剛放開） | 先採用 Hub 的生活數值（Minecraft 期間的 TIME_PASSED、FED 等），再送手機的事件 |

為了判斷「剛放開的是不是 Minecraft」，Hub 新增只給手機看的 `lastController`（上一個控制者的角色）。

### 2.4 採用遠端資料（防止進度倒退）
- **待送佇列清空後**才採用 Hub 的感情與統計（Hub 已包含手機的全部事件＋Minecraft 的事件）；還有待送的改名時不採用名字。
- Minecraft 加的共享記憶另外回傳（`sharedMemories`），**不放進手機的 notes**，不會擠掉手機的記憶。
- **防倒退**：記住已確認的最大 revision；Hub 的 revision 比它小（例如管理者還原了舊備份）→ 狀態 `hubRollback`，**停止同步、不採用任何遠端數值、保留佇列**，等人處理。
- **已確認的版本立即保存（H3-1.1）**：登記、取得控制權、送出事件、讀取的成功回應帶回的 revision／epoch，與佇列確認**同一次本機寫入**保存；之後讀取失敗也不會降低或遺失已確認的版本。
- 不送整份數值快照：適配器沒有任何送 VITALS_SYNC 的方法（測試確認送出的事件種類）。

## 3. Hub 的小擴充（在 H3 分支，不動 H2.3 驗收版）
| 變更 | 內容 |
|---|---|
| `RENAME` 事件 | 只限 fp；不改數值所以不需要控制權，但要符合目前的 epoch／revision；名字 1–12 字；Minecraft 送 → 403 |
| `lastController` | claim／release／撤銷控制者時記下上一個控制者的角色；只出現在手機看到的狀態 |

## 4. Minecraft 與雲端
- Minecraft 仍只能用規則與經過白名單驗證的本機 AI（H2.1 的機制沒有變動）。
- FairyPocket 的個人雲端 AI 維持獨立：適配器用手機的通行碼，只呼叫 `/api/allay/*`，不經過雲端。

## 5. 已知限制（下一階段）
1. **尚未接進 App**：要在 `main.ts` 的 feed／pet／play／rename／onboard 和記憶寫入後呼叫 record*，並在開啟、回到前景、定時呼叫 `sync()`；還要有「叫回手機」按鈕與 `waitingControl`／`hubRollback` 的提示。
2. **手機控制期間的生活數值**不送到 Hub（VITALS_SYNC 停用）；Minecraft 看到的飽食、精神是最後一次事件計算的值。需要正式的交接調和機制。
3. **控制權租約**：Paper 當機沒有放開時，手機只能靠主人按「叫回手機」。
4. **同一個主人有多支手機**：其他手機取得控制權時不會採用生活數值（因為 Hub 上的值不完整）。
5. 只用合成資料、隔離 Hub 測試；真實 Pocket 存檔、正式轉接服務、Ollama、Paper 都沒有接觸。
