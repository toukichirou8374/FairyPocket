# FairyPocket

以悅靈為主角的 3D 隨身寵物 PWA（TypeScript + Vite + Three.js）。

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 開發模式（同 Wi-Fi 的手機可連線預覽） |
| `npm test` | 單元測試 |
| `npm run build` | 型別檢查並建置到 `dist/` |
| `npm run preview` | 預覽建置結果（含離線功能） |
| `npm run icons` | 重新產生 App 圖示 |

## 素材說明

悅靈模型的比例、轉軸與 UV 依照原版悅靈製作。網站本身**不含任何 Minecraft 原版檔案**，
預設顯示原創暫用貼圖。

### 原版素材包（個人使用，禁止公開）

1. `npm run pack`：從自己安裝的 Minecraft Java 版遊戲檔（唯讀）取出**全部材質**與
   **背景音樂、唱片以外的全部音效**（保留原版路徑），產生 `private/FairyPocket-原版素材包.zip`
   （約 90 MB）。`private/` 已排除在 Git 與建置之外。
2. 在遊戲「設定 → 匯入原版素材」選這個檔案，素材存在該裝置的 IndexedDB。
   用本機 `npm run dev`／`npm run preview` 開啟時會自動套用最新的素材包（建置結果不含這個檔案）。
3. 程式用原版路徑取素材，例如 `sound.play('sounds/random/pop', 0.5)`；
   之後新增功能只要用素材包裡已有的檔案，就不必重新匯入。

## 結構

- `src/game/` 數值、存檔、台詞（純邏輯，有單元測試）
- `src/three/` 3D 模型、行為與動畫、場景特效
- `src/ui/` 介面


## 字型

介面的像素字型是 [GNU Unifont](https://unifoundry.com/unifont/)（SIL Open Font License 1.1，授權全文見 `fonts/UNIFONT-LICENSE.txt`）挑出遊戲用到的字做成的精簡版 `public/fonts/fairypocket-pixel.ttf`。改了介面文字或台詞後執行 `npm run font` 重新產生（測試會檢查有沒有漏字）。有原版素材包時，英數字會在裝置上用素材包的 `textures/font/ascii.png` 即時產生原版字型，網站本身不含原版字型。
