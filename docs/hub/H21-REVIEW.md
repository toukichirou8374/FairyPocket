# H2.1 複審資料（給 Astra）

- 分支：`feat/h2-hub`；基準 `6d8a279`（H2）→ H2.1 commit 見 `git log`。只修補八項 P1 與兩項 P2，沒有重新開發、沒有更換架構。
- 測試：`npm run test:hub` → **58 項全部通過**（H2 的 40 項＋H2.1 新增 18 項；store 測試依新的 fail-closed 政策改寫）。連續 3 次 58/58。完整輸出：`test-output.txt`。
- **重現證據**：把 9 項行為回歸測試放到原本的 H2（6d8a279）上跑 → **9 項全部失敗**（`h21-old-code-check.txt`）；在 H2.1 上全部通過。其餘新測試用到 H2.1 才有的函式（模型驗證、取消、還原檢查），無法在舊版上執行。
- 只用合成資料、假 AI、假 Ollama、暫存資料夾、測試埠。沒有使用正式 Hub 資料、真實存檔、運作中的轉接服務或正式 Ollama。

## 八項 P1
| # | 問題 | 修補 | 主要位置 | 測試（h21.test.mjs／store.test.mjs） |
|---|---|---|---|---|
| 1 | Minecraft 可能透過 Ollama 間接用到雲端模型 | 本機模型白名單＋每次推論前驗證 `/api/tags`（在白名單、已安裝、非雲端：名稱含 cloud 或帶 remote_host／remote_model、有本機大小與 digest、可選 digest 固定），回應模型名稱也要相同；無法驗證 → 規則台詞、不送聊天請求。文件建議在 Ollama 設定官方的 `OLLAMA_NO_CLOUD=1`，Hub 不修改、不重啟 Ollama | `localai.mjs` `verifyLocalModel`、`ollamaAdapter`；`ai-proxy.mjs`（`model_digest`） | 「P1-1 模型驗證」（10 種拒絕情況）、「P1-1 端對端」（假 Ollama：本機通過、雲端／連不上／模型被換都改規則且聊天請求 0 次） |
| 2 | VITALS_SYNC 舊快照蓋掉新狀態 | 暫停 VITALS_SYNC：任何角色都 `403`（where = `VITALS_SYNC_DISABLED`），等正式交接調和機制 | `schema.mjs` `DISABLED_TYPES` | 「P1-2」：手機拿舊快照、Minecraft 送禮、手機取回控制權後送快照 → 403，禮物的感情還在 |
| 3 | 過期的 AI 回答被標成新 epoch | 推論開始記下 epoch／rev；完成時重新驗證權限、去重、epoch；換世代 → `409 STALE_EPOCH`、不寫入、不簽發；意圖帶開始時的 epoch／basisRevision | `hub.mjs` talk | 「P1-3」：推論中途取得控制權 → 409、對話 0 筆；同 opId 重送後以新 epoch 正常處理 |
| 4 | 綁定／撤銷跨兩份文件，寫一半就半授權 | 授權與待確認都移到悅靈文件：確認、拒絕、撤銷都是單一文件交易；claim 先作廢碼（hub.json）再記待確認（悅靈文件），第二步失敗 → 狀態 `failed`、無授權；hub.json 損壞 → 綁定操作 503；whoami 直接看悅靈文件 | `hub.mjs` link 路徑 | 「P1-4 第 1 份成功、第 2 份失敗」、「P1-4 確認與撤銷單一文件」（失敗→無授權／維持原狀、重試、重啟後一致）、「P1-4 hub.json 損壞」 |
| 5 | 損壞時自動退回舊版，重新開放已撤銷權限、epoch 回退 | 不再自動退回：只有暫存檔＝首次建立中斷（當作不存在）；正式檔損壞或不見＝資料損壞 → fail-closed（503、拒絕覆寫與重新登記），證據複製到 quarantine/；新增人工 `recover` 指令並留紀錄 | `store.mjs` `#recover`、`recoverDoc`；`backup-cli.mjs` | 「P1-5 第一次建立就中斷」、「P1-5 正式檔損壞」、「P1-5 正式檔不見但有前一版」、「P1-5 撤銷後正式檔損壞」（HTTP：已撤銷的玩家拿到 503 不是 200、不能重新登記、證據存在） |
| 6 | 備份還原缺少檢查、可能不一致 | 備份拒絕：來源不存在、意外空資料、損壞文件、跨文件不一致；CLI 讀兩次確認穩定（否則 `BACKUP_UNSTABLE`）；執行中用 `hub.backup()` 從快取同步建立。驗證加上清單外檔案、悅靈數量、跨文件一致性。還原拒絕回退（`--allow-rollback` 才放行）、複製或替換中途失敗都保住原資料 | `store.mjs` `backup`、`backupFromStores`、`verifyBackup`、`restore`、`checkConsistency` | store：「P1-6 備份…都拒絕」、「P1-6 一直變動 → BACKUP_UNSTABLE」、「P1-6 驗證：少檔、多檔…」、「P1-6 還原：拒絕回退」、「P1-6 還原中途失敗」；h21：「P1-6 執行中的 Hub 快照」 |
| 7 | Minecraft 共享記憶擠掉手機私人記憶 | 記憶與對話額度依來源分開（記憶 fp 40／mc 20；對話各 32），只移除同來源最舊的 | `rules.mjs` `trimOwn` | 「P1-7」：手機 40 條私人記憶＋32 句對話後，Minecraft 送 45 條記憶＋45 句對話 → 手機的全部還在，Minecraft 留最新 20／32 |
| 8 | 逾時只釋放名額、底層請求繼續跑 | AbortSignal 傳到底層（Ollama 介面用 http 的 signal）；名額等底層真的結束才釋放；佇列中等超過逾時直接回規則並移出 | `localai.mjs` `Scheduler` | 「P1-8 逾時」：底層不理會取消、每次跑 250ms、逾時 60ms，4 個請求 → 都很快回規則，**底層實際並行數 1**；「P1-8 取消會傳到底層」：支援取消的請求立刻停止、名額釋放 |

