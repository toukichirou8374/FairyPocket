# H2 相容性評估

## FairyPocket v0.49.2
| 項目 | 狀態 | 說明 |
|---|---|---|
| App 程式（src/） | **未修改** | 飛行、聲音、貼紙、互動、AI、雲端 AI 都沒動 |
| PetState 格式 | 相容 | Hub 依 v0.49.2 的真實格式驗證（版本 1、ID `ABCD-1234`、生命／飽食 0–20、名字 12 字）；測試會讀取 `src/game/state.ts`，確認上限值、食物表、最愛的食物、睏度與 Hub 一致，改了原碼而沒改 Hub 會測試失敗 |
| 數值規則 | 相容 | FED／PETTED／PLAYED／tickPet 與 `state.ts` 的 feed／pet／play／tickPet 相同 |
| 記憶 | 部分 | FairyPocket 的 notes 是純文字陣列；Hub 的記憶帶 memoryId、可見度、來源。同步時由手機產生 memoryId，預設為 private（下一階段實作） |
| 尚未接上 | — | 手機端的同步、綁定確認畫面、冒險轉回憶都還沒做（不在本批範圍） |

## 既有的本機轉接服務（scripts/ai-proxy.mjs）
| 項目 | 狀態 |
|---|---|
| 手機使用本機 AI（/api/tags、/api/chat） | 行為不變（relay 測試確認：轉給 Ollama、拿掉通行碼、本機 Host） |
| 危險路徑、大小限制、來源網站檢查 | 行為不變 |
| FairyPocket 的雲端 AI | 行為不變：只限 fp 角色＋主人本人的 Tailscale 帳號；每日／每月上限不變 |
| 改動 | 改寫成 `createRelay()` 可以測試；直接執行時的行為與原本相同 |
| Hub 預設關閉 | `private/hub.txt` 寫 `enabled=1` 才會啟用；**合併後也不會自動啟用** |
| 新增 | 第二組通行碼（Minecraft）、角色分流、Minecraft 另外計算的頻率限制 |

## H1（GPT Work）
| 項目 | 狀態 |
|---|---|
| 契約語意 | 採用：只能用事件寫入、控制權 epoch、去重與碰撞、意圖與收據、只限本機 AI、音效政策、儲存失敗明確拒絕 |
| 差異 | 見 CONTRACT.md §12：去重鍵改用穩定來源 ID、去重紀錄寫入磁碟、真實數值尺度、HTTP 介面、簡化的排程 |
| 程式碼 | 沒有引用或修改 H1 的 Java 原始碼；H1 工程只讀 |
| 執行環境 | Node（既有），不需要 Java |

## Minecraft（Paper＋Geyser＋Floodgate）
| 項目 | 狀態 |
|---|---|
| 身分 | Java：正版 UUID（版本 4）；基岩版：XUID＋相符的 Floodgate UUID。**本批是模擬認證**：Hub 驗證格式與一致性，並信任 mc 憑證送來的身分；Paper 插件要從登入工作階段取得身分（下一階段） |
| 正式伺服器 | 未連接、未修改；Geyser、Floodgate 設定未動 |
| 音效 | 意圖只帶 `soundPolicy: MINECRAFT_PRESERVE_EXISTING_SYNTHETIC`，沒有任何音訊欄位 |
| 雲端 AI | 程式層封鎖（路由白名單＋mc 憑證不能使用雲端路徑），測試確認雲端呼叫次數為 0 |

## H2.1 的變更
- VITALS_SYNC 暫停（手機回報整份數值要等交接調和機制）。
- 損壞的文件不再自動復原，需要人工 `recover`。
- Minecraft 的 AI 需要本機模型通過白名單驗證；建議在 Ollama 設定 `OLLAMA_NO_CLOUD=1`（Hub 不修改 Ollama）。
- 綁定資料改放在悅靈文件（H2 的 hub.json 綁定格式不相容；H2 從未啟用，沒有需要遷移的資料）。

## 已知限制（交給下一階段）
1. **真實認證**：mc 憑證是單一伺服器通行碼；還沒有 Paper 插件，身分由測試模擬。
2. **多程序**：Hub 假設只有一個轉接服務程序在寫資料（目前就是這樣）；多程序需要檔案鎖或資料庫。
3. **控制權租約**：epoch 切換是明確的 claim／release，沒有依時間自動過期；Paper 斷線不會自動交回控制權。
4. **排程**：只有聊天一種請求；沒有觀察通道、token 預算。取消已實作（H2.1），但真正的 Ollama 收到取消後是否立刻停止推論還沒實測。
5. **效能**：沒有用真正的 Ollama 測過延遲或玩家容量（RTX 2060S 一次一個請求）；也還沒驗證正式 FairyPocket、Ollama、每日排程同時運作時的效能回歸（列入真實整合驗收）。
6. **資料遷移**：沒有遷移任何真實 FairyPocket 存檔。
7. **Windows 資料夾 fsync**：Windows 不支援對資料夾 fsync；檔案本身有 fsync，改名在 NTFS 上是原子的。
8. **身分信任界線**：行動者身分是可信 Paper 後端的斷言，Hub 沒有自己完成正版登入驗證。
