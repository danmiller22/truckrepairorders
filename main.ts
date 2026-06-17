const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

// 🔥 ПЕРСИСТЕНТНАЯ ПАМЯТЬ
const kv = await Deno.openKv();

const albumBuffer = new Map<string, {
  items: { type: "photo" | "video"; file_id: string }[],
  timeout: number
}>();

async function getSession(id: number) {
  const res = await kv.get(["session", id]);
  return res.value || { step: 1, data: { media: [] } };
}

async function saveSession(id: number, value: any) {
  await kv.set(["session", id], value);
}

async function send(chat: string, text: string, keyboard?: any) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, reply_markup: keyboard })
  });
}

async function sendMedia(items: { type: "photo" | "video"; file_id: string }[]) {
  if (!items.length) return;

  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP,
      media: items.map((m, i) => ({
        type: m.type,
        media: m.file_id,
        caption: i === 0 ? "📎 Медиа поломок" : undefined
      }))
    })
  });
}

function card(s: any) {
  return `🚛 Новый репорт

имя - ${s.data.name || ""}
трак - ${s.data.truck || ""}
поломка - ${s.data.issue || ""}

файлы - ${s.data.media.length}

когда оставляет трак - ${s.data.drop || ""}`;
}

Deno.serve(async (req) => {
  const u = await req.json();
  const msg = u.message;
  const cb = u.callback_query;

  if (cb) {
    const s = await getSession(cb.from.id);

    if (cb.data === "confirm") {
      await send(GROUP, card(s));
      await sendMedia(s.data.media);

      await send(cb.message.chat.id, "Заявка отправлена", {
        inline_keyboard: [[
          { text: "Создать новый репорт", callback_data: "new" }
        ]]
      });

      await saveSession(cb.from.id, { step: 1, data: { media: [] } });

      return new Response("ok");
    }

    if (cb.data === "new") {
      await saveSession(cb.from.id, { step: 1, data: { media: [] } });

      await send(cb.message.chat.id, "Введите имя и фамилию");
      return new Response("ok");
    }
  }

  if (!msg) return new Response("ok");
  if (msg.chat.type !== "private") return new Response("ok");

  let s = await getSession(msg.from.id);
  const text = msg.text || "";

  if (text === "/start") {
    s = { step: 1, data: { media: [] } };
    await saveSession(msg.from.id, s);

    await send(msg.chat.id, "Введите имя и фамилию");
    return new Response("ok");
  }

  if (s.step === 1) {
    s.data.name = text;
    s.step = 2;
    await saveSession(msg.from.id, s);

    await send(msg.chat.id, "Введите номер трака");
    return new Response("ok");
  }

  if (s.step === 2) {
    s.data.truck = text;
    s.step = 3;
    await saveSession(msg.from.id, s);

    await send(msg.chat.id, "Опишите поломки");
    return new Response("ok");
  }

  if (s.step === 3) {
    s.data.issue = text;
    s.step = 4;
    await saveSession(msg.from.id, s);

    await send(msg.chat.id, "Когда оставляете трак?");
    return new Response("ok");
  }

  if (s.step === 4) {
    s.data.drop = text;
    s.step = 5;
    await saveSession(msg.from.id, s);

    await send(msg.chat.id, "Отправьте фото или видео поломки");
    return new Response("ok");
  }

  if (s.step === 5) {
    if (!msg.photo && !msg.video) return new Response("ok");

    const groupId = msg.media_group_id || `single_${msg.from.id}`;

    const item = msg.photo
      ? { type: "photo", file_id: msg.photo.at(-1).file_id }
      : { type: "video", file_id: msg.video.file_id };

    if (!albumBuffer.has(groupId)) {
      albumBuffer.set(groupId, { items: [], timeout: 0 });
    }

    const buf = albumBuffer.get(groupId)!;
    buf.items.push(item);

    clearTimeout(buf.timeout);

    buf.timeout = setTimeout(async () => {
      const updated = await getSession(msg.from.id);
      updated.data.media.push(...buf.items);

      albumBuffer.delete(groupId);

      await send(msg.chat.id, card(updated), {
        inline_keyboard: [[
          { text: "Подтвердить", callback_data: "confirm" }
        ]]
      });
    }, 1200);

    return new Response("ok");
  }

  return new Response("ok");
});
