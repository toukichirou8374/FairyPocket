# Fairy Hub v1 統一契約（H2）

> 基準：FairyPocket v0.49.2 的 Hub v1 API（規格書第 9 章）＋ GPT Work H1 契約（commit c23a704），並納入 2026-11-06 的四項修正。
> 本文件是 Fairy Hub、FairyPocket、Minecraft（Paper 插件）三方整合的唯一依據。與 H1 不同之處在「§12 與 H1 的對照」列出。
> 所有內容都不含網址、通行碼或金鑰。
> **H2.1 修訂**（GPT Work／Astra 首次審查的八項 P1）：本機模型白名單、VITALS_SYNC 暫停、AI 世代重驗、綁定單一文件授權、損壞 fail-closed、備份還原檢查、記憶依來源分額、排程真正取消。各節標示「H2.1」。

## 0. 原則
1. **只能用事件寫入**：沒有整份覆寫，也沒有任意 set／patch。所有狀態變化都是「事件 → Hub 驗證 → Hub 計算」。
2. **Minecraft 不能直接改數值**：包括 `mc_` 專用悅靈，Paper 只能提交事件，數值由 Hub 依規則計算（§6）。
3. **控制權 epoch**：同一時間只有一個「控制者」能提交會改數值的事件；切換控制權時 epoch +1，舊世代立即失效（§5）。
4. **持久化操作 ID 去重**：每個寫入都帶 `opId`，去重紀錄與狀態在同一個交易裡寫入磁碟；斷線重送不會重複計算（§4）。
5. **公開與私人分離**：Minecraft 只拿得到公開狀態與 Minecraft 自己產生的對話，拿不到手機的私人記憶與對話（§7）。
6. **Minecraft 一律只用本機 AI**：雲端路由在程式層封鎖，包括主人本人（§9）。
7. **只在收到耐久寫入成功後才回 ACK**；儲存失敗明確回錯誤，不假報成功（§10）。

## 1. 角色、憑證與來源
| 角色 | 憑證 | 說明 |
|---|---|---|
| `fp` | 既有的 AI 通行碼 | 主人的 FairyPocket |
| `mc` | 另一組伺服器通行碼（`private/hub-mc-token.txt`，第一次啟動自動產生） | Paper 插件，只有伺服器知道 |

- 每個請求：`Authorization: Bearer <token>`，Hub 依憑證決定角色。兩組憑證不同；`mc` 憑證不能使用任何既有的 AI 或雲端路徑。
- **來源 ID**（寫入必帶）：`X-Fairy-Source: <8–64 個英數字、_、->`。手機用裝置 ID、Paper 用伺服器 ID。來源 ID 在斷線重連後保持不變，是去重鍵的一部分。
- **行動者**（`mc` 必帶）：Paper 代表某位玩家時帶上該玩家的身分（§2），由 Paper 從實際登入的工作階段取得。
  - `X-Fairy-Actor: java:<UUID>` 或 `bedrock:<XUID>`
  - 基岩版另帶 `X-Fairy-Floodgate-Uuid: <Floodgate UUID>`
  - `X-Fairy-Actor-Name: <顯示名稱>`（只用於顯示）

## 2. 玩家身分（Java＋基岩版）
- 身分鍵：`java:<UUID 小寫>`、`bedrock:<XUID>`，兩種來源永遠分開比對，不會互相對到。
- **Java**：必須是伺服器正版驗證過的 UUID，格式為標準 UUID 且版本號為 4（離線模式產生的版本 3 UUID 一律拒絕）。
- **基岩版**：XUID 為 1–20 位數字；必須同時提供 Floodgate UUID，且兩者一致：Floodgate UUID 的前 64 位元為 0、後 64 位元等於 XUID（Floodgate 的對應規則）。不一致就拒絕。
- 玩家名稱（基岩版有前綴）只用於顯示，永遠不用來識別。
- Hub 只接受 `mc` 憑證送來的身分；客戶端不能直接連 Hub。
- **信任界線（H2.1 明確記載）**：行動者身分是**可信 Paper 後端的斷言**。Hub 驗證格式與 Java／Floodgate 的一致性，但**沒有**自己完成玩家的正版登入驗證；正版驗證由 Paper（Java）與 Floodgate（基岩版）在玩家登入時完成，Paper 插件必須只從該登入工作階段取得身分。mc 憑證外洩等同於能冒充任何玩家，必須只放在伺服器上。

