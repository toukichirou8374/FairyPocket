# H2.3 複審資料（給 Astra）

- 分支：`feat/h2-hub`；基準 H2.2 `a8c9e5e` → H2.3 commit 見 `git log`。只修補 hub.json 初始化漏洞；H2.1、H2.2 的修補全部保留。
- 測試：`npm run test:hub` → **71 項全部通過**（H2.2 的 66 項＋新增 5 項），連續 3 次 71/71。完整輸出：`test-output.txt`。
- 只用合成資料、暫存資料夾、測試埠；沒有碰正式資料、main、運作中的轉接服務、FairyPocket 正常版本、每日排程、NewProject。

## 問題
初始化條件（「沒有悅靈、沒有損壞」）和 `hubDoc()`（只擋損壞）判定不一致。hub.json 遺失或只剩暫存檔時，`hubDoc()` 回傳可寫入的空結構，`link/create` 會重建空索引。

## 修補（`scripts/hub/hub.mjs`）
1. **建立 Store 之前**先用 `isFreshDir()` 判斷：資料夾不存在，或裡面（含子資料夾）沒有任何檔案，才算全新。必須在 Store 之前判斷，因為 Store 啟動時會把「只剩暫存檔」移到 quarantine，之後就看不出來了。
2. 只有 `fresh` 才建立空的 hub.json。既有悅靈、暫存檔、前一版、復原殘留、quarantine 證據都不算全新。
3. 新增 `hubStatus()`：`ok`／`missing`／`broken`。初始化之後所有路徑都用它判定；`hubDoc()` 只要不是 `ok` 就回 503，**不再回傳可寫入的空結構**，所以沒有任何路徑能重建索引、覆寫或刪除證據。
4. `report` 加上 `hub`（狀態）與 `fresh`，方便啟動時診斷。

## 測試（`scripts/hub/test/h23.test.mjs`）
| 測試 | 結果 |
|---|---|
| 真正全新的空資料夾（不存在的資料夾、空的暫存資料夾）→ 建立 hub.json，綁定流程正常 | 通過 |
| 已有悅靈、hub.json 遺失 → link/create、claim、confirm、status 都 503；沒有產生 hub.json；悅靈本身照常 | 通過 |
| 已有悅靈、只剩 hub.tmp.json → 同上 503；暫存檔保留在 quarantine | 通過 |
| 只剩 hub.prev.json → 503、前一版留在原地；hub.json 損壞 → 503、損壞檔案沒被覆寫、已確認的授權不受影響 | 通過 |
| 不是全新：只有悅靈的暫存檔、或只有 quarantine 證據 → 不建立 hub.json；只有空的子資料夾 → 仍算全新 | 通過 |
| 正常 Hub 的綁定、撤銷、備份、還原 | 原本 66 項全部通過（沒有退步） |

## 在 H2.2 上的重現（`h23-old-code-check.txt`）
只比較行為（移除 H2.3 才有的 `report.fresh`／`report.hub` 斷言）時：
- **失敗（重現了漏洞）**：hub.json 遺失 → link/create 回 200；只剩 hub.tmp.json → link/create 回 200；只有悅靈暫存檔的資料夾被當成全新而建立 hub.json。
- **通過（本來就正確）**：全新資料夾；只剩 hub.prev.json；hub.json 損壞。

與 Astra 實測的四種情況一致。檔案裡也附上含診斷欄位的完整測試在 H2.2 上的結果（5 項全部失敗，其中一部分只是因為沒有新欄位）。

## 文件補充
`CONTRACT.md`、`STORAGE-RECOVERY.md`、`backup-cli.mjs` 用法說明都加上：
> 使用 --allow-rollback 可能恢復已撤銷的玩家權限、舊 epoch 與過去的資料狀態，必須停用服務並經主人明確批准。

## 修改的檔案
- `scripts/hub/hub.mjs`（初始化判定、`hubStatus()`、`hubDoc()`、report）
- `scripts/hub/test/h23.test.mjs`（新增）
- `scripts/hub/backup-cli.mjs`（只加一行說明）
- `docs/hub/CONTRACT.md`、`STORAGE-RECOVERY.md`、`RESULTS.md`、`test-output.txt`、`H23-REVIEW.md`、`h23-old-code-check.txt`

本輪完成後停在 H2.3：不合併、不部署、不啟用 Hub。
