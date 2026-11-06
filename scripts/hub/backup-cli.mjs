// Fairy Hub 資料的備份、驗證、還原、人工復原（資料在 private/allay-hub/）
//   node scripts/hub/backup-cli.mjs backup <放快照的資料夾>        ※ 服務停止時用（會讀兩次確認資料沒變）
//   node scripts/hub/backup-cli.mjs verify <快照資料夾>
//   node scripts/hub/backup-cli.mjs restore <快照資料夾> [--allow-rollback]   ※ 先停止轉接服務
//     使用 --allow-rollback 可能恢復已撤銷的玩家權限、舊 epoch 與過去的資料狀態，必須停用服務並經主人明確批准。
//   node scripts/hub/backup-cli.mjs recover <文件名稱> prev|tmp [--pets]       ※ 損壞文件的人工處理，先停止轉接服務
//   可以用 --dir <資料夾> 指定別的 Hub 資料夾（測試用）

import path from 'node:path';
import { backup, recoverDoc, restore, verifyBackup } from './store.mjs';

const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const i = args.indexOf('--dir');
const dir = i >= 0 ? path.resolve(args.splice(i, 2)[1]) : path.resolve(import.meta.dirname, '..', '..', 'private', 'allay-hub');
const allowRollback = flag('--allow-rollback');
const pets = flag('--pets');
const [cmd, target, from] = args;
try {
  if (cmd === 'backup' && target) console.log(`快照：${backup(dir, path.resolve(target))}`);
  else if (cmd === 'verify' && target) console.log(`快照正確，共 ${verifyBackup(path.resolve(target)).files.length} 個檔案`);
  else if (cmd === 'restore' && target) {
    const r = restore(path.resolve(target), dir, Date.now(), { allowRollback });
    console.log(`已還原 ${r.restored} 個檔案${r.previous ? `；原本的資料保留在 ${r.previous}` : ''}`);
  } else if (cmd === 'recover' && target && from) {
    const r = recoverDoc(pets ? path.join(dir, 'pets') : dir, target, from);
    console.log(`已用 ${r.from} 復原 ${r.name}（rev ${r.rev}、epoch ${r.epoch}）；證據保留在 ${r.evidence}`);
  } else {
    console.log('用法：backup <資料夾> | verify <快照> | restore <快照> [--allow-rollback] | recover <名稱> prev|tmp [--pets]  [--dir <Hub 資料夾>]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`失敗：${e.code ?? e.message}${e.extra ? ` ${JSON.stringify(e.extra)}` : ''}`);
  process.exitCode = 1;
}