## 3. 悅靈與權限
| 種類 | petId | 主人 | 誰能存取 |
|---|---|---|---|
| Pocket 悅靈 | FairyPocket 的 `PetState.id`（`ABCD-1234` 格式） | `pocket` | `fp`；以及綁定狀態為 active 的 Minecraft 身分 |
| Minecraft 專用悅靈 | `mc_` ＋ 身分鍵雜湊前 20 字 | 該身分 | 只有 `mc` 且行動者就是主人 |

- `fp` 不能存取 `mc_` 悅靈；`mc` 行動者不能存取別人的悅靈（跨玩家讀寫一律 403，且不回傳私密的 revision）。
- 綁定被撤銷後，該身分的所有請求立即 403，連重送也一樣。

## 4. 寫入：事件、revision 與去重
`POST /api/allay/events`
```json
{ "pet": "ABCD-1234", "baseRevision": 41, "epoch": 3,
  "events": [ { "opId": "op-0001", "type": "PETTED", "at": 1793900000000, "payload": {} } ] }
```
- 每個 `opId`：8–80 個英數字、`_`、`-`、`.`；去重鍵是（角色, 來源 ID, opId），並記錄事件內容的 SHA-256。
- 處理順序：**權限 → 去重 → epoch → revision → 規則**。
  - 同鍵且內容相同：回 `DUPLICATE` 與當初的結果，不重新套用（即使已換了新 epoch）。
  - 同鍵但內容不同：`409 ID_COLLISION`。
  - 新事件：`baseRevision` 必須等於目前的 `rev`，否則 `409 REVISION_CONFLICT`（附最新 rev）。用戶端要重新讀取、自己決定新事件後再送，Hub 不會自動取最大值或相加。
- 一批最多 50 筆，**整批成功或整批失敗**；每筆成功的事件讓 `rev` +1。
- 去重紀錄與狀態在同一個交易寫入磁碟，重啟後仍有效；保留 30 天，每隻悅靈上限 20,000 筆，超過時回 `507 CAPACITY_REJECTED`（不會為了騰空間而刪掉未過期的紀錄）。

## 5. 控制權 epoch
- 每隻悅靈有 `epoch`（整數）與 `controller`（角色、來源 ID、行動者）。
- **會改數值的事件只接受目前的控制者，而且 `epoch` 要等於目前的 epoch**；其他人提交回 `409 NOT_CONTROLLER`，舊 epoch 回 `409 STALE_EPOCH`（重複的舊事件仍只回當初的結果）。
- 不改數值的事件（記憶、對話、冒險紀錄）：有存取權的人可以提交，但仍要符合目前的 epoch 與 revision。
- `POST /api/allay/control/claim {pet, baseRevision}`：
  - 取得控制權後 epoch +1、rev +1，舊控制者手上的 epoch 立刻失效。
  - Pocket 悅靈：`fp` 隨時可以取得；`mc` 只有在綁定的玩家上線時（Paper 代表該玩家）才能取得。
  - `mc_` 悅靈：只有 `mc` 能取得。建立時就由 `mc` 控制，epoch 為 1。
- `POST /api/allay/control/release {pet, epoch}`：放開控制權，epoch +1。
- 建議流程：玩家進入 Minecraft 時，Paper 取得控制權；回到手機時，手機重新讀取狀態（包含 Minecraft 期間的變化），再取得控制權。

## 6. 事件種類與 Hub 的計算規則
數值範圍採用 FairyPocket v0.49.2 的真實尺度：生命 1–20、飽食 0–20、精神 0–100、感情 0–100、心情 0–100。

**會改數值（限控制者）**
| type | 誰能送 | payload | Hub 計算（與 FairyPocket 規則相同） |
|---|---|---|---|
| `FED` | fp、mc | `{food}` | 依 FairyPocket 的食物表加飽食與生命；感情 +3（最愛的食物 +6）、心情 +6（最愛 +12）；吃飽時（飽食 ≥19.5）不吃 |
| `PETTED` | fp、mc | `{}` | 感情 +1.5、心情 +3 |
| `PLAYED` | fp、mc | `{}` | 感情 +4、心情 +8、精神 −3、飽食 −0.5 |
| `TIME_PASSED` | mc | `{seconds ≤ 600, night}` | 套用 FairyPocket 的 tickPet（醒著或睡著的飽食、精神、生命、心情變化） |
| `GIFT` | mc | `{item}` | 感情 +2、心情 +5；並記一筆冒險 |
| `FOUND` | mc | `{item}` | 是否稀有由 Hub 的清單判斷（不信任 Paper 的說法），稀有的感情 +1；記一筆冒險 |
| `DEFEATED` | mc | `{mob}` | Boss（終界龍、凋零怪、伏守者、遠古深海守衛）心情 +5；記一筆冒險 |
| `HURT`／`DIED` | mc | `{}` | 心情 −3／−5 |
| `VITALS_SYNC` | **H2.1 暫停** | `{health, hunger, energy, mood, affection, asleep}` | 舊手機快照可能在取得新 revision／epoch 後蓋掉較新的狀態（例如 Minecraft 期間的變化）。正式的交接調和機制完成前，任何角色送來都回 `403 FORBIDDEN`（where = `VITALS_SYNC_DISABLED`） |

