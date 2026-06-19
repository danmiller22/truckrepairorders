Deno.env.set("BOT_TOKEN", "test-token");
Deno.env.set("GROUP_CHAT_ID", "test-group");

const bot = await import("./main.ts");

function advance(session: any, value: string) {
  if (session.step === 1) session.data.name = value;
  else if (session.step === 2) session.data.truck = value;
  else if (session.step === 3) session.data.issue = value;
  session.step = bot.stepFor(session.data);
  return { session, action: { kind: "none" as const } };
}

Deno.test("concurrent updates advance once each and duplicates are ignored", async () => {
  const userId = -Date.now();
  const key = ["sessions", userId] as const;
  await bot.kv.delete(key);

  try {
    const [first, second] = await Promise.all([
      bot.transactSession(userId, 101, (session) => advance(session, "first")),
      bot.transactSession(userId, 102, (session) => advance(session, "second")),
    ]);

    if (!first.applied || !second.applied) throw new Error("Both unique updates must be applied");

    const stored = bot.normalizeSession((await bot.kv.get(key)).value);
    if (stored.step !== 3) throw new Error(`Expected step 3, got ${stored.step}`);
    if (!stored.data.name || !stored.data.truck) throw new Error("Both fields must be retained");

    const duplicate = await bot.transactSession(
      userId,
      101,
      (session) => advance(session, "duplicate"),
    );
    if (duplicate.applied) throw new Error("A repeated update_id must not be applied twice");

    const afterDuplicate = bot.normalizeSession((await bot.kv.get(key)).value);
    if (afterDuplicate.data.issue) throw new Error("Duplicate update changed the next field");
  } finally {
    await bot.kv.delete(key);
  }
});

Deno.test("saved fields repair an incorrect stored step", () => {
  const repaired = bot.normalizeSession({
    step: 2,
    data: {
      name: "Иван Иванов",
      truck: "T-100",
      issue: "Тормоза",
      drop: "",
      media: [],
    },
  });

  if (repaired.step !== 4) throw new Error(`Expected repaired step 4, got ${repaired.step}`);
});