## P2
| 項目 | 處理 |
|---|---|
| 同一個 talk opId 並行送達重複推論 | 已修：進行中請求去重（共用同一次推論，內容不同 → ID_COLLISION）。測試「P2 同一個 talk opId 同時送 3 次」：AI 只被呼叫 1 次、意圖相同 |
| Minecraft 行動者身分 | 已在 CONTRACT §2 明確記載：這是可信 Paper 後端的斷言，Hub 沒有自己完成正版登入驗證；mc 憑證外洩等同可冒充任何玩家 |
| 正式 Pocket、Ollama、每日排程的效能回歸 | 列入後續真實整合驗收（下表），本批沒有連接任何生產服務 |

## 已修復（以合成環境驗證）vs 仍待真實環境驗證
| 已修復 | 仍待真實環境驗證 |
|---|---|
| 八項 P1、兩項 P2 的程式行為（58 項測試） | 真正的 Ollama：`/api/tags` 的實際欄位（特別是雲端模型的 remote 欄位）、`OLLAMA_NO_CLOUD` 是否已設定、延遲、取消是否真的讓 Ollama 停止推論 |
| Store 的 fail-closed 與證據保留 | Windows 上真實斷電時 fsync／rename 的行為（目前是故障注入） |
| 備份還原的檢查 | 實際資料量的備份時間；在服務執行中使用 CLI 備份（建議改用 `hub.backup()`） |
| 綁定單一文件授權 | 真實的 Paper 插件與 Floodgate 身分（目前是模擬認證） |
| — | 正式 FairyPocket、Ollama、每日排程（17:30 的語音任務）同時運作時的效能回歸 |
| — | 還原／人工復原時「服務必須先停止」目前靠流程，程式沒有強制檢查 |

## 建議複審重點
1. `localai.mjs`：`verifyLocalModel` 的判斷是否涵蓋 Ollama 雲端模型的所有表示方式；驗證快取 60 秒的取捨。
2. `hub.mjs` talk：`inflight` 與 `seen` 的順序、STALE_EPOCH 不寫入的分支。
3. `hub.mjs` link：claim 的兩步順序與 `failed` 狀態；確認、撤銷都只寫悅靈文件。
4. `store.mjs` `#recover`：三種情況的判斷（尤其「只有暫存檔」才當作首次建立）。
5. `store.mjs` `restore`：回退檢查、兩種中途失敗的復原。

本批完成後停在 H2.1：不合併、不部署、不啟用 Hub、不開始 H3。
