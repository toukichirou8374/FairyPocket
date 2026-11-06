# H2 交接（供 GPT Work 獨立審查）

## 範圍
- 分支：`feat/h2-hub`（FairyPocket 儲存庫，從 main 的 `6d7ed80`／v0.49.2 分出），沒有推送到遠端，沒有部署。
- 本批完成後停止，等待使用者驗收；不自動進入下一階段。
- 全部使用合成玩家與測試資料；沒有連接正式 Paper／NewProject、沒有修改 Geyser／Floodgate、沒有遷移真實 FairyPocket 存檔、沒有連接真正的 Ollama（測試用假的）。
- FairyPocket 的 App 程式（src/）沒有修改。

## 檔案
| 檔案 | 內容 |
|---|---|
| `docs/hub/CONTRACT.md` | 統一契約（Hub v1 API＋H1＋四項修正），§12 為與 H1 的差異 |
| `scripts/hub/schema.mjs` | 真實 PetState 驗證、Java／Floodgate 身分、事件驗證、雜湊用的固定序列化 |
| `scripts/hub/rules.mjs` | 事件套用規則（與 FairyPocket 相同）、每日上限 |
| `scripts/hub/store.mjs` | 交易式耐久儲存、啟動復原、備份／驗證／還原 |
| `scripts/hub/localai.mjs` | 只限本機的 AI 路由政策、Ollama 介面、排程 |
| `scripts/hub/hub.mjs` | HTTP API（16 個路徑），權限 → 去重 → epoch → revision → 規則 |
| `scripts/hub/backup-cli.mjs` | 備份工具 |
| `scripts/ai-proxy.mjs` | 既有轉接服務：改成 `createRelay()`、兩組憑證與角色分流、Hub 預設關閉 |
| `scripts/hub/test/*.test.mjs` | 40 項測試 |
| `docs/hub/RESULTS.md`、`test-output.txt` | 測試結果與 H1 對照 |
| `docs/hub/COMPATIBILITY.md` | 相容性評估與已知限制 |
| `docs/hub/STORAGE-RECOVERY.md` | 儲存與復原驗證 |

## 如何重跑
```
npm run test:hub
```
不需要下載任何東西（只用 Node 內建模組）。測試會在系統暫存資料夾建立並刪除資料，不會碰 `private/`。

## 建議優先審查
1. **處理順序**（hub.mjs 的 events 路徑）：權限 → 去重 → epoch → revision → 控制者 → 容量 → 套用 → 交易寫入。特別是「重複的舊事件在換世代後仍回歷史結果」與「撤銷後連重送都 403」。
2. **去重雜湊**：用驗證後的 `{type, at, payload}` 計算；同 opId 但內容不同 → `ID_COLLISION`。
3. **交易寫入**（store.mjs `commit`）：只有 rename 成功才更新快取；失敗不留部分寫入。
4. **Minecraft 不能直接改數值**：`validateEvent` 的角色白名單（mc 沒有 VITALS_SYNC）、`rules.mjs` 的每日上限、稀有物品由 Hub 判斷。
5. **公開／私人**：`view(doc, 'mc')` 與聊天的 prompt 只用公開狀態。
6. **雲端封鎖**：`checkRoute` 白名單、轉接服務的 mc 角色在非 Hub 路徑一律 403、Hub 沒有任何雲端呼叫路徑。
7. **身分**：`parseActor` 的版本 4 檢查與 Floodgate UUID 一致性；名稱只用於顯示。
8. **綁定**：碼只存雜湊、單次使用、10 分鐘、錯 5 次鎖 15 分鐘（寫入磁碟）、手機確認才生效。

## 與 H1 的差異（重點）
- 去重鍵用**穩定來源 ID**（`X-Fairy-Source`），不是當次 session；去重紀錄耐久化。
- 數值用 FairyPocket 的真實尺度與規則；新增 `VITALS_SYNC`（只限手機控制者，用於手機回報自己的生活模擬）。
- 排程簡化：沒有觀察通道與 2:1 優先（目前只有聊天）。
- 實作語言是 Node；H1 的 Java 原型沒有被引用。

## 已知限制與下一階段建議（尚未批准）
見 COMPATIBILITY.md 的「已知限制」。建議順序：
1. FairyPocket 端：登記、同步（事件＋opId 佇列、離線暫存）、綁定確認畫面、冒險轉回憶。
2. Paper 插件（隔離的測試伺服器）：從登入工作階段取得 Java UUID／Floodgate XUID、事件提交、意圖執行與收據。
3. 控制權租約（時間到期、斷線交回）。
4. 用真正的 Ollama 量延遲與容量，再調整排程。
5. 定期備份到另一個位置。

正式啟用（`private/hub.txt` 的 `enabled=1`）與任何正式伺服器變更，都需要使用者另外同意。
