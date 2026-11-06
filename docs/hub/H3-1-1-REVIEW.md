# H3-1.1 針對性複審資料（給 Astra）

- 分支：`feat/h3-pocket-sync`；基準 H3-1 `982f58c` → H3-1.1 commit 見 `git log`。只修正三項，Hub 沒有變更。
- 測試：`npx vitest run` → **96/96**（App 77 項＋同步 19 項）；`npm run test:hub` → **73/73**。連續 3 次相同；`tsc` 通過。
  - 同步測試：H3-1 的 11 項中，「本機同步資料損壞：重建」改寫為安全拒絕（P1-1），其餘 10 項不變；新增 9 項。
- 隔離：合成悅靈、合成玩家、暫存資料夾、in-process Hub、測試埠。沒有接正式 UI、沒有碰真實存檔、運作中的轉接服務、Ollama、每日排程、NewProject；沒有修改 main、沒有部署或啟用 Hub。

## 三項修補（全部在 `src/hub/pocketSync.ts`）
| # | 問題 | 修補 |
|---|---|---|
| P1-1 | 同步資料解析失敗就建立新來源 ID、空佇列並覆寫 | `load()` 區分三種情況：**沒有資料**（`null`）→ 建立新的；**無法解析**或 **`checkPersisted()` 判定結構異常**（版本、來源 ID、petId、registered、序號、每筆 opId／序號／型別／時間／payload、opId 重複、seenRev／epoch、syncedNotes、claimOpId、reg）→ `localCorrupt`：不建立新來源 ID、**不寫入任何東西**（原始內容就是證據）、不連線；record*／syncNotes 回傳 false。不做自動復原 |
| P1-2 | 用已含互動結果的 PetState 登記，又重送同一個事件 | 首次登記前先**持久保存**「登記快照＋分界序號」（事件新增 `seq`）。登記成功（201，或回應遺失後重試的 409 EXISTS）時，同一次寫入：已登記、保存 rev／epoch、**只移除 seq ≤ 分界的 FED／PETTED／PLAYED／RENAME**。分界後的事件、記憶與對話都保留；重試與 App 重啟用同一份快照；來源 ID 與 opId 不變 |
| P1-3 | 成功提交後先清佇列，seenRev 等下一次讀取才更新 | 新增 `commit()`：所有本機變更都在複本上進行、寫入成功才換上，寫入失敗丟 `LocalSaveError` → `localSaveFailed`（不算成功）。事件 200：佇列確認＋`seenRev = max(seenRev, rev)`＋epoch **同一次寫入**；登記 201、取得控制權 200 也一樣；讀取失敗不會改動已確認的版本；`rev < seenRev` → `hubRollback`、保留佇列、不採用 |

本機格式從 v1 升到 v2（新增 `seq`、`reg`）。v1 被 `checkPersisted()` 視為結構異常（安全拒絕）。適配器尚未接進 App，所以沒有任何真實的 v1 資料。

## 新增測試（`tests/h3/pocketSync.test.ts`）
| 測試 | 驗證 | 在 H3-1（982f58c）上 |
|---|---|---|
| P1-1 損壞（無法解析） | localCorrupt、零連線、原始內容一字不改、record 回 false、Hub 沒被登記、App 存檔不受影響 | ✖ |
| P1-1 可解析但結構異常（11 種） | 每種都 localCorrupt 且回報原因；原始內容一字不改；零連線 | ✖ |
| P1-1 對照 | 沒有資料才建立；正常資料重開後來源 ID 相同、佇列完整 | ✖（舊版沒有 `corrupt` 欄位） |
| P1-2 首次同步前只摸頭一次 | Hub 摸頭 1 次、感情 11.5（只加一次）；登記前的記憶仍送出 | ✖（得到 2 次、13） |
| P1-2 登記期間新增動作 | 登記請求途中再摸頭 → Hub 2 次、感情 13（快照後的動作沒丟） | ✖ |
| P1-2 登記回應遺失＋App 重啟 | 重試用同一份快照；重啟後新增一次 → 2 次、13；來源 ID 與 opId 不變 | ✖ |
| P1-3 Astra 情境 | 提交到 rev 2 → 後續讀取失敗（seenRev 已存 2）→ Hub 還原 rev 1 → 再同步 = **hubRollback**，本機摸頭統計沒倒退成 0 | ✖（seenRev 仍是 1） |
| P1-3 本機寫入失敗 | Hub 已提交但本機寫不進去 → localSaveFailed；重開後重送 → DUPLICATE、次數仍 1 | ✖ |
| P1-3 對照 | 正常同步後本機保存的 seenRev／epoch 與 Hub 相同、佇列清空 | ✔（對照本來就該通過） |

舊版完整輸出：`h3-1-1-old-code-check.txt`。8 項失敗、對照通過，H3-1 原有的 10 項也通過。

## 建議複審重點
1. `load()`／`checkPersisted()`：哪些欄位會被拒絕；損壞時絕不呼叫 `setItem`。
2. 登記分界：`reg` 何時建立、何時清除；`IN_SNAPSHOT` 的範圍（記憶、對話不在快照裡）；409 EXISTS 視為已登記的前提（同一份快照）。
3. `commit()` 的原子性：寫入失敗時記憶體維持原狀；每個成功回應都經過 `commit()` 保存 rev／epoch。
4. `read()`：只在版本前進時寫入；失敗不改動已確認版本。

## 已知限制（不在本輪範圍）
- 損壞時的人工處理流程（檢視原始內容、決定重送或放棄）尚未提供工具。
- 409 EXISTS：若同一隻悅靈先前已由別的裝置登記，分界前的動作會被當成已包含（可能少算、不會多算）。
- 其餘見 `H3-1-SYNC.md` §5（尚未接進 App、手機控制期間的生活數值、控制權租約等）。

## 過程中的意外（已處理）
第一次在專案資料夾**外**建立舊版的暫時工作區時，因為找不到專案的 vitest，`npx` 自動把 vitest 5.1.0 下載到 npm 的暫存快取（`%LOCALAPPDATA%\npm-cache\_npx\69c381f8ad94b576`），而且執行失敗。這不是經過批准的下載；已確認那個資料夾只有這次下載的 vitest，並已刪除。之後改在專案資料夾內建立暫時工作區，用專案原本的 vitest 重跑（上表結果），沒有再下載任何東西。
