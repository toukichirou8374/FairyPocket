# H3-1.2 針對性複審資料（給 Astra）

- 分支：`feat/h3-pocket-sync`；基準 H3-1.1 `f41d26f` → H3-1.2 commit 見 `git log`。只處理登記識別與 409 EXISTS 的事件保存。
- 測試（只用專案現有的相依；vitest 以 `../../node_modules/.bin/vitest` 執行，沒有用 npx、沒有下載）：
  - vitest **100/100**（App 77＋同步 23：H3-1.1 的 19 項＋新增 4 項）
  - Hub **75/75**（H3-1.1 的 73 項＋新增 2 項）
  - 連續 3 次相同；`tsc` 通過。完整輸出：`h3-1-test-output.txt`。
- 隔離：合成悅靈、合成裝置、暫存資料夾、in-process Hub、測試埠；沒有接正式 UI、真實存檔、Ollama、Paper、NewProject；沒有合併 main、部署或啟用 Hub。

## 修補
| 位置 | 內容 |
|---|---|
| `scripts/hub/hub.mjs` 登記路徑 | 接受 `registration.regId`（`reg-`＋32 hex）。建立悅靈時，在同一個交易保存 `registration = {source: 請求的來源 ID, regIdHash: sha256(regId), at}`。已存在時，**由 Hub 核對**：來源 ID 相同且識別碼雜湊相同（固定時間比較）→ `200 DUPLICATE`＋目前狀態；有紀錄但不同 → `409 EXISTS registration: other`；沒有紀錄（舊資料）或文件損壞 → `409 EXISTS registration: unknown`。只存雜湊，狀態回應不顯示 |
| `src/hub/pocketSync.ts` | 快照建立時產生並持久保存 `regId`（本機格式 `reg` 增加 `regId`，`checkPersisted` 也檢查）。只有 `201` 或 `200 DUPLICATE` 才套用首次快照分界。兩種 409 → `registrationConflict`／`registrationUnverified`：直接停止，不讀取、不送事件、不刪佇列、不改本機數值與記憶、不回 ok；快照、來源 ID、事件 ID 全部保留 |

為什麼不能只相信請求：識別碼是隨機產生、只有原本的裝置知道；Hub 比對的是**它自己在首次登記時保存的紀錄**（來源 ID＋雜湊），不是這次請求的說法。別的裝置拿不到原本的識別碼；就算知道某台裝置的來源 ID，也無法通過核對。

## 測試
| 測試 | 驗證 | 在 H3-1.1（f41d26f）上 |
|---|---|---|
| 同一裝置：登記回應遺失 → **Hub 重啟＋App 重啟** → 重試 | 同一個 regId；Hub 回 200 DUPLICATE；分界前的摸頭不重複、重啟後新增的有送出 → 2 次、感情 13 | ✔（舊版這個情況本來就正確） |
| 兩台裝置同一個 petId | B 收到 EXISTS → `registrationConflict`、待送 2 筆完整（opId 相同）、快照保留、只送過登記請求（沒有讀取、沒有送事件）、本機感情 11.5／摸頭 1 未被改寫、Hub 摸頭仍 0；再同步一次仍停止 | ✖（得到 `['ok', 0]`） |
| Hub 沒有可靠的登記紀錄 | `registrationUnverified`、不回 ok、佇列保留、沒送事件 | ✖（得到 `['ok', 0]`） |
| 登記期間新增事件（衝突時） | 登記途中新增的 PLAYED 與先前的 PETTED 都留在佇列 | ✖ |
| Hub：DUPLICATE／other／unknown／格式錯 | 同來源＋同識別碼 → 200 且不改資料；不同識別碼或不同來源 → other；舊資料 → unknown；格式錯 → 400 | ✖（舊版一律 409、沒有分類） |
| Hub：耐久與備份 | 重啟後仍可核對；備份檔裡只有 `regIdHash`、沒有識別碼本身；狀態回應不顯示 | ✖ |
| 正常首次登記、登記期間新增事件（無衝突）、回應遺失 | H3-1.1 的既有測試全部通過 | ✔ |

舊版輸出：`h3-1-2-old-code-check.txt`。

## 建議複審重點
1. Hub 登記路徑：核對只用 Hub 保存的紀錄；損壞文件維持 409（H2.1 測試的行為）並標成 unknown。
2. 適配器：`ours` 的判斷只有 201／200 DUPLICATE；兩種 409 的早退在任何讀取、送出、採用之前。
3. `regId` 與快照同一次寫入，重試與重啟沿用；`checkPersisted` 會拒絕缺少或格式錯的 regId。

## 已知限制
- 衝突（`registrationConflict`）的後續處理（例如改成綁定到既有的悅靈、或換一個新的 petId）需要另外設計；目前只安全停止並保留一切。
- 識別碼只確認登記冪等性，不是裝置身分認證（身分仍由 fp 通行碼與來源 ID 表示）。
