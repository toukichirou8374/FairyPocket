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

目前所有模型貼圖、圖示皆為原創暫用像素圖（程式內以字串格子繪製），
未包含任何 Minecraft 原版檔案。替換位置：

- 悅靈貼圖：`src/three/allayModel.ts`
- 介面圖示（愛心、飽食度、道具）：`src/pixel.ts`
- App 圖示：`scripts/gen-icons.mjs`

## 結構

- `src/game/` 數值、存檔、台詞（純邏輯，有單元測試）
- `src/three/` 3D 模型、行為與動畫、場景特效
- `src/ui/` 介面
