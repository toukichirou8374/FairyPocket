# H3-2：Minecraft 本機 Ollama AI 整合與效能驗證（工程準備）

- 分支 `feat/h3-2-mc-ai`，工作區 `.worktrees/h3-2`，從 H3-1.2 驗收版 `be2dde2` 分出（H3-1.2 保留在 `feat/h3-pocket-sync`，本機標籤 `h3-1.2-accepted`，沒有推送）。
- 本輪只用**假 Ollama、合成玩家、暫存資料夾、測試埠**。沒有連接或設定真正的 Ollama，沒有 GPU 負載測試，沒有改 Windows 設定、正式 FairyPocket、每日排程、NewProject、main 或真實資料。
- 測試：Hub 85/85（H3-1.2 的 75＋H3-2 的 10），vitest 100/100（App＋同步，未變），tsc 通過。

## 1. 現有機制檢查（以 H2.x 的 Hub 為基礎，沒有重寫）
| 項目 | 現況 | 結論 |
|---|---|---|
| 雲端禁止 | ① 路由白名單只有 RULES／LOCAL_OLLAMA ② mc 憑證碰 `/api/cloud/*` 一律 403 ③ 每次推論前驗證本機模型（白名單、已安裝、非雲端：名稱含 cloud 或帶 remote_host／remote_model、本機大小、digest，可固定 digest）④ 回應模型名稱要相同 | 主人本人在 Minecraft 也一樣沒有雲端路徑；FairyPocket 個人雲端 AI 不變 |
| 模型限制 | 固定 127.0.0.1:11434，不能設網址；`num_predict 160` 限制回答長度；驗證結果快取 60 秒 | 新增測試確認：Minecraft 送給 Ollama 的選項與 FairyPocket **完全相同**（同模型、temperature 0.8、num_predict 160、keep_alive 30m、沒有 num_ctx／num_gpu）→ Ollama 不會因為兩邊設定不同而反覆重新載入模型 |
| 推論取消 | 逾時 → AbortSignal → HTTP 請求中斷；名額等底層真的結束才釋放 | 假 Ollama 驗證：收到斷線、沒有完成推論。**真正的 Ollama 收到斷線是否立即停止 GPU 運算，尚待實測** |
| 逾時降級 | 推論逾時或失敗 → 規則台詞；不改用雲端 | 不變 |
| 並行 | Hub 同時最多 1 個 Minecraft 推論；FairyPocket 直接問 Ollama（不經過 Hub 排程） | Ollama 最多同時面對「1 個 Minecraft＋手機」；手機最多多等約一句的時間 |
| 音效契約 | 意圖只帶 `soundPolicy: MINECRAFT_PRESERVE_EXISTING_SYNTHETIC`、`textPolicy`，沒有任何音訊欄位 | 合成負載中每個意圖都檢查過 |

## 2. 本輪新增（最小）
| 檔案 | 內容 |
|---|---|
| `scripts/hub/bench/fakeOllama.mjs` | 假 Ollama：可設定模型清單（含雲端模型）、延遲模型、同時處理數（模擬 OLLAMA_NUM_PARALLEL）；記錄並行數、取消、請求的模型與選項 |
| `scripts/hub/bench/mcLoad.mjs` | 合成負載：N 位合成玩家（Java UUID）各自建立 mc_ 悅靈、每 5–15 秒說一句；可同時模擬手機直接問 Ollama；時間縮放；輸出延遲分布、本機 AI／規則台詞比例、忙碌／佇列滿、並行、取消、雲端次數。`node scripts/hub/bench/mcLoad.mjs --out 檔案.md` |
| `scripts/hub/localai.mjs` | 排程新增 `waitMs`（在佇列最多等多久；**預設＝逾時，行為跟以前一樣**）；`schedulerOptsFrom()` 從 `private/hub.txt` 讀 `ai_queue`（1–32）、`ai_timeout_ms`（1000–60000）、`ai_wait_ms`（500–60000），超出範圍用預設值 |
| `scripts/ai-proxy.mjs` | 啟用 Hub 時套用上述設定（Hub 仍預設關閉） |
| `scripts/hub/test/h32.test.mjs` | 10 項：選項一致（不重載）、雲端模型禁止、取消真的中斷、排隊上限、設定範圍、1／2／5／10／20 位玩家的不變條件 |

