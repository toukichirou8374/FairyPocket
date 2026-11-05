// 用悅靈的設定測試家裡電腦的本機 AI（比較模型用）：node scripts/brain-test.mjs gemma3:4b [其他模型…]
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const brain = await server.ssrLoadModule('/src/brain/brain.ts');
const state = await server.ssrLoadModule('/src/game/state.ts');
await server.close();

const pet = state.createPet();
pet.name = '小悅';
pet.personality = 'playful';
pet.affection = 80;
pet.memory.days = 12;
pet.memory.streak = 3;
const QS = {
  zh_tw: ['我今天在學校被同學笑了', '你覺得恐龍是怎麼消失的？', '我家的狗狗叫做小白，牠好可愛', '我跟你說過我家狗狗叫什麼嗎？'],
  ja_jp: ['今日はテストで100点だったよ！', '宇宙ってどこまで続いてるの？'],
  en_us: ["I'm bored, what should we do?", 'Why is the sky blue?'],
};
for (const model of process.argv.slice(2)) {
  console.log(`\n===== ${model} =====`);
  for (const [lang, qs] of Object.entries(QS)) {
    const mem = { turns: [], notes: [] };
    for (const q of qs) {
      const sys = brain.buildSystem(pet, mem, lang, { hour: 19, asleep: false, foodName: (f) => f });
      const t0 = Date.now();
      const raw = await brain.ask({ on: true, url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434', token: '', model }, sys, mem, q, 120000);
      const r = brain.parseReply(raw ?? '');
      brain.remember(mem, 'user', q);
      brain.remember(mem, 'allay', r.text);
      r.notes.forEach((n) => brain.addNote(mem, n));
      console.log(`[${lang}] ${q}\n  → (${((Date.now() - t0) / 1000).toFixed(1)}s, ${r.feeling ?? '-'}) ${r.text}${r.notes.length ? `  〔記住：${r.notes.join('／')}〕` : ''}`);
    }
  }
}
