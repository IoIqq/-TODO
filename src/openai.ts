import type { ParsedTask } from "./types.js";

export async function maybeRefineParseWithOpenAI(params: {
  apiKey?: string;
  model: string;
  originalText: string;
  draft: ParsedTask;
  timeZone: string;
  now: number;
}): Promise<ParsedTask | null> {
  const { apiKey } = params;
  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract structured todo items from Chinese text. Return only valid JSON with keys title, due, priority, notes. due is either null or an object with timestamp and is_all_day. priority must be high, medium, or low. If information is missing, make the best reasonable guess from the text. Use the current timezone: " +
            params.timeZone +
            ".",
        },
        {
          role: "user",
          content: JSON.stringify({
            originalText: params.originalText,
            draft: params.draft,
            now: params.now,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as Partial<ParsedTask>;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      return null;
    }

    const result: ParsedTask = {
      title: parsed.title.trim(),
      priority: parsed.priority === "high" || parsed.priority === "low" ? parsed.priority : "medium",
      fallbackUsed: true,
    };

    if (parsed.due && typeof parsed.due.timestamp === "string") {
      result.due = parsed.due;
    } else if (params.draft.due) {
      result.due = params.draft.due;
    }

    if (typeof parsed.notes === "string" && parsed.notes.trim()) {
      result.notes = parsed.notes.trim();
    } else if (params.draft.notes) {
      result.notes = params.draft.notes;
    }

    return result;
  } catch {
    return null;
  }
}
