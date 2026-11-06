# H2.2 複審資料（給 Astra）

- 分支：`feat/h2-hub`；基準 H2.1 `fa6a8eb` → H2.2 commit 見 `git log`。只修改兩項儲存安全問題所需的程式與文件；H2.1 的修補全部保留。
- 測試：`npm run test:hub` → **66 項全部通過**（H2.1 的 58 項＋新增 8 項），連續 3 次 66/66。完整輸出：`test-output.txt`。
- **重現證據**：把新的 `h22.test.mjs` 放到 H2.1（`fa6a8eb`）上跑 → 4 項回歸測試全部失敗；問題一的 2 項對照在兩個版本都通過（對照本來就該通過）；問題二的對照在 H2.1 也失敗（見下方「順帶發現」）。紀錄：`h22-old-code-check.txt`。
- 只用合成資料、暫存資料夾、測試埠；沒有碰正式資料、main、運作中的轉接服務、每日排程、NewProject。

## 問題一：撤銷非控制者後，還原舊備份會重新開放權限
| | 內容 |
|---|---|
| 原因 | 撤銷非控制者只改 `links`，不改 rev／epoch；還原的回退檢查只比 rev／epoch |
| 修補 | 悅靈文件新增持久化、只增不減的 `authVersion`：綁定生效、撤銷（包括非控制者）都 +1，與授權變更在同一個交易寫入。還原的回退檢查改為 `isRollback()`：rev、epoch、`authVersion` 任何一項比快照新 → 拒絕；**`authVersion` 相同但目前生效的授權（active 的身分與控制者，取雜湊比較）不同 → 也拒絕**（涵蓋沒有 authVersion 的舊格式）。錯誤附 why：`rev`／`epoch`／`auth_version`／`auth_state`／`missing_in_snapshot`。`--allow-rollback` 仍是唯一的明確放行方式 |
| 位置 | `hub.mjs`（newDoc、link/confirm、link/revoke）；`store.mjs`（`authFingerprint`、`isRollback`、`restore`、`checkConsistency` 檢查型別） |
| 回歸測試 | 「問題一 回歸」：綁定 → `hub.backup()` → 撤銷非控制者（epoch 仍是 1、authVersion 變 2）→ 403 → 不帶 `--allow-rollback` 還原 → `409 ROLLBACK_REFUSED auth_version` → 重啟 → 仍是 403。**在 H2.1 上失敗**（還原成功、權限恢復） |
| 版本相同、授權不同 | 「問題一：版本相同但生效的授權不同」：authVersion 都是 2（以及都沒有 authVersion 的舊格式），快照 active、目前 revoked → `auth_state` 拒絕；授權相同時可以還原。**在 H2.1 上失敗** |
| 對照測試 | 「問題一 對照」：沒有變更時備份 → 還原 → 重啟，rev、epoch、links 都相同、玩家仍 200；「明確加上 `--allow-rollback` 才會回到舊授權」 |

## 問題二：完整備份漏掉損壞的悅靈
| | 內容 |
|---|---|
| 原因 | `hub.backup()` 只序列化 Store 快取裡的文件；啟動時判定損壞的文件不在快取裡，就被默默略過；`verifyBackup()` 無從得知少了一隻 |
| 修補 | `backupFromStores()`：任何 Store 的損壞清單（`report.failed`）不是空的 → `500 BACKUP_SOURCE_CORRUPT`（why = `unresolved`，列出檔案），不寫任何快照。離線 `backup()`：檢查「正式檔不見但有前一版」與殘留暫存檔，同樣拒絕（正式檔本身損壞的情況 H2.1 就會拒絕）。快照清單加上 `complete: true`，`verifyBackup()` 要求這個標記 |
| 位置 | `store.mjs`（`backupFromStores`、`backup`、`unresolved`、`writeSnapshot`、`verifyBackup`） |
| 回歸測試 | 「問題二 回歸」：兩隻悅靈、損壞其中一隻、重啟（損壞清單有它）→ `hub.backup()` 拒絕、沒有產生快照；離線備份也拒絕。**在 H2.1 上失敗**（產生少一隻的快照）。「正式檔不見、只剩前一版」→ 離線備份拒絕。**在 H2.1 上失敗** |
| 對照測試 | 「問題二 對照」：兩隻都正常 → 完整備份成功，快照正好是 `hub.json`＋兩隻悅靈，`complete: true`，驗證通過 |
| 其他 | 「沒有『完整』標記的快照驗證不通過」 |

## 順帶發現（同屬問題二的範圍）
寫對照測試時發現：只登記悅靈、還沒做過任何綁定時，沒有 `hub.json`，H2.1 的一致性檢查（「有悅靈卻沒有 hub.json」= 不完整）會讓**正常的資料也無法備份**。修補：Hub 在全新的資料夾（沒有任何悅靈、也沒有損壞）啟動時先建立空的 `hub.json`。這樣「有悅靈卻沒有 hub.json」就只會代表資料不完整。這是問題二對照測試在 H2.1 上失敗的原因。

## 建議複審重點
1. `isRollback()` 的比較順序與 `authFingerprint()` 涵蓋的欄位（active 身分＋控制者）。
2. `authVersion` 只在授權真的改變時 +1（綁定生效、撤銷有變化），與變更同一個交易。
3. `backupFromStores()` 與 `unresolved()`：哪些情況算「尚未處理的損壞」。
4. Hub 啟動時建立空 `hub.json` 的條件（只限全新資料夾）。

## 仍未處理（不在本輪範圍）
真實 Ollama、Paper、Floodgate、FairyPocket 同步，以及 H2.1 文件列出的真實環境驗證項目。

本輪完成後停在 H2.2：不合併、不部署、不啟用 Hub。
