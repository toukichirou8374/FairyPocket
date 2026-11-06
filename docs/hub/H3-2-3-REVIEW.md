# H3-2.3 針對性複審資料（給 Astra）

- 分支：`feat/h3-2-mc-ai`；基準 H3-2.2 `52812ae` → H3-2.3 commit 見 `git log`。只修補非 200 回應的連線清理。
- 測試：Hub **109/109**（原本 100＋新增 9：`h323.test.mjs` 7 項、`h323-repro.test.mjs` 2 項）、vitest **100/100**、tsc 通過；連續 3 次相同。完整輸出：`h3-2-test-output.txt`。
- 只用假 Ollama 與合成資料：沒有呼叫真正的 Ollama、沒有 GPU、沒有重新啟動或修改 Ollama／`server.json`；沒有動 FairyPocket 正式服務、轉接服務、每日排程、NewProject、main；沒有下載相依。

## 修補（`scripts/hub/localai.mjs`）
- 新增 `trackRequest(req, counter)`：在建立請求時就監聽 `close`，記住連線是否真的關閉。`shutdown(res, ms)` 會主動 `res.destroy()`＋`req.destroy()`，等 `close`（已關閉就立刻完成），**最多等 `CLOSE_WAIT_MS`＝1000 毫秒**，超過就以 `close_timeout` 結束並記錄（不會無限等待）。終止時替回應加上空的 `error` 監聽，避免 aborted 變成未處理例外。
- `getJson()`（`/api/tags`）與 `ask()`（`/api/chat`）：非 200、`error`（含 AbortSignal 取消）、逾時、回應錯誤，**都走同一個 `fail()`**。它只會完成一次（`settled`），而且先 `shutdown()` 再 `reject`。排程器在 `ask()` 結束後的 `finally` 才釋放名額，所以名額一定是**連線清理完成後**才釋放。
- 正常的 200 回應讀完（`end`）才 resolve；之後的模型身分、remote 欄位、內容型別檢查不變。
- 沒有改變：模型白名單、固定 digest、每次推論前驗證、回應模型身分、HTTP 200 驗證、規則降級、排程、音效契約。

## 測試
| 測試 | 驗證 | H3-2.2（52812ae） |
|---|---|---|
| **重現（新舊都能跑）**：`/api/tags` 500＋每 10 毫秒持續傳輸 ×3 | 排程器沒有工作時，假服務端的錯誤連線 0 條、已關閉 3 條 | ✖ **還開著 3 條** |
| **重現**：`/api/chat` 500＋持續傳輸 ×3 | 同上 | ✖ **還開著 3 條** |
| `/api/tags` 持續傳輸 ×3（`h323`） | 每次 1.5 秒內降級；`ask` 結束那一刻用戶端開著的連線＝0；`running`／`inFlight` 歸零；服務端關閉 3 條；沒有聊天推論；沒有清理逾時 | （舊版沒有 `trackRequest`／`adapter.conn`，檔案無法載入） |
| `/api/chat` 持續傳輸 ×3 | 同上，聊天推論 3 次但都不接受 | 同上 |
| 經過 Hub | 玩家拿到規則台詞；異常內容不輸出、不保存；連線已關閉 | 同上 |
| 清理後再送正常 200 | 本機 AI 正常回答，沒有殘留連線 | 同上 |
| 逾時 | 仍會取消；名額在連線關閉後才釋放 | 同上 |
| 主動取消（AbortSignal） | reject 時連線已關閉 | 同上 |
| 清理上限 | 連線永遠不關閉時，在上限內以 `close_timeout` 結束並記錄；之後才關閉也不出錯 | 同上 |

舊版輸出：`h3-2-3-old-code-check.txt`（假 Ollama 換成新版，只多了 `errorStream`；被測的 `localai.mjs` 是舊版）。

## 建議複審重點
1. `trackRequest` 在建立請求的同一個同步流程裡就掛上 `close` 監聽，不會錯過已經發生的關閉。
2. 每一條錯誤路徑都經過 `fail()`，只完成一次；`end` 之後的驗證失敗不需要再清理（回應已完整讀完）。
3. 名額釋放順序：`fail()` → `shutdown()` 完成 → `reject` → 排程器 `finally` 釋放。
4. 清理上限 1 秒：最壞情況下，一個卡住的錯誤回應會讓下一個請求多等最多 1 秒。
