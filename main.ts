type MediaItem = {
  type: "photo" | "video";
  file_id: string;
};

type ReportData = {
  name: string;
  truck: string;
  issue: string;
  drop: string;
  media: MediaItem[];
};

type PendingSubmission = {
  id: number;
  data: ReportData;
};

type Session = {
  step: number;
  data: ReportData;
  processedUpdateIds: number[];
  pendingSubmission?: PendingSubmission;
};

type Action =
  | { kind: "none" }
  | { kind: "prompt"; text: string }
  | { kind: "confirmation"; session: Session }
  | { kind: "submit"; submission: PendingSubmission };

const TOKEN = requireEnv("BOT_TOKEN");
const GROUP = requireEnv("GROUP_CHAT_ID");
export const kv = await Deno.openKv();
const MAX_TRANSACTION_ATTEMPTS = 20;
const MAX_PROCESSED_UPDATE_IDS = 50;

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function requireEnv(name: string) {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function emptyData(name = ""): ReportData {
  return { name, truck: "", issue: "", drop: "", media: [] };
}

export function stepFor(data: ReportData) {
  if (!data.name) return 1;
  if (!data.truck) return 2;
  if (!data.issue) return 3;
  if (!data.drop) return 4;
  return 5;
}

export function normalizeSession(value: unknown): Session {
  const saved = value && typeof value === "object" ? value as Record<string, any> : {};
  const rawData = saved.data && typeof saved.data === "object" ? saved.data : {};
  const media = Array.isArray(rawData.media)
    ? rawData.media.filter((item: any) =>
      item &&
      (item.type === "photo" || item.type === "video") &&
      typeof item.file_id === "string"
    )
    : [];

  const data: ReportData = {
    name: typeof rawData.name === "string" ? rawData.name : "",
    truck: typeof rawData.truck === "string" ? rawData.truck : "",
    issue: typeof rawData.issue === "string" ? rawData.issue : "",
    drop: typeof rawData.drop === "string" ? rawData.drop : "",
    media,
  };

  const processedUpdateIds = Array.isArray(saved.processedUpdateIds)
    ? saved.processedUpdateIds.filter((id: unknown) => Number.isSafeInteger(id)).slice(-MAX_PROCESSED_UPDATE_IDS)
    : [];

  const session: Session = {
    step: stepFor(data),
    data,
    processedUpdateIds,
  };

  const pending = saved.pendingSubmission;
  if (pending && Number.isSafeInteger(pending.id) && pending.data) {
    session.pendingSubmission = {
      id: pending.id,
      data: normalizeSession({ data: pending.data }).data,
    };
  }

  return session;
}

function promptFor(session: Session) {
  const prompts: Record<number, string> = {
    1: "Введите имя и фамилию",
    2: "Введите номер трака",
    3: "Опишите поломки",
    4: "Когда оставляет трак?",
    5: "Отправьте фото или видео поломки",
  };

  return prompts[session.step] || prompts[1];
}

export async function transactSession(
  userId: number,
  updateId: number,
  change: (session: Session) => { session: Session; action: Action },
) {
  const key = ["sessions", userId] as const;

  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    const entry = await kv.get<Session>(key, { consistency: "strong" });
    const current = normalizeSession(entry.value);

    if (current.processedUpdateIds.includes(updateId)) {
      return { applied: false, session: current, action: { kind: "none" } as Action };
    }

    const changed = change(structuredClone(current));
    const next = normalizeSession(changed.session);
    next.processedUpdateIds = [
      ...current.processedUpdateIds,
      updateId,
    ].slice(-MAX_PROCESSED_UPDATE_IDS);

    const committed = await kv.atomic()
      .check({ key, versionstamp: entry.versionstamp })
      .set(key, next)
      .commit();

    if (committed.ok) {
      return { applied: true, session: next, action: changed.action };
    }
  }

  throw new Error(`Could not update session for user ${userId} after repeated conflicts`);
}

async function clearPendingSubmission(userId: number, submissionId: number) {
  const key = ["sessions", userId] as const;

  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    const entry = await kv.get<Session>(key, { consistency: "strong" });
    const session = normalizeSession(entry.value);

    if (session.pendingSubmission?.id !== submissionId) return;

    delete session.pendingSubmission;
    const committed = await kv.atomic()
      .check({ key, versionstamp: entry.versionstamp })
      .set(key, session)
      .commit();

    if (committed.ok) return;
  }

  throw new Error(`Could not finish submission ${submissionId} for user ${userId}`);
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${body}`);
  }

  return body;
}

async function send(chat: number | string, text: string, keyboard?: Record<string, unknown>) {
  await telegram("sendMessage", {
    chat_id: chat,
    text,
    reply_markup: keyboard,
  });
}

async function answerCallback(id: string) {
  await telegram("answerCallbackQuery", { callback_query_id: id });
}

async function sendSingleMedia(item: MediaItem) {
  if (item.type === "photo") {
    await telegram("sendPhoto", {
      chat_id: GROUP,
      photo: item.file_id,
      caption: "📎 Поломки",
    });
    return;
  }

  await telegram("sendVideo", {
    chat_id: GROUP,
    video: item.file_id,
    caption: "📎 Поломки",
  });
}

async function sendMedia(items: MediaItem[]) {
  if (!items.length) return;
  if (items.length === 1) return await sendSingleMedia(items[0]);

  for (let index = 0; index < items.length; index += 10) {
    const group = items.slice(index, index + 10);
    if (group.length === 1) {
      await sendSingleMedia(group[0]);
      continue;
    }

    await telegram("sendMediaGroup", {
      chat_id: GROUP,
      media: group.map((item, itemIndex) => ({
        type: item.type,
        media: item.file_id,
        caption: index === 0 && itemIndex === 0 ? "📎 Поломки" : undefined,
      })),
    });
  }
}

function card(data: ReportData) {
  return `🚛 Новый репорт

