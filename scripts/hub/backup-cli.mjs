// Fairy Hub 資料的備份、驗證、還原（資料在 private/allay-hub/）
//   node scripts/hub/backup-cli.mjs backup <放快照的資料夾>
//   node scripts/hub/backup-cli.mjs verify <快照資料夾>
//   node scripts/hub/backup-cli.mjs restore <快照資料夾>     ※ 還原前請先停止轉接服務
//   可以用 --dir <資料夾> 指定別的 Hub 資料夾（測試用）

import path from 'node:path';
import { backup, restore, verifyBackup } from './store.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--dir');
const dir = i >= 0 ? path.resolve(args.splice(i, 2)[1]) : path.resolve(import.meta.dirname, '..', '..', 'private', 'allay-hub');
const [cmd, target] = args;
try {
  if (cmd === 'backup' && target) console.log(`快照：${backup(dir, path.resolve(target))}`);
  else if (cmd === 'verify' && target) console.log(`快照正確，共 ${verifyBackup(path.resolve(target)).length} 個檔案`);
  else if (cmd === 'restore' && target) {
    const r = restore(path.resolve(target), dir);
    console.log(`已還原 ${r.restored} 個檔案${r.previous ? `；原本的資料保留在 ${r.previous}` : ''}`);
  } else {
    console.log('用法：backup <資料夾> | verify <快照> | restore <快照>  [--dir <Hub 資料夾>]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`失敗：${e.code ?? e.message}${e.extra ? ` ${JSON.stringify(e.extra)}` : ''}`);
  process.exitCode = 1;
}
