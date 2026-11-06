# H3-2 驗收報告（給 Astra）：Minecraft 本機 Ollama AI 整合與效能驗證

- 分支：`feat/h3-2-mc-ai`（工作區 `.worktrees/h3-2`），從 H3-1.2 驗收版 `be2dde2` 分出；H3-1.2 保留在 `feat/h3-pocket-sync`，本機標籤 `h3-1.2-accepted`。本報告的 commit 見 `git log`。
- 沒有合併 main、沒有部署、沒有啟用 Hub；FairyPocket 正式版、運作中的轉接服務、每日排程、Minecraft NewProject 都沒有修改。
- 測試：Hub **87/87**、vitest **100/100**（App＋同步）、tsc 通過；只用專案既有相依（vitest 以 `../../node_modules/.bin/vitest` 執行，沒有 npx 下載）。
- 細節文件：`H3-2-PLAN.md`（機制檢查、批准事項、server.json 還原與確認方式）、`h3-2-synthetic-load.md`（合成負載完整表格）、`h3-2-real-smoke.json`（真實測試原始資料）、`h3-2-test-output.txt`。

## 1. 隔離工程（假 Ollama）
| 項目 | 內容 | 驗證 |
|---|---|---|
| 假 Ollama（`bench/fakeOllama.mjs`） | 模型清單（含雲端模型）、延遲模型、同時處理數、取消偵測、`/api/version`／`/api/ps` | — |
| 合成負載（`bench/mcLoad.mjs`） | 1／2／5／10／20 位合成玩家經過真正的 Hub＋轉接服務；可同時模擬手機直接問 Ollama | 每組：Ollama 對 Minecraft 最大並行 1、雲端 0、意圖音效政策 100% |
| 排隊上限 `waitMs` | 在佇列最多等多久；**預設＝逾時**（行為不變） | 排隊的人很快拿到規則台詞，底層仍一次一個 |
| `private/hub.txt` 排程設定 | `ai_queue`（1–32）、`ai_timeout_ms`（1000–60000）、`ai_wait_ms`（500–60000）；超出範圍用預設 | 範圍測試 |
| 模型不重載 | 與 FairyPocket 相同的模型與選項（temperature 0.8、num_predict 160、keep_alive 30m，不設 num_ctx／num_gpu） | 測試比對 `src/brain/brain.ts` |
| 真實清單格式 | `test/fixtures/ollama-tags-2026-11-06.json`（唯讀取得，只留名稱、大小、digest、規格） | 固定 digest 通過；digest 不符、12b 不在白名單、雲端名稱、Ollama 端換模型 → 規則台詞、零聊天請求 |
| 量測掛鉤 `onResult` | ollamaAdapter 可選擇回報 Ollama 的計時欄位與回應欄位名稱（預設沒有，不含內容） | 真實測試使用 |

合成負載摘要（估計值，不是 GPU 實測）：
- 預設設定（逾時 12 秒、排隊 12 秒）：10 人以上最慢 15–17 秒；20 人有 16–32 次佇列滿。
- 建議設定（逾時 8 秒、排隊 3 秒）：20 人中位約 3 秒、最慢 7.5 秒、幾乎沒有被拒。代價是規則台詞變多。

## 2. 真實環境唯讀檢查（A＋B，經批准）
- Ollama 0.40.14；`ollama.exe serve`（PID 26084，07:30:56 啟動，帳戶 `DESKTOP-9VHKLU1\gaday`，啟動者無法確認）。
- 模型：`gemma3:4b`（digest `68ceab7e…babac38df7`）、`gemma3:12b`；都是本機模型，沒有遠端欄位。
- 雲端停用：環境變數沒有 `OLLAMA_NO_CLOUD`。經批准建立 `C:\Users\gaday\.ollama\server.json`＝`{"disable_ollama_cloud": true}`（建立前不存在；SHA-256 `F4D9F4EF…73C7F`）。**沒有重新啟動 Ollama，尚未經重新啟動驗證，目前執行中的 Ollama 是否生效：未知。** 還原：刪除這個檔案。

## 3. 最小真實 Ollama 測試（經批准，2026-11-06 22:47）
**範圍**：獨立測試 Hub（暫存資料夾、測試通行碼、隨機埠）＋合成玩家；不經過運作中的轉接服務；**推論請求剛好 2 次**（工具內有上限保險，超過 2 次會直接丟出錯誤）。測試前先用假 Ollama 演練過工具。

**事前檢查（全部通過，才送出推論）**：版本 0.40.14；gemma3:4b 通過白名單＋固定 digest；清單中沒有遠端模型；測試前沒有載入的模型。