имя - ${data.name || "—"}
трак - ${data.truck || "—"}
поломка - ${data.issue || "—"}

файлы - ${data.media.length}

когда оставляет трак - ${data.drop || "—"}`;
}

function confirmationKeyboard() {
  return {
    inline_keyboard: [[
      { text: "Подтвердить", callback_data: "confirm" },
    ]],
  };
}

async function executeAction(chatId: number | string, action: Action, userId: number) {
  if (action.kind === "none") return;
  if (action.kind === "prompt") return await send(chatId, action.text);
  if (action.kind === "confirmation") {
    return await send(chatId, card(action.session.data), confirmationKeyboard());
  }

  await send(GROUP, card(action.submission.data));
  await sendMedia(action.submission.data.media);
  await clearPendingSubmission(userId, action.submission.id);
  await send(chatId, "Заявка отправлена", {
    inline_keyboard: [[
      { text: "Создать новый репорт", callback_data: "new" },
    ]],
  });
}

async function handleCallback(updateId: number, cb: any) {
  await answerCallback(cb.id);

  const transition = await transactSession(cb.from.id, updateId, (session) => {
    if (cb.data === "new") {
      session.data = emptyData(session.data.name);
      session.step = stepFor(session.data);
      return { session, action: { kind: "prompt", text: promptFor(session) } };
    }

    if (cb.data === "confirm" && session.step === 5 && session.data.media.length) {
      const submission: PendingSubmission = {
        id: updateId,
        data: structuredClone(session.data),
      };
      session.pendingSubmission = submission;
      session.data = emptyData(session.data.name);
      session.step = stepFor(session.data);
      return { session, action: { kind: "submit", submission } };
    }

    return { session, action: { kind: "prompt", text: promptFor(session) } };
  });

  let action = transition.action;
  if (
    !transition.applied &&
    cb.data === "confirm" &&
    transition.session.pendingSubmission?.id === updateId
  ) {
    action = { kind: "submit", submission: transition.session.pendingSubmission };
  }

  await executeAction(cb.message.chat.id, action, cb.from.id);
}

async function handleMessage(updateId: number, msg: any) {
  if (msg.chat.type !== "private") return;

  const text = msg.text?.trim() || "";
  const transition = await transactSession(msg.from.id, updateId, (session) => {
    if (text === "/start") {
      return { session, action: { kind: "prompt", text: promptFor(session) } };
    }

    if (session.step === 1) {
      if (!text) {
        return { session, action: { kind: "prompt", text: "Введите имя и фамилию текстом" } };
      }
      session.data.name = text;
    } else if (session.step === 2) {
      if (!text) {
        return { session, action: { kind: "prompt", text: "Введите номер трака текстом" } };
      }
      session.data.truck = text;
    } else if (session.step === 3) {
      if (!text) {
        return { session, action: { kind: "prompt", text: "Опишите поломки текстом" } };
      }
      session.data.issue = text;
    } else if (session.step === 4) {
      if (!text) {
        return { session, action: { kind: "prompt", text: "Напишите, когда оставите трак" } };
      }
      session.data.drop = text;
    } else {
      if (!msg.photo && !msg.video) {
        return { session, action: { kind: "prompt", text: "Отправьте фото или видео поломки" } };
      }

      const media: MediaItem = msg.photo
        ? { type: "photo", file_id: msg.photo.at(-1).file_id }
        : { type: "video", file_id: msg.video.file_id };
      session.data.media.push(media);
      session.step = stepFor(session.data);

      const action: Action = session.data.media.length === 1
        ? { kind: "confirmation", session: structuredClone(session) }
        : { kind: "none" };
      return { session, action };
    }

    session.step = stepFor(session.data);
    return { session, action: { kind: "prompt", text: promptFor(session) } };
  });

  if (transition.applied) {
    await executeAction(msg.chat.id, transition.action, msg.from.id);
  }
}

export async function handler(req: Request) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.pathname === "/storage-info") {
      await kv.get(["health", "storage"], { consistency: "strong" });
      return Response.json({ ok: true, storage: "deno_kv", atomic: true });
    }

    return Response.json({ service: "truckrepairorders", ok: true });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update = await req.json();
    const updateId = update.update_id;
    if (!Number.isSafeInteger(updateId)) return new Response("bad update", { status: 400 });

    if (update.callback_query) {
      await handleCallback(updateId, update.callback_query);
    } else if (update.message) {
      await handleMessage(updateId, update.message);
    }

    return new Response("ok");
  } catch (error) {
    console.error("Update handling failed", error);
    return new Response("error", { status: 500 });
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