## 3. 合成負載結果（摘要；完整表格見 `h3-2-synthetic-load.md`）
延遲模型：fast＝每句約 0.9 秒（依規格書「RTX 2060S 約 1 秒一句」）、slow＝約 2.5 秒。**這是合成模型，不是 GPU 實測。**

| 玩家 | 預設（佇列 8／逾時 12 秒／排隊 12 秒） | 建議（佇列 8／逾時 8 秒／排隊 3 秒） |
|---|---|---|
| 1–5 | 幾乎全部本機 AI；fast 約 1–2 秒、slow 約 3–5 秒（最慢 9 秒） | 同左；slow 5 人最慢 5.9 秒 |
| 10 | fast 100% AI、最慢 5 秒；slow 80% AI、**最慢 15.8 秒** | fast 98% AI、最慢 4 秒；slow 48% AI、最慢 7.4 秒 |
| 20 | fast 79% AI、中位 8.8 秒、**16 次佇列滿被拒**；slow 31% AI、最慢 17 秒、**32 次被拒** | fast 63% AI、中位 3.2 秒、最慢 5.4 秒、1 次被拒；slow 25% AI、最慢 7.5 秒、0 次被拒 |

所有組合：Ollama 對 Minecraft 的最大並行 1、雲端 0、意圖音效政策 100% 保留；手機在 20 人時中位 1.6–5 秒（最多多等約一句）。

**判讀**：一張 RTX 2060S、一次一句，大約每分鐘 30–60 句是上限。超過 5–10 位活躍玩家時，「等很久才拿到 AI」不如「3 秒內先用規則台詞回答」。建議設定只在啟用 Hub 時寫進 `private/hub.txt`（目前沒有寫入任何正式設定）：
```
ai_queue=8
ai_timeout_ms=8000
ai_wait_ms=3000
```

## 4. 真實 Ollama 驗證：需要你批准的事項
真實驗證全部由我執行，你只需要批准、選時間；不需要手動操作。
| # | 項目 | 做法 | 對 FairyPocket／Minecraft 的影響與風險 |
|---|---|---|---|
| A | 唯讀查詢 Ollama | `GET /api/version`、`/api/tags`、`/api/ps`（版本、已安裝模型、是否有雲端模型、目前載入的模型與 digest） | 幾乎沒有影響，不改任何設定、不下載模型 |
| B | 讀取是否已設定 `OLLAMA_NO_CLOUD` | 唯讀查看使用者與系統環境變數（不修改） | 沒有影響 |
| C | 真實延遲與取消測試（小規模） | 另開一個**隔離的測試 Hub**（不同埠、暫存資料夾、測試通行碼；不是運作中的轉接服務），對現有 Ollama 送與 FairyPocket **相同模型與選項**的請求（不會重新載入模型）：1 人 → 2 人 → 5 人，每階段 2 分鐘；另測一次「長回答中途取消」，看 GPU 工作是否立刻停止 | 測試期間 GPU 會忙：手機的 AI 回答可能每句多等約 1 秒；同一台電腦的 Minecraft 正式伺服器可能受到 GPU／CPU 負載影響。建議選沒有人在玩的時段，避開每天 17:30 左右的語音排程 |
| D | 10／20 人負載（選擇性） | 同 C，各 2 分鐘 | 影響比 C 大；只有你另外同意才做 |
| E | 設定 `OLLAMA_NO_CLOUD=1`（選擇性） | 需要修改環境變數並**重新啟動 Ollama** | 重啟期間（約數十秒）手機的本機 AI 暫時不能用；這是系統設定變更，必須另外批准；不批准也沒關係（Hub 本身已在程式層禁止雲端） |

**停止條件（C／D）**：任一句等待超過 30 秒、Ollama 回錯誤、或你說停 → 立刻停止並回報。
**不會做的事**：下載模型、改 Ollama 設定（除非你批准 E）、動運作中的轉接服務、連 Minecraft 伺服器、改真實資料。

## 5. 尚未處理（下一步）
- 真實 Ollama 的延遲、取消、並行行為（第 4 節，等批准）。
- 「觀察」通道（悅靈主動評論環境）與 2:1 互動／觀察優先序（H1 原有、H2 簡化掉的部分）。
- 依真實數據決定最終的 `ai_queue`／`ai_timeout_ms`／`ai_wait_ms`。
- Paper 插件端（意圖執行、合成音效播放）不在本輪範圍。
