# H3-1 驗收資料（給 Astra）

- 分支：`feat/h3-pocket-sync`（從 H2.3 驗收版 `b599b4a` 分出）；H2.3 原封不動留在 `feat/h2-hub`，另有本機標籤 `h2.3-accepted`（沒有推送）。
- 工作區：`C:\Users\gaday\Desktop\FairyPoket\.worktrees\h3`
- 範圍：H3-1 最小實作。**同步適配器＋隔離測試**；尚未接進 App 畫面（H3-2）。沒有開始 H3-2、H3-3。
- 隔離：只用合成悅靈、合成 Java 玩家、測試用通行碼、暫存資料夾、測試埠。沒有接觸正在使用的轉接服務、真實 Pocket 存檔、正式 Ollama、每日排程、Minecraft NewProject；沒有合併 main、沒有啟用 Hub、沒有部署。

## 重跑
```
npx vitest run        # App 77 項＋H3-1 同步 11 項（tests/h3/）
npm run test:hub      # Hub 73 項（H2.3 的 71 項＋H3-1 的 2 項）
```
結果：**vitest 88/88、Hub 73/73**，連續 3 次相同；`npx tsc --noEmit` 通過；`npm run build` 通過（App 沒有引用適配器，主程式大小不變）。完整輸出：`h3-1-test-output.txt`。

## 變更清單
| 檔案 | 內容 |
|---|---|
| `src/hub/pocketSync.ts`（新） | 同步適配器：待送佇列、穩定 opId、登記、讀取、取得控制權、送出、衝突重送、交接、採用遠端資料、防倒退 |
| `tests/h3/pocketSync.test.ts`（新） | 11 項端對端測試：適配器 × 真正的 Hub（in-process、暫存資料夾、測試埠） |
| `scripts/hub/schema.mjs`、`rules.mjs` | 新增 `RENAME`（只限 fp、不需控制權、要符合 epoch／revision） |
| `scripts/hub/hub.mjs` | 新增 `lastController`（claim／release／撤銷控制者時記下；只給 fp 看） |
| `scripts/hub/test/h31.test.mjs`（新） | RENAME 與 lastController 的 Hub 單元測試 |
| `vitest.config.ts`（新） | vitest 只收 `src/` 與 `tests/`。**H3-1 發現的 H2 遺留問題**：H2 之後 `npm test` 會誤收 `scripts/hub/test/*.test.mjs`（node:test），7 個測試檔被判失敗 |
| `fonts/…chars.txt`、`public/fonts/fairypocket-pixel.ttf` | 依專案慣例 `npm run font`（字型檢查會掃 `src/` 所有文字，含新檔的註解） |
| `docs/hub/H3-1-SYNC.md`（新）、`CONTRACT.md` | 同步行為說明、Pocket 資料核對；契約補 RENAME 與 lastController |

## 優先驗證項目（需求 6）
「改名、感情、記憶：同步後一致；App 重啟＋Hub 重啟後仍一致、不重複計算」
- 改名 → RENAME；摸頭、玩、餵餅乾 → PETTED／PLAYED／FED；新增記憶 → MEMORY_ADD（private）。
- 同步後 Hub 的名字、感情、統計與手機本機（照原本規則計算）完全相同；兩條記憶都在。
- 關掉 Hub、用同一個資料夾重開；用同一份本機儲存重建適配器（模擬 App 重啟）→ 記憶沒變不產生事件 → 同步 → 統計仍是各 1 次（沒有重複計算），名字、感情一致。

## 其他測試
| 測試 | 驗證 |
|---|---|
| 離線 | 動作留在佇列；App 重啟後佇列與 opId 相同；連上後只套用一次，再同步也不變 |
| 回應遺失 | Hub 已套用、回應在路上遺失 → 重送 DUPLICATE，次數仍是 1 |
| revision 衝突 | 送出前 Minecraft 先加了一條記憶 → 重讀、同 opId 重送；兩邊的變化都在 |
| 控制權交接 | Minecraft 控制中：記憶先送、摸頭等待（`waitingControl`）；Minecraft 放開後接回：採用 Minecraft 期間的飽食（TIME_PASSED 讓它下降），感情＝10＋禮物 2＋摸頭 1.5 |
| 叫回手機 | `takeover()` 接管；Minecraft 舊 epoch 的事件 → STALE_EPOCH |
| 防倒退 | 管理者用 `--allow-rollback` 還原舊備份 → `hubRollback`：不同步、不採用遠端數值（感情沒被拉回）、保留佇列 |
| 不送快照 | 送出的事件種類只有 FED／PETTED／PLAYED／RENAME／MEMORY_ADD／DIALOGUE_ADD；沒有送 VITALS_SYNC 的方法 |
| 記憶 | 刪除會同步；同一句記憶永遠同一個 memoryId；Minecraft 30 條共享記憶不影響手機的 notes，Hub 只留最新 20 條 |
| 改名 | Minecraft 看得到新名字；Minecraft 送 RENAME → 403 |
| 本機同步資料損壞 | 重建；App 存檔（`fairypocket.save.v1`）不受影響 |

## 建議審查重點
1. `PocketSync.sync()` 的迴圈：每種錯誤的處理（重讀重送、單筆隔離、停止），以及最多回合數。
2. 「Minecraft 控制中不搶」與 `takeover()` 的界線；`handoverFromMc` 的判斷（`controller` 或 `lastController`）。
3. `adopt()`：佇列清空才採用感情／統計；有待送改名不採用名字；生活數值只在從 Minecraft 接回時採用。
4. 防倒退：`seenRev` 只增不減；`hubRollback` 時完全不採用。
5. Hub 擴充：RENAME 的角色白名單、lastController 不出現在 Minecraft 的公開狀態。

## 已知限制（交給 H3-2 之後）
見 `H3-1-SYNC.md` §5：尚未接進 App；手機控制期間生活數值不同步（VITALS_SYNC 停用中）；沒有控制權租約；多支手機的生活數值；真實環境未驗證。