**每日上限**（以 Hub 所在電腦的日期計算）：Minecraft 事件帶來的感情合計每天最多 +10，其中 `GIFT` 最多 +6、`FOUND` 最多 +3；`HURT` 與 `DIED` 合計造成的心情下降每天最多 −15。超過上限的部分不套用，但事件仍會記錄。

**不改數值**
| type | payload | 說明 |
|---|---|---|
| `MEMORY_ADD` | `{memoryId, text ≤ 60, visibility: private\|shared}` | 手機記住的事預設 private；Minecraft 加的固定為 shared |
| `MEMORY_REMOVE` | `{memoryId}` | 只能刪除自己這個角色加的記憶 |
| `DIALOGUE_ADD` | `{messageId, who: user\|allay, name, text ≤ 200}` | 對話與記憶分開保存，並保留來源 |
| `ADVENTURE` | `{kind: dimension\|biome\|structure\|achievement\|sleep\|wake, detail, place, with}` | 只記冒險紀錄，手機再轉成回憶 |

- **額度依來源分開（H2.1）**：記憶 fp 40 條、mc 20 條；對話 fp 32 句、mc 32 句。超過時**只移除同一個來源最舊的項目**，Minecraft 新增的內容永遠不會擠掉手機的私人記憶或對話。冒險紀錄保留 30 天、最多 500 筆。
- 未知的 `type`、未知的 payload 欄位、數值超出範圍：`400 SCHEMA`。

## 7. 讀取：公開與私人
- `GET /api/allay/state?pet=…`
  - `fp`：完整內容，包括所有記憶、對話、控制者。
  - `mc`：只回**公開狀態**：名字、個性、數值、統計、相處天數、`rev`、`epoch`、控制者的角色、`visibility = shared` 的記憶、來源是 Minecraft 的對話。**手機的私人記憶與手機上的對話一律不回傳。**
- `GET /api/allay/adventures?pet=…&since=<rev>`（只限 fp）：拿 `rev` 大於 since 的冒險紀錄。
- `GET /api/allay/whoami`（mc）：這位行動者可以使用的悅靈（綁定的 Pocket 悅靈，或自己的 `mc_` 悅靈）。
- `POST /api/allay/mc/pet`（mc）：取得或建立這位行動者的 `mc_` 悅靈；同一個身分重複呼叫會得到同一隻（冪等）。

## 8. 綁定（六位數綁定碼）
> **H2.1：授權只存在悅靈文件裡**。待確認（pendingLinks）與授權（links）都在悅靈文件，確認與撤銷都是單一文件、單一交易。hub.json 只放綁定碼雜湊、linkId → 悅靈的查詢表、鎖定狀態；它的寫入成功或失敗都不會讓授權生效。claim 的順序是「先作廢綁定碼（hub.json）→ 再記待確認（悅靈文件）」，第二步失敗時這次綁定作廢（`status: failed`），不會產生授權。hub.json 損壞時所有綁定操作回 503。

