const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

// ===== STATE =====
const sessions = new Map<number, any>();
let kvStorePromise: Promise<any | null> | undefined;

function emptyData(name = "") {
  return {
    name,
    truck: "",
    issue: "",
    drop: "",
    media: []
  };
}

function newSession() {
  return {
    step: 1,
    data: emptyData()
  };
}

async function sessionStore() {
  if (!kvStorePromise) {
    kvStorePromise = Deno.openKv().catch((error) => {
      console.error("Deno KV unavailable; using in-memory sessions only", error);
      return null;
    });
  }

  return await kvStorePromise;
}

async function getSession(id: number) {
  const store = await sessionStore();

  if (store) {
    const result = await store.get(["sessions", id]);
    if (result.value) {
      const saved = structuredClone(result.value);
      sessions.set(id, saved);
      return structuredClone(saved);
    }
  }

  const session = sessions.get(id) || newSession();
  sessions.set(id, structuredClone(session));
  return structuredClone(session);
}

async function saveSession(id: number, s: any) {
  const session = structuredClone(s);
  sessions.set(id, session);

  const store = await sessionStore();
  if (store) {
    await store.set(["sessions", id], session);
  }
}

// ===== SEND =====
async function send(chat: string, text: string, keyboard?: any) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      reply_markup: keyboard
    })
  });
}

async function sendMedia(items: any[]) {
  if (!items.length) return;

  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP,
      media: items.map((m, i) => ({
        type: m.type,
        media: m.file_id,
        caption: i === 0 ? "📎 Поломки" : undefined
      }))
    })
  });
}

// ===== CARD =====
function card(s: any) {
  return `🚛 Новый репорт

имя - ${s.data.name || "—"}
трак - ${s.data.truck || "—"}
поломка - ${s.data.issue || "—"}

файлы - ${s.data.media.length}

когда оставляет трак - ${s.data.drop || "—"}`;
}

async function sendCurrentPrompt(chat: string, s: any) {
  const prompts: Record<number, string> = {
    1: "Введите имя и фамилию",
    2: "Введите номер трака",
    3: "Опишите поломки",
    4: "Когда оставляет трак?",
    5: "Отправьте фото или видео поломки"
  };

  await send(chat, prompts[s.step] || prompts[1]);
}

// ===== SERVER =====
Deno.serve(async (req) => {
  const u = await req.json();
  const msg = u.message;
  const cb = u.callback_query;

  // ================= CALLBACK =================
  if (cb) {
    const s = await getSession(cb.from.id);

    if (cb.data === "confirm") {
      await send(GROUP, card(s));
      await sendMedia(s.data.media);

      // Keep the driver's name for the next report, but clear report-specific data.
      s.step = 2;
      s.data = emptyData(s.data.name);
      await saveSession(cb.from.id, s);

      await send(cb.message.chat.id, "Заявка отправлена", {
        inline_keyboard: [[
          { text: "Создать новый репорт", callback_data: "new" }
        ]]
      });

      return new Response("ok");
    }

    if (cb.data === "new") {
      s.step = s.data.name ? 2 : 1;
      s.data = emptyData(s.data.name);
      await saveSession(cb.from.id, s);

      await sendCurrentPrompt(cb.message.chat.id, s);
      return new Response("ok");
    }
  }

  if (!msg) return new Response("ok");

  // ❗ игнор групп
  if (msg.chat.type !== "private") return new Response("ok");

  const s = await getSession(msg.from.id);
  const text = msg.text?.trim() || "";

  // ================= FLOW =================
  if (text === "/start") {
    // Resume the persisted draft instead of erasing fields already entered.
    if (!s.data.name && s.step !== 1) {
      s.step = 1;
      await saveSession(msg.from.id, s);
    }
    await sendCurrentPrompt(msg.chat.id, s);
    return new Response("ok");
  }

  if (s.step === 1) {
    if (!text) {
      await send(msg.chat.id, "Введите имя и фамилию текстом");
      return new Response("ok");
    }

    s.data.name = text;
    s.step = 2;
    await saveSession(msg.from.id, s);
    await send(msg.chat.id, "Введите номер трака");
    return new Response("ok");
  }

  if (s.step === 2) {
    if (!text) {
      await send(msg.chat.id, "Введите номер трака текстом");
      return new Response("ok");
    }

    s.data.truck = text;
    s.step = 3;
    await saveSession(msg.from.id, s);
    await send(msg.chat.id, "Опишите поломки");
    return new Response("ok");
  }

  if (s.step === 3) {
    if (!text) {
      await send(msg.chat.id, "Опишите поломки текстом");
      return new Response("ok");
    }

    s.data.issue = text;
    s.step = 4;
    await saveSession(msg.from.id, s);
    await send(msg.chat.id, "Когда оставляет трак?");
    return new Response("ok");
  }

  if (s.step === 4) {
    if (!text) {
      await send(msg.chat.id, "Напишите, когда оставите трак");
      return new Response("ok");
    }

    s.data.drop = text;
    s.step = 5;
    await saveSession(msg.from.id, s);
    await send(msg.chat.id, "Отправьте фото или видео поломки");
    return new Response("ok");
  }

  // ================= MEDIA =================
  if (s.step === 5) {
    if (!msg.photo && !msg.video) return new Response("ok");

    const item = msg.photo
      ? { type: "photo", file_id: msg.photo.at(-1).file_id }
      : { type: "video", file_id: msg.video.file_id };

    s.data.media.push(item);
    await saveSession(msg.from.id, s);

    // ❗ ВАЖНО: карточка только 1 раз, после первого медиа
    if (s.data.media.length === 1) {
      await send(msg.chat.id, card(s), {
        inline_keyboard: [[
          { text: "Подтвердить", callback_data: "confirm" }
        ]]
      });
    }

    return new Response("ok");
  }

  return new Response("ok");
});