**請求 ① 一般請求**（經 Hub 的 talk 路徑）
| 項目 | 結果 |
|---|---|
| 路由 | `LOCAL_OLLAMA`；回應模型 `gemma3:4b`；`done_reason: stop`；回應欄位沒有任何 remote 欄位 |
| 完整回應延遲（Hub 端量） | **7.73 秒**（冷啟動，含模型載入） |
| 模型載入時間（Ollama `load_duration`） | **7.00 秒** |
| 首個輸出時間 | **約 7.26 秒**（載入＋提示處理；非串流，以 Ollama 計時欄位推算）。已載入時估計約 0.25 秒 |
| 提示處理 | 234 tokens，0.25 秒 |
| 生成 | 38 tokens，0.43 秒（**88.3 tokens/秒**） |
| GPU 記憶體 | 1,292 → 5,045 MiB（`/api/ps` 的 size_vram 2.88 GB） |
| 回答 | 台灣繁體中文 40 字；意圖 `DIALOGUE`、`soundPolicy: MINECRAFT_PRESERVE_EXISTING_SYNTHETIC` |

**請求 ② 中途取消**（Hub 推論逾時設為 400 毫秒）
| 項目 | 結果 |
|---|---|
| Hub 端 | 429 毫秒後回規則台詞；排程器記錄 1 次取消；**Ollama 的回應沒有到達** |
| 推論程序（`llama-server.exe`，ollama.exe 的子程序）CPU 累計 | 請求前 3,656 ms → 取消後第一次取樣 4,094 ms（請求期間使用約 438 ms）→ 取消後 1.5 秒 **4,094 ms（沒有增加）** → 3 秒 4,109 ms（+15 ms，閒置雜訊）→ 6 秒 4,109 ms |
| 測試結束後再確認 | 3 秒內主程序與推論程序 CPU 都增加 **0 ms**；GPU 使用率 16%（測試前基準 15%）；Ollama 仍是同一個程序（沒有重新啟動）；模型照 keep_alive 30 分鐘留在 GPU，到 23:17 自動卸載 |

**判讀**：如果沒有被取消，這個「請講很長的故事」的請求最多會生成 160 tokens，以 88 tokens/秒約需 1.8 秒，大約在取消後 1.5 秒才會自然結束。推論程序的 CPU 從取消後第一次取樣（約 1 秒內）到 1.5 秒完全沒有增加，**強烈顯示 Ollama 在取消後就停止了推論**，而不只是 HTTP 連線結束。

**限制（如實記錄）**：
- 第一次實測時，CPU 取樣是同步執行的（每次約 0.5–1 秒），讓 GPU 取樣的時間戳成批延遲，**GPU 時間線無法精確到 1 秒以內**；只能確認 GPU 在取消後約 1.2 秒內回到基準，之後到 7 秒都維持基準。
- 「取消後第一次取樣」的實際時間不精確（取消後約 0.3–1 秒），所以無法精確說出停止的時間點。
- 無法知道這個請求若不取消實際會生成幾個 tokens（如果模型自己很早就結束，這個證據就分不出差別）。
- 已修正量測工具：CPU 取樣改成非同步、GPU 取樣加上 nvidia-smi 自己的時間戳；用假 Ollama 演練，到達延遲中位 1 ms、最大 45 ms。**修正後的工具還沒有用真正的 Ollama 跑過**（需要再批准一次取消請求）。

**停止條件**：沒有觸發（模型相符、沒有遠端路由、沒有服務錯誤、整體在 30 秒內完成）。

## 4. 建議審查重點
1. `realSmoke.mjs`：事前檢查失敗就不推論；推論次數上限；請求 ① 不符預期就不送請求 ②。
2. `localai.mjs`：`waitMs`（預設不變）、`schedulerOptsFrom()` 的範圍、`onResult` 只回報計時與欄位名稱。
3. `mcLoad.mjs`／`fakeOllama.mjs`：並行與取消的計算方式。
4. 真實測試的判讀與限制是否足以說明「取消會停止推論」。

## 5. 尚未完成、需要另外批准
| 項目 | 說明 |
|---|---|
| 確認 `disable_ollama_cloud` 生效 | 等 Ollama 下次自然重新啟動後唯讀確認（方法見 `H3-2-PLAN.md` §5）；若由 FairyPocket 啟動腳本啟動，目前沒有日誌可確認 |
| 精確的取消時間線 | 用修正後的工具再做 1 次取消請求 |
| 小規模真實負載（1→2→5 人） | 依 H3-2-PLAN.md §4 的 C 方案 |
| 10／20 人負載 | 依 D 方案（影響較大） |
| 決定正式的 `ai_*` 與 `model_digest` 設定 | 依真實數據；目前沒有寫入任何正式設定 |