1. `POST /api/allay/link/create {pet}`（fp）→ `{code, expiresAt}`。同一隻悅靈只有一組有效碼，產生新碼時舊碼作廢；Hub 只儲存碼的雜湊值。
2. `POST /api/allay/link/claim {code}`（mc，帶行動者）→ `{linkId, status: "pending"}`。**單次使用**：碼被使用後立刻作廢。
3. `GET /api/allay/link/pending?pet=…`（fp）→ 待確認清單（版本、名稱、身分前 8 碼）。
4. `POST /api/allay/link/confirm {linkId, accept}`（fp）：主人在手機上確認後才生效；待確認 10 分鐘內沒確認就失效。
5. `GET /api/allay/link/status?linkId=…`（mc）→ `pending`／`active`（附 pet）／`rejected`／`expired`／`revoked`／`failed`（綁定碼已作廢但沒完成，要重新產生）。
6. `POST /api/allay/link/revoke {pet, actor}`（fp）：解除綁定。
- **授權版本（H2.2）**：每隻悅靈有持久化、只增不減的 `authVersion`；綁定生效、撤銷（包括非控制者）都 +1。撤銷非控制者不會改 rev／epoch，所以還原比較要靠它（§10）。
- 有效期限：10 分鐘（`410 CODE_EXPIRED`）。
- 嘗試限制：每個 Paper 來源 10 分鐘內錯 5 次就鎖 15 分鐘（`429 LOCKED`）；鎖定狀態寫入磁碟，重啟後仍有效。

## 9. Minecraft 聊天與行動意圖
`POST /api/allay/talk`（mc，帶行動者）`{pet, opId, text, lang, place, speaker}`
- `speaker` 是實際說話的玩家（同樣由 Paper 從工作階段取得，可能是主人的朋友）；權限用行動者判斷，`speaker` 只影響稱呼。
- Prompt 只用 §7 的公開狀態組成。
- **AI 路由只允許 `RULES` 與 `LOCAL_OLLAMA`**（固定 127.0.0.1:11434，不能設定網址）。雲端、其他供應商、網址、大小寫變形一律在程式層拒絕；失敗時退回規則，絕不改用雲端或 FairyPocket 的雲端設定。
- **本機模型白名單（H2.1，fail-closed）**：Ollama 本身可以轉送到 Ollama 的雲端模型，所以每次推論前（結果快取 60 秒）向本機 Ollama 的 `/api/tags` 驗證：模型在白名單、已安裝、不是雲端模型（名稱含 cloud，或帶 `remote_host`／`remote_model`）、有本機大小與 digest、設定了 `model_digest` 時必須相符；回應的模型名稱也必須相同。任何一項無法驗證（包括 Ollama 沒回應）就用規則台詞，不送出聊天請求。建議另外在 Ollama 端設定官方的 `OLLAMA_NO_CLOUD=1`（停用雲端）；Hub 不會修改或重啟使用中的 Ollama。
- **AI 世代（H2.1）**：推論開始時記下 epoch 與 revision；完成時重新檢查權限、去重與 epoch。推論期間換了世代 → `409 STALE_EPOCH`，回答不寫入、不簽發意圖，同一個 opId 之後可以重送。意圖的 `epoch`／`basisRevision` 一律是推論開始時的值。
- **同一個 opId 並行送達（H2.1）**：進行中的推論共用，只推論一次；內容不同回 `409 ID_COLLISION`。
- 排程：同時只跑一個 AI 請求；佇列有上限（預設 8，滿了回 `503 QUEUE_FULL`）；每隻悅靈最多 1 個執行中加 1 個等待中（`429 PET_BUSY`）；逾時（預設 12 秒）就改用規則台詞。
- **真正取消（H2.1）**：逾時會把取消訊號（AbortSignal）傳到底層請求；執行名額要等底層請求真的結束才釋放，所以底層實際並行數永遠是 1。在佇列中等超過逾時的工作直接回規則台詞並移出佇列。
- 回應的意圖：
```json
{ "route": "LOCAL_OLLAMA",
  "intent": { "intentId": "…", "pet": "…", "kind": "DIALOGUE", "emotion": "happy", "dialogueText": "…",
              "epoch": 3, "basisRevision": 42, "expiresAt": 1793900030000,
              "soundPolicy": "MINECRAFT_PRESERVE_EXISTING_SYNTHETIC", "textPolicy": "APPROVED_TEXT_ONLY" } }
```
- 意圖種類白名單：`WAIT`、`FOLLOW`、`LOOK`、`DIALOGUE`。**意圖沒有任何音訊欄位**（沒有音檔、聲音 ID、TTS、音高）。
- 對話以 `opId` 去重：重送同一個 talk 只回當初的意圖，不會重問 AI；對話以 Minecraft 來源記入。
- `POST /api/allay/intent/receipt {pet, intentId, epoch, status: APPLIED|REJECTED, reason}`：意圖必須是 Hub 簽發、未過期、epoch 仍有效，否則拒絕。
- **分工**：AI 只決定意圖，Paper 控制器負責飛行、碰撞、安全。

