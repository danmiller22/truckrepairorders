function assertIncludes(source: string, fragment: string) {
  if (!source.includes(fragment)) {
    throw new Error(`Missing reference behavior: ${fragment}`);
  }
}

Deno.test("Russian bot keeps the English session-storage contract", async () => {
  const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

  for (const fragment of [
    "const sessions = new Map<number, Session>();",
    'const result = await store.get<Session>(["sessions", id]);',
    'await store.set(["sessions", id], session);',
    "s.data.name = text;\n      s.step = 2;\n      await saveSession(msg.from.id, s);",
    "s.data.truck = text;\n      s.step = 3;\n      await saveSession(msg.from.id, s);",
    "s.data.issue = text;\n      s.step = 4;\n      await saveSession(msg.from.id, s);",
    "s.data.drop = text;\n      s.step = 5;\n      await saveSession(msg.from.id, s);",
  ]) {
    assertIncludes(source, fragment);
  }
});