## 10. 儲存、交易與復原
- 每隻悅靈一個文件（狀態、epoch、去重紀錄、記憶、對話、冒險紀錄都在同一份），全域資料（綁定碼、鎖定、身分索引）另一份。
- **一次寫入就是一個交易**：先寫暫存檔並 fsync → 原檔改名為前一版 → 暫存檔改名為正式檔。每份文件帶 SHA-256 檢查碼。
- 寫入成功才更新記憶體並回 ACK；寫入失敗回 `503 STORE_UNAVAILABLE`，記憶體與檔案都維持原狀。
- **啟動時的復原（H2.1，fail-closed）**：正式檔正確就使用（殘留的暫存檔是沒 ACK 的寫入，移到 quarantine/）。只有暫存檔（第一次建立就中斷、從未 ACK）→ 當作不存在。正式檔損壞或不見（但有前一版）→ **不自動退回前一版**（避免撤銷過的權限重新開放、事件或 epoch 靜默回退），整份 fail-closed（503、拒絕覆寫、拒絕重新登記），所有檔案複製到 quarantine/ 保留證據，由管理者用 `recover` 指令明確處理。
- **備份（H2.1／H2.2）**：拒絕不存在的來源、意外的空資料、損壞的文件、跨文件不一致（悅靈名稱、綁定碼與 linkId 指向不存在的悅靈、缺少 hub.json）。**H2.2：只要有尚未處理的損壞文件（Store 啟動時判定損壞的、正式檔不見但有前一版的、殘留暫存檔的），完整備份一律拒絕（`BACKUP_SOURCE_CORRUPT`，why = unresolved）**；快照清單帶 `complete: true`，驗證時要求這個標記。全新的資料夾在 Hub 啟動時建立空的 hub.json，所以「有悅靈卻沒有 hub.json」永遠代表資料不完整。一致的視圖：CLI 讀兩次確認沒變（最多 3 次，否則 `BACKUP_UNSTABLE`）；執行中的 Hub 用 `hub.backup()` 從快取同步建立。
- **還原（H2.1）**：先完整驗證（清單、雜湊、檢查碼、清單外的檔案、跨文件一致性）；目前資料比快照新時拒絕回退（`409 ROLLBACK_REFUSED`，要 `--allow-rollback` 才放行）。**H2.2：比較項目為 rev、epoch、授權版本；授權版本相同但目前生效的授權（active 的身分與控制者）不同也拒絕**；複製中途失敗原資料不動，替換時失敗會把原資料夾改回來。
- 資料位置：`private/allay-hub/`（不會上傳）。

## 11. 錯誤碼
`400 SCHEMA`、`409 ALREADY_DECIDED`、`409 INTENT_EXPIRED`、`401 UNAUTHORIZED`、`403 FORBIDDEN`／`CLOUD_FORBIDDEN`、`404 NOT_FOUND`、`409 REVISION_CONFLICT`／`STALE_EPOCH`／`NOT_CONTROLLER`／`ID_COLLISION`／`CODE_INVALID`／`EXISTS`、`410 CODE_EXPIRED`、`413 TOO_LARGE`、`429 RATE`／`LOCKED`／`PET_BUSY`、`503 QUEUE_FULL`／`STORE_UNAVAILABLE`、`507 CAPACITY_REJECTED`。回應格式都是 `{"error": "代碼"}`。

## 12. 與 H1 的對照
| 項目 | H1 | 本契約（H2） |
|---|---|---|
| 去重鍵 | (sourceSession, eventId) | （角色, **穩定來源 ID**, opId），斷線重連後仍能判斷 |
| 去重保存 | 記憶體 | 與狀態同一個交易寫入磁碟 |
| 數值尺度 | 合成的 0–100 | FairyPocket 真實尺度（生命、飽食 0–20） |
| 數值事件 | FEED/BOND/ENERGY_TICK +1 | FairyPocket 的真實規則；`VITALS_SYNC` 在 H2.1 暫停 |
| 身分 | 測試用 fixture 工作階段 | 憑證分角色＋Java/Floodgate 身分（本批為模擬認證） |
| 意圖 | WAIT/FOLLOW/LOOK/DIALOGUE＋收據 | 相同，透過 HTTP |
| 排程 | 2:1 互動／觀察、輪替、虛擬時間 | 簡化為單一執行、有界佇列、每隻 1+1、逾時退回規則（觀察通道留待之後） |
| 實作 | Java 原型 | Node，加在既有的本機轉接服務 |
